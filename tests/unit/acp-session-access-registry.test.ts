import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AcpSessionAccessRegistry } from '../../electron/services/acp-session-access-registry';

const temporaryDirectories: string[] = [];

function createDirectories() {
  const parent = mkdtempSync(join(tmpdir(), 'openx-acp-access-'));
  temporaryDirectories.push(parent);
  const workspaceRoot = join(parent, 'workspace');
  const executionCwd = join(workspaceRoot, 'packages', 'app');
  const outsideCwd = join(parent, 'outside');
  mkdirSync(executionCwd, { recursive: true });
  mkdirSync(outsideCwd);
  return { parent, workspaceRoot, executionCwd, outsideCwd };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AcpSessionAccessRegistry', () => {
  it('preserves remote Gateway workspace paths without checking the desktop filesystem', async () => {
    const registry = new AcpSessionAccessRegistry();
    const { workspaceRoot, executionCwd, outsideCwd } = createDirectories();

    await expect(registry.prepareGrant({
      sessionKey: 'agent:main:session-1',
      generation: 1,
      workspaceRoot: join(workspaceRoot, 'packages', '..'),
      executionCwd: join(executionCwd, '.'),
    })).resolves.toEqual({
      sessionKey: 'agent:main:session-1',
      generation: 1,
      workspaceRoot: join(workspaceRoot, 'packages', '..'),
      executionCwd: join(executionCwd, '.'),
      localAccess: false,
    });

    await expect(registry.prepareGrant({
      sessionKey: 'agent:main:session-1',
      generation: 1,
      workspaceRoot,
      executionCwd: outsideCwd,
    })).resolves.toMatchObject({
      workspaceRoot,
      executionCwd: outsideCwd,
      localAccess: false,
    });
  });

  it('commits access only for the exact session and generation', async () => {
    const registry = new AcpSessionAccessRegistry();
    const { workspaceRoot, executionCwd } = createDirectories();
    const prepared = await registry.prepareGrant({
      sessionKey: 'agent:main:session-1',
      generation: 3,
      workspaceRoot,
      executionCwd,
    });

    expect(registry.get('agent:main:session-1', 3)).toBeNull();
    registry.commitGrant(prepared);

    expect(registry.get('agent:main:session-1', 3)).toEqual(prepared);
    expect(registry.get('agent:main:session-1', 2)).toBeNull();
    expect(registry.get('agent:main:other', 3)).toBeNull();
  });

  it('invalidates the older generation when a later grant is committed', async () => {
    const registry = new AcpSessionAccessRegistry();
    const { workspaceRoot, executionCwd } = createDirectories();
    const first = await registry.prepareGrant({
      sessionKey: 'agent:main:session-1', generation: 1, workspaceRoot, executionCwd,
    });
    const second = await registry.prepareGrant({
      sessionKey: 'agent:main:session-1', generation: 2, workspaceRoot, executionCwd,
    });

    registry.commitGrant(first);
    registry.commitGrant(second);

    expect(registry.get('agent:main:session-1', 1)).toBeNull();
    expect(registry.get('agent:main:session-1', 2)).toEqual(second);
  });

  it('restores a previous snapshot after a failed load', async () => {
    const registry = new AcpSessionAccessRegistry();
    const { workspaceRoot, executionCwd } = createDirectories();
    const previous = await registry.prepareGrant({
      sessionKey: 'agent:main:session-1', generation: 4, workspaceRoot, executionCwd,
    });
    const attempted = await registry.prepareGrant({
      sessionKey: 'agent:main:session-2', generation: 5, workspaceRoot, executionCwd,
    });
    registry.commitGrant(previous);
    const snapshot = registry.snapshot();

    registry.commitGrant(attempted);
    registry.restore(snapshot);

    expect(registry.get('agent:main:session-1', 4)).toEqual(previous);
    expect(registry.get('agent:main:session-2', 5)).toBeNull();
  });

  it('does not accept a replacement workspace root during lookup', () => {
    const registry = new AcpSessionAccessRegistry();

    expect(registry.get.length).toBe(2);
  });
});
