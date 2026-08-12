/**
 * Main-owned remote OpenClaw Gateway connection.
 *
 * This class intentionally owns no OpenClaw process. start/stop/restart only
 * control the client WebSocket and its reconnect policy.
 */
import { app } from 'electron';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { JsonRpcNotification } from './protocol';
import { isNotification, isResponse } from './protocol';
import { logger } from '../utils/logger';
import { loadOrCreateDeviceIdentity, type DeviceIdentity } from '../utils/device-identity';
import { getAllSettings } from '../utils/store';
import { getGatewayCredential } from '../services/secrets/gateway-credential-store';
import {
  clearPendingGatewayRequests,
  rejectPendingGatewayRequest,
  resolvePendingGatewayRequest,
  type PendingGatewayRequest,
} from './request-store';
import { dispatchJsonRpcNotification, dispatchProtocolEvent } from './event-dispatch';
import { GatewayConnectionMonitor } from './connection-monitor';
import {
  GatewayCapabilityMonitor,
  type GatewayCapabilityName,
  type GatewayCapabilitySnapshot,
} from './capability-monitor';
import {
  connectGatewaySocket,
  GatewaySocketError,
  validateGatewayUrl,
} from './ws-client';
import { OpenXNodeBridge } from './node-bridge';
import { mutateOpenClawConfig } from './config-delivery';
import {
  isGatewayWsTraceEnabled,
  redactGatewayFrameForTrace,
  summarizeGatewayFrameForTrace,
} from './ws-trace';
import type {
  GatewayChannelStatusEvent,
  GatewayChatMessageEvent,
  GatewayRuntimePayload,
} from '@shared/host-events/contract';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';

export type GatewayLifecycleState = 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';

export interface GatewayStatus {
  state: GatewayLifecycleState;
  port: number;
  pid?: number;
  uptime?: number;
  error?: string;
  errorCode?: 'unauthorized' | 'pairing-required' | 'origin-not-allowed' | 'unreachable' | 'disconnected' | 'invalid-config';
  connectedAt?: number;
  version?: string;
  reconnectAttempts?: number;
  gatewayReady?: boolean;
  url?: string;
}

export type GatewayHealthState = 'healthy' | 'degraded' | 'unresponsive';

export interface GatewayHealthSummary {
  state: GatewayHealthState;
  reasons: string[];
  consecutiveHeartbeatMisses: number;
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
}

export interface GatewayHealthReport {
  ok: boolean;
  error?: string;
  uptime?: number;
  version?: string;
  capabilities: GatewayCapabilitySnapshot;
}

export interface GatewayDiagnosticsSnapshot {
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastHeartbeatTimeoutAt?: number;
  consecutiveHeartbeatMisses: number;
  lastSocketCloseAt?: number;
  lastSocketCloseCode?: number;
  consecutiveRpcFailures: number;
}

export interface GatewayManagerEvents {
  status: (status: GatewayStatus) => void;
  message: (message: unknown) => void;
  notification: (notification: JsonRpcNotification) => void;
  exit: (code: number | null) => void;
  error: (error: Error) => void;
  'gateway:health': (data: GatewayRuntimePayload) => void;
  'gateway:presence': (data: GatewayRuntimePayload) => void;
  'channel:status': (data: GatewayChannelStatusEvent) => void;
  'chat:message': (data: GatewayChatMessageEvent) => void;
  'chat:runtime-event': (data: ChatRuntimeEvent) => void;
}

type ReconnectConfig = {
  baseDelay: number;
  maxDelay: number;
};

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  baseDelay: 1_000,
  maxDelay: 30_000,
};
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const HEARTBEAT_MAX_MISSES = 3;

function portFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === 'wss:' ? 443 : 80;
  } catch {
    return 0;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOriginNotAllowed(error: unknown): boolean {
  return /origin (?:is )?not allowed|CONTROL_UI_ORIGIN_NOT_ALLOWED/i.test(errorText(error));
}

function isUnauthorized(error: unknown): boolean {
  if (isOriginNotAllowed(error)) return false;
  if (isPairingRequired(error)) return false;
  if (error instanceof GatewaySocketError) {
    if (error.closeCode === 1008) return true;
    if (error.gatewayCode && /AUTH|UNAUTHORIZED|FORBIDDEN/i.test(error.gatewayCode)) return true;
  }
  return /unauthori[sz]ed|invalid (?:token|password)|token mismatch|password mismatch|authentication failed/i
    .test(errorText(error));
}

function isPairingRequired(error: unknown): boolean {
  if (error instanceof GatewaySocketError && error.gatewayCode === 'PAIRING_REQUIRED') return true;
  return /pairing required|must be re-approved|pending (?:device )?approval/i.test(errorText(error));
}

function isCoreRpcMethod(method: string): boolean {
  return method === 'system-presence';
}

function classifyCapabilityMethod(method: string): GatewayCapabilityName | null {
  if (method === 'health') return 'openclawHealth';
  if (method === 'status') return 'openclawStatus';
  if (method === 'channels.status') return 'channels';
  if (method.startsWith('doctor.memory.')) return 'memory';
  return null;
}

function mutableRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

export class GatewayManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private status: GatewayStatus = { state: 'stopped', port: 18789 };
  private readonly reconnectConfig: ReconnectConfig;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = false;
  private connectGeneration = 0;
  private startInFlight: Promise<void> | null = null;
  private deviceIdentity: DeviceIdentity | null = null;
  private nodeDeviceIdentity: DeviceIdentity | null = null;
  private readonly pendingRequests = new Map<string, PendingGatewayRequest>();
  private readonly clientRpcHandlers = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
  private readonly nodeBridge: OpenXNodeBridge;
  private readonly connectionMonitor = new GatewayConnectionMonitor();
  private readonly capabilityMonitor = new GatewayCapabilityMonitor();
  private diagnostics: GatewayDiagnosticsSnapshot = {
    consecutiveHeartbeatMisses: 0,
    consecutiveRpcFailures: 0,
  };

  constructor(config?: Partial<ReconnectConfig>) {
    super();
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config };
    this.nodeBridge = new OpenXNodeBridge({
      listCommands: () => [...this.clientRpcHandlers.keys()],
      invokeCommand: async (command, params) => {
        const handler = this.clientRpcHandlers.get(command);
        if (!handler) throw new Error(`Unsupported OpenX node command: ${command}`);
        return await handler(params);
      },
      approveOwnPairing: async (requestId) => {
        try {
          await this.rpc('device.pair.approve', { requestId }, 10_000);
        } catch {
          await this.rpc('node.pair.approve', { requestId }, 10_000);
        }
      },
    });
    this.on('gateway:health', (payload) => this.capabilityMonitor.recordOpenClawHealth(payload));
    this.on('gateway:presence', (payload) => this.capabilityMonitor.recordPresence(payload));
  }

  getStatus(): GatewayStatus {
    const uptime = this.status.connectedAt
      ? Math.floor((Date.now() - this.status.connectedAt) / 1000)
      : undefined;
    return { ...this.status, ...(uptime !== undefined ? { uptime } : {}) };
  }

  getDiagnostics(): GatewayDiagnosticsSnapshot {
    return { ...this.diagnostics };
  }

  getCapabilitySnapshot(summary?: GatewayHealthSummary): GatewayCapabilitySnapshot {
    return this.capabilityMonitor.buildSnapshot({
      status: this.status,
      transportConnected: this.ws?.readyState === WebSocket.OPEN,
      diagnostics: this.getDiagnostics(),
      summary,
    });
  }

  recordCapabilityFailure(name: GatewayCapabilityName, error: unknown, durationMs?: number): void {
    this.capabilityMonitor.recordCapabilityFailure(name, error, durationMs);
  }

  isConnected(): boolean {
    return this.status.state === 'running' && this.ws?.readyState === WebSocket.OPEN;
  }

  registerClientRpcHandler(method: string, handler: (params: unknown) => Promise<unknown> | unknown): () => void {
    if (this.clientRpcHandlers.has(method)) throw new Error(`Client RPC handler already registered: ${method}`);
    this.clientRpcHandlers.set(method, handler);
    return () => this.clientRpcHandlers.delete(method);
  }

  async start(): Promise<void> {
    this.shouldReconnect = true;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    return this.connect(false);
  }

  private connect(isReconnect: boolean): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    if (this.startInFlight) return this.startInFlight;
    const operation = this.connectOnce(isReconnect).finally(() => {
      if (this.startInFlight === operation) this.startInFlight = null;
    });
    this.startInFlight = operation;
    return operation;
  }

  private async connectOnce(isReconnect: boolean): Promise<void> {
    const generation = ++this.connectGeneration;
    const settings = await getAllSettings();
    let url: string;
    try {
      url = validateGatewayUrl(settings.gatewayUrl);
    } catch (error) {
      this.shouldReconnect = false;
      this.setStatus({
        state: 'error',
        port: 0,
        url: settings.gatewayUrl,
        gatewayReady: false,
        error: errorText(error),
        errorCode: 'invalid-config',
      });
      throw error;
    }
    const credential = await getGatewayCredential();
    if (!credential) {
      const error = new Error('Gateway credential is not configured');
      this.shouldReconnect = false;
      this.setStatus({
        state: 'error',
        port: portFromUrl(url),
        url,
        gatewayReady: false,
        error: error.message,
        errorCode: 'invalid-config',
      });
      throw error;
    }
    if (!this.deviceIdentity) {
      const identityPath = path.join(app.getPath('userData'), 'openx-device-identity.json');
      this.deviceIdentity = await loadOrCreateDeviceIdentity(identityPath);
    }

    this.setStatus({
      state: isReconnect ? 'reconnecting' : 'starting',
      port: portFromUrl(url),
      url,
      gatewayReady: false,
      reconnectAttempts: this.reconnectAttempts,
      error: undefined,
      errorCode: undefined,
      connectedAt: undefined,
      pid: undefined,
    });

    try {
      const socket = await connectGatewaySocket({
        url,
        credential,
        deviceIdentity: this.deviceIdentity,
        platform: process.platform,
        clientVersion: app.getVersion(),
        pendingRequests: this.pendingRequests,
        onHandshakeComplete: (ws, hello) => {
          if (generation !== this.connectGeneration) {
            ws.close();
            return;
          }
          this.ws = ws;
          const helloRecord = hello && typeof hello === 'object' ? hello as Record<string, unknown> : {};
          const server = helloRecord.server && typeof helloRecord.server === 'object'
            ? helloRecord.server as Record<string, unknown>
            : {};
          ws.on('pong', () => {
            this.connectionMonitor.markAlive('pong');
            this.recordGatewayAlive();
          });
          this.reconnectAttempts = 0;
          this.recordGatewayAlive();
          this.setStatus({
            state: 'running',
            port: portFromUrl(url),
            url,
            connectedAt: Date.now(),
            version: typeof server.version === 'string' ? server.version : undefined,
            reconnectAttempts: 0,
            gatewayReady: true,
            error: undefined,
            errorCode: undefined,
            pid: undefined,
          });
          this.startHeartbeat(generation);
          void this.startNodeBridge({ url, credential });
        },
        onMessage: (message) => this.handleMessage(message),
        onCloseAfterHandshake: (code, reason) => this.handleSocketClose(generation, code, reason),
      });
      if (generation === this.connectGeneration) this.ws = socket;
    } catch (error) {
      if (generation !== this.connectGeneration) return;
      this.ws = null;
      this.connectionMonitor.clear();
      clearPendingGatewayRequests(this.pendingRequests, new Error('Gateway connection closed'));
      const originNotAllowed = isOriginNotAllowed(error);
      const pairingRequired = isPairingRequired(error);
      const unauthorized = isUnauthorized(error);
      const message = originNotAllowed
        ? 'Gateway must allow https://openx.invalid in gateway.controlUi.allowedOrigins'
        : pairingRequired ? 'Gateway device approval is required'
        : unauthorized ? 'Gateway authentication failed' : errorText(error);
      this.setStatus({
        state: 'error',
        port: portFromUrl(url),
        url,
        gatewayReady: false,
        error: message,
        errorCode: originNotAllowed
          ? 'origin-not-allowed'
          : pairingRequired ? 'pairing-required' : unauthorized ? 'unauthorized' : 'unreachable',
        reconnectAttempts: this.reconnectAttempts,
        connectedAt: undefined,
        pid: undefined,
      });
      this.emit('error', new Error(message));
      if (unauthorized || originNotAllowed) {
        this.shouldReconnect = false;
      } else {
        this.scheduleReconnect();
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.connectGeneration += 1;
    this.connectionMonitor.clear();
    this.nodeBridge.stop();
    clearPendingGatewayRequests(this.pendingRequests, new Error('Gateway client stopped'));
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      try { socket.close(1000, 'client stopped'); } catch { /* best effort */ }
    }
    this.setStatus({
      state: 'stopped',
      gatewayReady: false,
      connectedAt: undefined,
      reconnectAttempts: 0,
      error: undefined,
      errorCode: undefined,
      pid: undefined,
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async debouncedRestart(): Promise<void> {
    await this.restart();
  }

  async debouncedReload(): Promise<void> {
    if (!this.isConnected()) return;
    await this.rpc('config.get', {}, 8_000);
  }

  async forceTerminateOwnedProcessForQuit(): Promise<boolean> {
    return false;
  }

  async rpc<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await new Promise<T>((resolve, reject) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Gateway not connected'));
          return;
        }
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => {
          rejectPendingGatewayRequest(this.pendingRequests, id, new Error(`RPC timeout: ${method}`));
        }, timeoutMs);
        this.pendingRequests.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeout,
        });
        const request = { type: 'req', id, method, params };
        try {
          if (isGatewayWsTraceEnabled()) {
            logger.debug('[gateway-ws-trace] send', {
              summary: summarizeGatewayFrameForTrace(request),
              frame: redactGatewayFrameForTrace(request),
            });
          }
          this.ws.send(JSON.stringify(request));
        } catch (error) {
          rejectPendingGatewayRequest(
            this.pendingRequests,
            id,
            new Error(`Failed to send RPC request: ${errorText(error)}`),
          );
        }
      });
      this.diagnostics.lastRpcSuccessAt = Date.now();
      this.diagnostics.consecutiveRpcFailures = 0;
      if (isCoreRpcMethod(method)) {
        this.capabilityMonitor.recordCoreProbe({ ok: true, checkedAt: Date.now(), durationMs: Date.now() - startedAt });
      }
      const capability = classifyCapabilityMethod(method);
      if (capability) this.capabilityMonitor.recordCapabilitySuccess(capability, result as GatewayRuntimePayload, Date.now() - startedAt);
      return result;
    } catch (error) {
      this.diagnostics.lastRpcFailureAt = Date.now();
      this.diagnostics.lastRpcFailureMethod = method;
      this.diagnostics.consecutiveRpcFailures += 1;
      const capability = classifyCapabilityMethod(method);
      if (capability) this.capabilityMonitor.recordCapabilityFailure(capability, error, Date.now() - startedAt);
      throw error;
    }
  }

  async checkHealth(options?: { probe?: boolean }): Promise<GatewayHealthReport> {
    if (!this.isConnected()) {
      return {
        ok: false,
        error: this.status.error ?? 'WebSocket not connected',
        capabilities: this.getCapabilitySnapshot(),
      };
    }
    const timeoutMs = options?.probe ? 8_000 : 3_000;
    const [healthResult, statusResult] = await Promise.allSettled([
      this.rpc('health', { probe: options?.probe === true }, timeoutMs),
      this.rpc('status', {}, timeoutMs),
    ]);
    if (healthResult.status === 'fulfilled') {
      this.capabilityMonitor.recordOpenClawHealth(healthResult.value as GatewayRuntimePayload);
    }
    if (statusResult.status === 'fulfilled') {
      this.capabilityMonitor.recordOpenClawStatus(statusResult.value as GatewayRuntimePayload);
    }
    return {
      ok: true,
      uptime: this.getStatus().uptime,
      version: this.status.version,
      capabilities: this.getCapabilitySnapshot(),
    };
  }

  private handleMessage(message: unknown): void {
    this.connectionMonitor.markAlive('message');
    this.recordGatewayAlive();
    if (isGatewayWsTraceEnabled()) {
      logger.debug('[gateway-ws-trace] recv', {
        summary: summarizeGatewayFrameForTrace(message),
        frame: redactGatewayFrameForTrace(message),
      });
    }
    if (!message || typeof message !== 'object') return;
    const msg = message as Record<string, unknown>;
    if (msg.type === 'req' && typeof msg.id === 'string' && typeof msg.method === 'string') {
      const handler = this.clientRpcHandlers.get(msg.method);
      if (!handler || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const socket = this.ws;
      void Promise.resolve(handler(msg.params)).then((payload) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, payload }));
      }).catch((error) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'res',
            id: msg.id,
            ok: false,
            error: { code: 'OPENX_CLIENT_RPC_FAILED', message: errorText(error) },
          }));
        }
      });
      return;
    }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      if (msg.ok === false || msg.error) {
        const error = msg.error && typeof msg.error === 'object' ? msg.error as Record<string, unknown> : {};
        rejectPendingGatewayRequest(this.pendingRequests, msg.id, new GatewaySocketError(
          typeof error.message === 'string' ? error.message : 'Gateway request failed',
          undefined,
          typeof error.code === 'string' ? error.code : undefined,
          error.details,
        ));
      } else {
        resolvePendingGatewayRequest(this.pendingRequests, msg.id, msg.payload ?? msg);
      }
      return;
    }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      dispatchProtocolEvent(this, msg.event, msg.payload);
      return;
    }
    if (isResponse(message) && message.id) {
      if (message.error) {
        rejectPendingGatewayRequest(this.pendingRequests, String(message.id), new Error(message.error.message));
      } else {
        resolvePendingGatewayRequest(this.pendingRequests, String(message.id), message.result);
      }
      return;
    }
    if (isNotification(message)) {
      dispatchJsonRpcNotification(this, message);
      return;
    }
    this.emit('message', message);
  }

  private handleSocketClose(generation: number, code: number, reason: string): void {
    if (generation !== this.connectGeneration) return;
    this.ws = null;
    this.connectionMonitor.clear();
    this.diagnostics.lastSocketCloseAt = Date.now();
    this.diagnostics.lastSocketCloseCode = code;
    clearPendingGatewayRequests(this.pendingRequests, new Error('Gateway connection lost'));
    if (!this.shouldReconnect) return;
    const pairingRequired = code === 1008 && /pairing required|must be re-approved|pending (?:device )?approval/i.test(reason);
    this.setStatus({
      state: 'reconnecting',
      gatewayReady: false,
      connectedAt: undefined,
      error: reason || 'Gateway connection lost',
      errorCode: code === 1008 && /origin not allowed/i.test(reason)
        ? 'origin-not-allowed'
        : pairingRequired ? 'pairing-required'
          : code === 1008 ? 'unauthorized' : 'disconnected',
      reconnectAttempts: this.reconnectAttempts,
      pid: undefined,
    });
    if (code === 1008 && /origin not allowed/i.test(reason)) {
      this.shouldReconnect = false;
      this.setStatus({
        state: 'error',
        error: 'Gateway must allow https://openx.invalid in gateway.controlUi.allowedOrigins',
        errorCode: 'origin-not-allowed',
      });
      return;
    }
    if (pairingRequired) {
      this.setStatus({
        state: 'error',
        error: 'Gateway device approval is required',
        errorCode: 'pairing-required',
      });
      this.scheduleReconnect();
      return;
    }
    if (code === 1008) {
      this.shouldReconnect = false;
      this.setStatus({ state: 'error', error: 'Gateway authentication failed', errorCode: 'unauthorized' });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectConfig.baseDelay * 2 ** Math.min(this.reconnectAttempts, 10),
      this.reconnectConfig.maxDelay,
    );
    this.reconnectAttempts += 1;
    this.setStatus({ state: 'reconnecting', reconnectAttempts: this.reconnectAttempts, gatewayReady: false });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(true).catch(() => {
        // connectOnce classifies the failure and schedules the next attempt.
      });
    }, delay);
  }

  private async startNodeBridge(options: {
    url: string;
    credential: import('./ws-client').GatewayCredential;
  }): Promise<void> {
    if (!this.nodeDeviceIdentity) {
      const identityPath = path.join(app.getPath('userData'), 'openx-node-device-identity.json');
      this.nodeDeviceIdentity = await loadOrCreateDeviceIdentity(identityPath);
    }
    const openXCommands = [...this.clientRpcHandlers.keys()].filter((command) => command.startsWith('openx.'));
    try {
      await mutateOpenClawConfig((config) => {
        const gateway = mutableRecord(config, 'gateway');
        const nodes = mutableRecord(gateway, 'nodes');
        const existing = Array.isArray(nodes.allowCommands)
          ? nodes.allowCommands.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        nodes.allowCommands = [...new Set([...existing, ...openXCommands])].sort();
      });
    } catch (error) {
      logger.warn('Unable to synchronize OpenX node command allowlist:', error);
    }
    await this.nodeBridge.start({
      ...options,
      deviceIdentity: this.nodeDeviceIdentity,
      clientVersion: app.getVersion(),
    });
  }

  private startHeartbeat(generation: number): void {
    this.connectionMonitor.startPing({
      intervalMs: HEARTBEAT_INTERVAL_MS,
      timeoutMs: HEARTBEAT_TIMEOUT_MS,
      maxConsecutiveMisses: HEARTBEAT_MAX_MISSES,
      sendPing: () => {
        if (generation === this.connectGeneration && this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
      },
      onHeartbeatTimeout: ({ consecutiveMisses }) => {
        this.diagnostics.lastHeartbeatTimeoutAt = Date.now();
        this.diagnostics.consecutiveHeartbeatMisses = consecutiveMisses;
        if (generation === this.connectGeneration && this.ws) this.ws.terminate();
      },
    });
  }

  private recordGatewayAlive(): void {
    this.diagnostics.lastAliveAt = Date.now();
    this.diagnostics.consecutiveHeartbeatMisses = 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(patch: Partial<GatewayStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.getStatus());
  }
}
