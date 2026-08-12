import WebSocket from 'ws';
import type { DeviceIdentity } from '../utils/device-identity';
import type { PendingGatewayRequest } from './request-store';
import {
  buildDeviceAuthPayload,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from '../utils/device-identity';
import { logger } from '../utils/logger';
import {
  isGatewayWsTraceEnabled,
  redactGatewayFrameForTrace,
  summarizeGatewayFrameForTrace,
} from './ws-trace';

export type GatewayCredential = {
  mode: 'token' | 'password';
  secret: string;
};

export class GatewaySocketError extends Error {
  constructor(
    message: string,
    readonly closeCode?: number,
    readonly gatewayCode?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GatewaySocketError';
  }
}

export const GATEWAY_CHALLENGE_TIMEOUT_MS = 15_000;
export const GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS = 20_000;
const GATEWAY_PROTOCOL_VERSION = 4;
/** Stable application origin that operators can explicitly allow on Gateway. */
export const OPENX_GATEWAY_ORIGIN = 'https://openx.invalid';

export type GatewayConnectProfile = {
  role: 'operator' | 'node';
  scopes: string[];
  clientId: 'openclaw-control-ui' | 'node-host';
  clientMode: 'webchat' | 'node';
  displayName: string;
  caps: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  instanceId?: string;
  deviceFamily?: string;
  sendOrigin?: boolean;
};

const OPENX_OPERATOR_PROFILE: GatewayConnectProfile = {
  role: 'operator',
  scopes: [
    'operator.admin',
    'operator.read',
    'operator.write',
    'operator.approvals',
    'operator.pairing',
  ],
  clientId: 'openclaw-control-ui',
  clientMode: 'webchat',
  displayName: 'OpenX',
  caps: ['tool-events', 'openx-chat-organization'],
  sendOrigin: true,
};

export function validateGatewayUrl(input: string): string {
  const value = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GatewaySocketError('Gateway URL is invalid', undefined, 'INVALID_GATEWAY_URL');
  }
  if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') || !parsed.hostname) {
    throw new GatewaySocketError('Gateway URL must use ws:// or wss://', undefined, 'INVALID_GATEWAY_URL');
  }
  if (parsed.username || parsed.password) {
    throw new GatewaySocketError('Gateway URL must not contain credentials', undefined, 'INVALID_GATEWAY_URL');
  }
  if (parsed.hash) throw new GatewaySocketError('Gateway URL must not contain a fragment', undefined, 'INVALID_GATEWAY_URL');
  return value;
}

export function buildGatewayConnectFrame(options: {
  challengeNonce: string;
  credential: GatewayCredential;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  clientVersion?: string;
  profile?: GatewayConnectProfile;
}): { connectId: string; frame: Record<string, unknown> } {
  const connectId = `connect-${crypto.randomUUID()}`;
  const profile = options.profile ?? OPENX_OPERATOR_PROFILE;
  const { role, scopes } = profile;
  const signedAtMs = Date.now();
  const clientId = profile.clientId;
  const clientMode = profile.clientMode;
  const auth = options.credential.mode === 'password'
    ? { password: options.credential.secret }
    : { token: options.credential.secret };

  const device = (() => {
    if (!options.deviceIdentity) return undefined;
    const payload = buildDeviceAuthPayload({
      deviceId: options.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: options.credential.mode === 'token' ? options.credential.secret : null,
      nonce: options.challengeNonce,
    });
    return {
      id: options.deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(options.deviceIdentity.publicKeyPem),
      signature: signDevicePayload(options.deviceIdentity.privateKeyPem, payload),
      signedAt: signedAtMs,
      nonce: options.challengeNonce,
    };
  })();

  return {
    connectId,
    frame: {
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        minProtocol: GATEWAY_PROTOCOL_VERSION,
        maxProtocol: GATEWAY_PROTOCOL_VERSION,
        client: {
          id: clientId,
          displayName: profile.displayName,
          version: options.clientVersion ?? '0.5.3',
          platform: options.platform,
          mode: clientMode,
          ...(profile.deviceFamily ? { deviceFamily: profile.deviceFamily } : {}),
          ...(profile.instanceId ? { instanceId: profile.instanceId } : {}),
        },
        auth,
        caps: profile.caps,
        ...(profile.commands ? { commands: profile.commands } : {}),
        ...(profile.permissions ? { permissions: profile.permissions } : {}),
        ...(profile.pathEnv ? { pathEnv: profile.pathEnv } : {}),
        role,
        scopes,
        device,
      },
    },
  };
}

export async function connectGatewaySocket(options: {
  url: string;
  credential: GatewayCredential;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  clientVersion?: string;
  profile?: GatewayConnectProfile;
  pendingRequests: Map<string, PendingGatewayRequest>;
  onHandshakeComplete: (ws: WebSocket, hello: unknown) => void;
  onMessage: (message: unknown) => void;
  onCloseAfterHandshake: (code: number, reason: string) => void;
  challengeTimeoutMs?: number;
  connectTimeoutMs?: number;
}): Promise<WebSocket> {
  const wsUrl = validateGatewayUrl(options.url);
  const safeUrl = new URL(wsUrl);
  safeUrl.search = '';
  logger.info(`Connecting to remote Gateway (${safeUrl.toString()})`);
  const challengeTimeoutMs = options.challengeTimeoutMs ?? GATEWAY_CHALLENGE_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS;

  return await new Promise<WebSocket>((resolve, reject) => {
    // `webchat` clients are origin-checked by OpenClaw even when they are
    // native applications. Send a stable, non-routable application origin so
    // operators can grant OpenX access without a wildcard policy.
    const ws = options.profile?.sendOrigin === false
      ? new WebSocket(wsUrl)
      : new WebSocket(wsUrl, { origin: OPENX_GATEWAY_ORIGIN });
    let handshakeComplete = false;
    let connectId: string | null = null;
    let challengeTimer: NodeJS.Timeout | null = null;
    let connectTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const cleanup = () => {
      if (challengeTimer) clearTimeout(challengeTimer);
      if (connectTimer) clearTimeout(connectTimer);
      challengeTimer = null;
      connectTimer = null;
      if (connectId) {
        const request = options.pendingRequests.get(connectId);
        if (request) clearTimeout(request.timeout);
        options.pendingRequests.delete(connectId);
      }
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { ws.terminate(); } catch { /* best effort */ }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const sendConnect = (nonce: string) => {
      const payload = buildGatewayConnectFrame({
        challengeNonce: nonce,
        credential: options.credential,
        deviceIdentity: options.deviceIdentity,
        platform: options.platform,
        clientVersion: options.clientVersion,
        profile: options.profile,
      });
      connectId = payload.connectId;
      if (isGatewayWsTraceEnabled()) {
        logger.debug('[gateway-ws-trace] send', {
          summary: summarizeGatewayFrameForTrace(payload.frame),
          frame: redactGatewayFrameForTrace(payload.frame),
        });
      }
      ws.send(JSON.stringify(payload.frame));
      connectTimer = setTimeout(() => {
        rejectOnce(new GatewaySocketError('Gateway authentication timed out'));
      }, connectTimeoutMs);
      options.pendingRequests.set(connectId, {
        resolve: (hello) => {
          if (settled) return;
          handshakeComplete = true;
          settled = true;
          cleanup();
          options.onHandshakeComplete(ws, hello);
          resolve(ws);
        },
        reject: rejectOnce,
        timeout: connectTimer,
      });
    };

    challengeTimer = setTimeout(() => {
      rejectOnce(new GatewaySocketError('Timed out waiting for connect.challenge from Gateway'));
    }, challengeTimeoutMs);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!connectId && message.type === 'event' && message.event === 'connect.challenge') {
          if (challengeTimer) clearTimeout(challengeTimer);
          challengeTimer = null;
          const payload = message.payload as { nonce?: unknown } | undefined;
          if (typeof payload?.nonce !== 'string' || !payload.nonce) {
            rejectOnce(new GatewaySocketError('Gateway connect.challenge is missing a nonce'));
            return;
          }
          sendConnect(payload.nonce);
          return;
        }
        options.onMessage(message);
      } catch (error) {
        logger.debug('Ignored malformed Gateway WebSocket frame:', error);
      }
    });

    ws.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer.toString();
      if (!handshakeComplete) {
        rejectOnce(new GatewaySocketError(
          reason || `Gateway closed the connection before authentication (${code})`,
          code,
        ));
        return;
      }
      cleanup();
      options.onCloseAfterHandshake(code, reason);
    });

    ws.on('error', (error) => {
      if (!handshakeComplete) rejectOnce(error);
    });
  });
}
