import { app, Notification } from 'electron';
import os from 'node:os';
import WebSocket from 'ws';
import type { DeviceIdentity } from '../utils/device-identity';
import { logger } from '../utils/logger';
import {
  clearPendingGatewayRequests,
  rejectPendingGatewayRequest,
  resolvePendingGatewayRequest,
  type PendingGatewayRequest,
} from './request-store';
import {
  connectGatewaySocket,
  GatewaySocketError,
  type GatewayConnectProfile,
  type GatewayCredential,
} from './ws-client';

export const OPENX_NODE_BASE_COMMANDS = [
  'device.info',
  'device.status',
  'system.notify',
] as const;

type NodeBridgeConnection = {
  url: string;
  credential: GatewayCredential;
  deviceIdentity: DeviceIdentity;
  clientVersion: string;
};

type NodeInvokeFrame = {
  id: string;
  nodeId: string;
  command: string;
  params: unknown;
};

export type OpenXNodeBridgeOptions = {
  listCommands: () => string[];
  invokeCommand: (command: string, params: unknown) => Promise<unknown>;
  approveOwnPairing: (requestId: string) => Promise<void>;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gatewayPlatform(): string {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return process.platform;
}

function gatewayDeviceFamily(): string | undefined {
  if (process.platform === 'win32') return 'Windows';
  if (process.platform === 'darwin') return 'Mac';
  if (process.platform === 'linux') return 'Linux';
  return undefined;
}

function pairingRequestId(error: unknown): string | null {
  if (!(error instanceof GatewaySocketError)) return null;
  const candidates: unknown[] = [error.details];
  while (candidates.length > 0) {
    const value = candidates.shift();
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (typeof record.requestId === 'string' && record.requestId.trim()) return record.requestId.trim();
    if (record.details) candidates.push(record.details);
  }
  return null;
}

function parseInvokeFrame(payload: unknown): NodeInvokeFrame | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : '';
  const command = typeof record.command === 'string' ? record.command.trim() : '';
  if (!id || !nodeId || !command) return null;
  let params: unknown = record.params;
  if (typeof record.paramsJSON === 'string') {
    try {
      params = JSON.parse(record.paramsJSON) as unknown;
    } catch {
      params = {};
    }
  }
  return { id, nodeId, command, params: params ?? {} };
}

/**
 * Registers the Electron client as a first-class OpenClaw node alongside the
 * normal operator connection. The node never starts or supervises a Gateway;
 * it only exposes explicitly declared OpenX commands to the remote Gateway.
 */
export class OpenXNodeBridge {
  private ws: WebSocket | null = null;
  private desired = false;
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connection: NodeBridgeConnection | null = null;
  private readonly pendingRequests = new Map<string, PendingGatewayRequest>();

  constructor(private readonly options: OpenXNodeBridgeOptions) {}

  async start(connection: NodeBridgeConnection): Promise<void> {
    this.connection = connection;
    this.desired = true;
    this.clearReconnectTimer();
    await this.connect();
  }

  stop(): void {
    this.desired = false;
    this.generation += 1;
    this.clearReconnectTimer();
    clearPendingGatewayRequests(this.pendingRequests, new Error('OpenX node stopped'));
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      try { socket.close(1000, 'OpenX node stopped'); } catch { /* best effort */ }
    }
  }

  private async connect(): Promise<void> {
    const connection = this.connection;
    if (!this.desired || !connection || this.ws?.readyState === WebSocket.OPEN) return;
    const generation = ++this.generation;
    const commands = [...new Set([...OPENX_NODE_BASE_COMMANDS, ...this.options.listCommands()])].sort();
    const profile: GatewayConnectProfile = {
      role: 'node',
      scopes: [],
      clientId: 'node-host',
      clientMode: 'node',
      displayName: `OpenX — ${os.hostname()}`,
      caps: ['system', 'openx-client'],
      commands,
      instanceId: connection.deviceIdentity.deviceId,
      deviceFamily: gatewayDeviceFamily(),
      pathEnv: process.env.PATH,
      sendOrigin: false,
    };

    try {
      const socket = await connectGatewaySocket({
        url: connection.url,
        credential: connection.credential,
        deviceIdentity: connection.deviceIdentity,
        platform: gatewayPlatform(),
        clientVersion: connection.clientVersion,
        profile,
        pendingRequests: this.pendingRequests,
        onHandshakeComplete: (ws) => {
          if (!this.desired || generation !== this.generation) {
            ws.close();
            return;
          }
          this.ws = ws;
          this.reconnectAttempt = 0;
          logger.info(`OpenX node connected (${commands.length} commands exposed)`);
        },
        onMessage: (message) => this.handleMessage(message),
        onCloseAfterHandshake: (_code, reason) => {
          if (generation !== this.generation) return;
          this.ws = null;
          clearPendingGatewayRequests(this.pendingRequests, new Error('OpenX node connection lost'));
          logger.warn(`OpenX node disconnected: ${reason || 'connection closed'}`);
          this.scheduleReconnect();
        },
      });
      if (generation === this.generation) this.ws = socket;
    } catch (error) {
      if (!this.desired || generation !== this.generation) return;
      this.ws = null;
      clearPendingGatewayRequests(this.pendingRequests, new Error('OpenX node connection failed'));
      const requestId = pairingRequestId(error);
      if (requestId) {
        try {
          await this.options.approveOwnPairing(requestId);
          logger.info('Approved OpenX node role for the current device identity');
          if (this.desired && generation === this.generation) await this.connect();
          return;
        } catch (approvalError) {
          logger.warn('Unable to approve OpenX node pairing automatically:', approvalError);
        }
      } else {
        logger.warn('OpenX node connection failed:', error);
      }
      this.scheduleReconnect();
    }
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const frame = message as Record<string, unknown>;
    if (frame.type === 'res' && typeof frame.id === 'string') {
      if (frame.ok === false || frame.error) {
        const rawError = frame.error && typeof frame.error === 'object'
          ? frame.error as Record<string, unknown>
          : {};
        rejectPendingGatewayRequest(this.pendingRequests, frame.id, new GatewaySocketError(
          typeof rawError.message === 'string' ? rawError.message : 'Gateway node request failed',
          undefined,
          typeof rawError.code === 'string' ? rawError.code : undefined,
          rawError.details,
        ));
      } else {
        resolvePendingGatewayRequest(this.pendingRequests, frame.id, frame.payload ?? frame);
      }
      return;
    }
    if (frame.type !== 'event' || frame.event !== 'node.invoke.request') return;
    const invoke = parseInvokeFrame(frame.payload);
    if (!invoke) return;
    void this.handleInvoke(invoke);
  }

  private async handleInvoke(frame: NodeInvokeFrame): Promise<void> {
    try {
      const payload = await this.invoke(frame.command, frame.params);
      await this.request('node.invoke.result', {
        id: frame.id,
        nodeId: frame.nodeId,
        ok: true,
        payload,
      });
    } catch (error) {
      await this.request('node.invoke.result', {
        id: frame.id,
        nodeId: frame.nodeId,
        ok: false,
        error: { code: 'OPENX_NODE_COMMAND_FAILED', message: errorText(error) },
      }).catch(() => undefined);
    }
  }

  private async invoke(command: string, params: unknown): Promise<unknown> {
    if (command === 'device.info') {
      return {
        name: 'OpenX',
        version: app.getVersion(),
        hostname: os.hostname(),
        platform: gatewayPlatform(),
        arch: process.arch,
        capabilities: ['openx-client'],
      };
    }
    if (command === 'device.status') {
      return {
        available: true,
        foreground: true,
        app: 'OpenX',
        platform: gatewayPlatform(),
      };
    }
    if (command === 'system.notify') {
      const body = params && typeof params === 'object' && !Array.isArray(params)
        ? params as Record<string, unknown>
        : {};
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'OpenX';
      const message = typeof body.body === 'string' ? body.body : typeof body.message === 'string' ? body.message : '';
      if (Notification.isSupported()) new Notification({ title, body: message }).show();
      return { delivered: Notification.isSupported() };
    }
    return await this.options.invokeCommand(command, params);
  }

  private async request<T = unknown>(method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error('OpenX node is not connected'));
        return;
      }
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        rejectPendingGatewayRequest(this.pendingRequests, id, new Error(`OpenX node RPC timeout: ${method}`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
      try {
        socket.send(JSON.stringify({ type: 'req', id, method, params }));
      } catch (error) {
        rejectPendingGatewayRequest(this.pendingRequests, id, new Error(errorText(error)));
      }
    });
  }

  private scheduleReconnect(): void {
    if (!this.desired || this.reconnectTimer) return;
    const delay = Math.min(1_000 * 2 ** Math.min(this.reconnectAttempt, 5), 30_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
