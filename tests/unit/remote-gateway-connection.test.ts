// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  buildGatewayConnectFrame,
  connectGatewaySocket,
  OPENX_GATEWAY_ORIGIN,
  validateGatewayUrl,
} from '@electron/gateway/ws-client';

describe('remote Gateway connection contract', () => {
  it('uses a stable, explicit Origin that can be allowlisted without a wildcard', () => {
    expect(OPENX_GATEWAY_ORIGIN).toBe('https://openx.invalid');
  });

  it('sends the allowlisted OpenX Origin in the WebSocket upgrade request', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string') throw new Error('Expected an internet socket');
    const receivedOrigin = new Promise<string | undefined>((resolve) => {
      server.once('connection', (socket, request) => {
        resolve(request.headers.origin);
        socket.close(1000, 'test complete');
      });
    });

    const connection = connectGatewaySocket({
      url: `ws://127.0.0.1:${address.port}`,
      credential: { mode: 'token', secret: 'test-token' },
      deviceIdentity: null,
      platform: 'win32',
      pendingRequests: new Map(),
      onHandshakeComplete: () => {},
      onMessage: () => {},
      onCloseAfterHandshake: () => {},
      challengeTimeoutMs: 1_000,
      connectTimeoutMs: 1_000,
    });

    await expect(receivedOrigin).resolves.toBe(OPENX_GATEWAY_ORIGIN);
    await expect(connection).rejects.toThrow();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('keeps the persistent node outside the Control UI Origin policy', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string') throw new Error('Expected an internet socket');
    const receivedOrigin = new Promise<string | undefined>((resolve) => {
      server.once('connection', (socket, request) => {
        resolve(request.headers.origin);
        socket.close(1000, 'test complete');
      });
    });

    const connection = connectGatewaySocket({
      url: `ws://127.0.0.1:${address.port}`,
      credential: { mode: 'token', secret: 'test-token' },
      deviceIdentity: null,
      platform: 'windows',
      profile: {
        role: 'node',
        scopes: [],
        clientId: 'node-host',
        clientMode: 'node',
        displayName: 'OpenX node',
        caps: ['system', 'openx-client'],
        commands: ['device.info'],
        sendOrigin: false,
      },
      pendingRequests: new Map(),
      onHandshakeComplete: () => {},
      onMessage: () => {},
      onCloseAfterHandshake: () => {},
      challengeTimeoutMs: 1_000,
      connectTimeoutMs: 1_000,
    });

    await expect(receivedOrigin).resolves.toBeUndefined();
    await expect(connection).rejects.toThrow();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('accepts only credential-free ws endpoints and preserves the endpoint', () => {
    expect(validateGatewayUrl('wss://gateway.example.test/openclaw')).toBe('wss://gateway.example.test/openclaw');
    expect(() => validateGatewayUrl('https://gateway.example.test')).toThrow(/ws:\/\/ or wss:\/\//);
    expect(() => validateGatewayUrl('wss://token@gateway.example.test')).toThrow(/must not contain credentials/);
  });

  it.each([
    ['token', { token: 'secret-token' }, 'password'],
    ['password', { password: 'secret-password' }, 'token'],
  ] as const)('sends exactly one %s credential field', (mode, expectedAuth, absentKey) => {
    const { frame } = buildGatewayConnectFrame({
      challengeNonce: 'challenge-123',
      credential: { mode, secret: Object.values(expectedAuth)[0] },
      deviceIdentity: null,
      platform: 'win32',
      clientVersion: 'test',
    });
    const params = frame.params as Record<string, unknown>;
    expect(params.auth).toEqual(expectedAuth);
    expect(params.auth).not.toHaveProperty(absentKey);
    expect(params).toMatchObject({ minProtocol: 4, maxProtocol: 4, role: 'operator' });
  });

  it('builds the official node-host handshake for the OpenX remote-control bridge', () => {
    const { frame } = buildGatewayConnectFrame({
      challengeNonce: 'node-challenge',
      credential: { mode: 'token', secret: 'node-token' },
      deviceIdentity: null,
      platform: 'windows',
      clientVersion: 'test',
      profile: {
        role: 'node',
        scopes: [],
        clientId: 'node-host',
        clientMode: 'node',
        displayName: 'OpenX — workstation',
        caps: ['system', 'openx-client'],
        commands: ['device.info', 'openx.app.focus'],
        instanceId: 'openx-device-id',
        deviceFamily: 'Windows',
        sendOrigin: false,
      },
    });
    const params = frame.params as Record<string, unknown>;
    expect(params).toMatchObject({
      role: 'node',
      scopes: [],
      caps: ['system', 'openx-client'],
      commands: ['device.info', 'openx.app.focus'],
      client: {
        id: 'node-host',
        displayName: 'OpenX — workstation',
        platform: 'windows',
        mode: 'node',
        instanceId: 'openx-device-id',
        deviceFamily: 'Windows',
      },
    });
  });
});
