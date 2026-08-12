// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mutateOpenClawConfig,
  readOpenClawConfigSnapshot,
  registerOpenClawConfigCoordinator,
  reloadOpenClawSecretsIfRunning,
  resetOpenClawConfigCoordinatorForTests,
} from '@electron/gateway/config-delivery';

function createGatewayManager(state: 'running' | 'stopped' = 'running') {
  return {
    getStatus: vi.fn(() => ({ state })),
    rpc: vi.fn(),
  };
}

describe('remote OpenClaw config delivery', () => {
  beforeEach(() => {
    resetOpenClawConfigCoordinatorForTests();
  });

  it('reads configuration only through the connected Gateway', async () => {
    const manager = createGatewayManager();
    manager.rpc.mockResolvedValueOnce({ config: { remote: true }, hash: 'hash-1' });
    registerOpenClawConfigCoordinator(manager);

    await expect(readOpenClawConfigSnapshot()).resolves.toEqual({
      config: { remote: true },
      exists: true,
    });
    expect(manager.rpc).toHaveBeenCalledWith('config.get', {});
  });

  it('does not fall back to a local config while disconnected', async () => {
    registerOpenClawConfigCoordinator(createGatewayManager('stopped'));
    await expect(readOpenClawConfigSnapshot()).rejects.toThrow('Remote Gateway is not connected');
    await expect(mutateOpenClawConfig(() => undefined)).rejects.toThrow('Remote Gateway is not connected');
  });

  it('commits changed snapshots with compare-and-swap hashes', async () => {
    const manager = createGatewayManager();
    manager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') return { raw: '{ enabled: false }', hash: 'hash-1' };
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(manager);

    await expect(mutateOpenClawConfig((config) => {
      config.enabled = true;
    })).resolves.toBe(true);

    expect(manager.rpc).toHaveBeenNthCalledWith(2, 'config.set', {
      raw: '{\n  "enabled": true\n}\n',
      baseHash: 'hash-1',
    });
  });

  it('does not issue config.set for a no-op mutation', async () => {
    const manager = createGatewayManager();
    manager.rpc.mockResolvedValueOnce({ config: { enabled: true }, hash: 'hash-1' });
    registerOpenClawConfigCoordinator(manager);

    await expect(mutateOpenClawConfig((config) => {
      config.enabled = true;
    })).resolves.toBe(false);
    expect(manager.rpc).toHaveBeenCalledOnce();
  });

  it('retries one remote base-hash conflict from a fresh snapshot', async () => {
    const manager = createGatewayManager();
    manager.rpc
      .mockResolvedValueOnce({ config: { value: 1 }, hash: 'hash-1' })
      .mockRejectedValueOnce(new Error('config changed since last load; re-run config.get and retry'))
      .mockResolvedValueOnce({ config: { value: 4 }, hash: 'hash-2' })
      .mockResolvedValueOnce({ ok: true });
    registerOpenClawConfigCoordinator(manager);

    await mutateOpenClawConfig((config) => {
      config.value = Number(config.value) + 1;
    });

    expect(manager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'config.set',
      'config.get',
      'config.set',
    ]);
    expect(manager.rpc.mock.calls[3][1]).toMatchObject({ baseHash: 'hash-2' });
  });

  it('serializes concurrent remote mutations', async () => {
    const manager = createGatewayManager();
    let config: Record<string, unknown> = {};
    let hash = 'hash-1';
    manager.rpc.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'config.get') return { config, hash };
      if (method === 'config.set') {
        config = JSON.parse((params as { raw: string }).raw) as Record<string, unknown>;
        hash = `${hash}-next`;
        return { ok: true };
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(manager);

    await Promise.all([
      mutateOpenClawConfig((current) => { current.first = true; }),
      mutateOpenClawConfig((current) => { current.second = true; }),
    ]);
    expect(config).toEqual({ first: true, second: true });
  });

  it('supports nested mutations on the same remote snapshot', async () => {
    const manager = createGatewayManager();
    manager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') return { config: {}, hash: 'hash-1' };
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(manager);

    await mutateOpenClawConfig(async (config) => {
      config.outer = true;
      await mutateOpenClawConfig((sameConfig) => {
        expect(sameConfig).toBe(config);
        sameConfig.inner = true;
      });
    });

    expect(JSON.parse((manager.rpc.mock.calls[1][1] as { raw: string }).raw)).toEqual({
      outer: true,
      inner: true,
    });
  });

  it('reloads secrets only through a running Gateway', async () => {
    const manager = createGatewayManager();
    manager.rpc.mockResolvedValueOnce({ ok: true });
    registerOpenClawConfigCoordinator(manager);
    await expect(reloadOpenClawSecretsIfRunning()).resolves.toBe(true);
    expect(manager.rpc).toHaveBeenCalledWith('secrets.reload', {});

    registerOpenClawConfigCoordinator(createGatewayManager('stopped'));
    await expect(reloadOpenClawSecretsIfRunning()).resolves.toBe(false);
  });
});
