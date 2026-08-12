import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getAllSettings, setSetting } from '../utils/store';
import {
  getGatewayCredential,
  hasGatewayCredential,
  setGatewayCredential,
} from './secrets/gateway-credential-store';
import { validateGatewayUrl } from '../gateway/ws-client';
import { isRecord } from './payload-utils';

type HealthPayload = {
  probe?: unknown;
};

type RpcPayload = {
  method?: unknown;
  params?: unknown;
  timeoutMs?: unknown;
};

function parseTimeoutMs(timeoutMs: unknown): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid gateway RPC timeout');
  }
  return timeoutMs;
}

export function createGatewayApi(gatewayManager: GatewayManager): CompleteHostServiceRegistry['gateway'] {
  return {
    connection: async () => {
      const settings = await getAllSettings();
      return {
        url: settings.gatewayUrl,
        authMode: settings.gatewayAuthMode,
        hasCredential: await hasGatewayCredential(),
      };
    },
    configure: async (payload) => {
      const body = payload;
      const url = validateGatewayUrl(typeof body.url === 'string' ? body.url : '');
      const authMode = body.authMode === 'password' ? 'password' : body.authMode === 'token' ? 'token' : null;
      const credential = typeof body.credential === 'string' ? body.credential.trim() : '';
      if (!authMode) throw new Error('Gateway authentication mode must be token or password');
      if (!credential) throw new Error('Gateway credential is required');

      await setGatewayCredential(authMode, credential);
      await setSetting('gatewayUrl', url);
      await setSetting('gatewayAuthMode', authMode);
      try {
        await gatewayManager.restart();
        return { success: true, status: gatewayManager.getStatus() };
      } catch (error) {
        return {
          success: false,
          error: gatewayManager.getStatus().error || (error instanceof Error ? error.message : String(error)),
          status: gatewayManager.getStatus(),
        };
      }
    },
    status: () => gatewayManager.getStatus(),
    start: async () => {
      await gatewayManager.start();
      return { success: true };
    },
    stop: async () => {
      await gatewayManager.stop();
      return { success: true };
    },
    restart: async () => {
      await gatewayManager.restart();
      return { success: true };
    },
    health: async (payload) => {
      const body = isRecord(payload) ? payload as HealthPayload : {};
      return gatewayManager.checkHealth({ probe: body.probe === true });
    },
    controlUi: async () => {
      const status = gatewayManager.getStatus();
      const settings = await getAllSettings();
      const credential = await getGatewayCredential();
      const gatewayUrl = new URL(settings.gatewayUrl);
      gatewayUrl.protocol = gatewayUrl.protocol === 'wss:' ? 'https:' : 'http:';
      return {
        success: true,
        url: gatewayUrl.toString(),
        port: status.port,
        ...(credential ? {} : { error: 'Gateway credential is not configured' }),
      };
    },
    rpc: async (payload) => {
      const body = isRecord(payload) ? payload as RpcPayload : {};
      const method = typeof body.method === 'string' ? body.method.trim() : '';
      if (!method) {
        throw new Error('Invalid gateway RPC method');
      }
      const timeoutMs = parseTimeoutMs(body.timeoutMs);
      return gatewayManager.rpc(method, body.params, timeoutMs);
    },
  };
}
