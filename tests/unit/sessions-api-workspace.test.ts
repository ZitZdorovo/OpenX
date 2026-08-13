// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const isConnected = vi.fn();

async function createApi() {
  const { createSessionsApi } = await import('@electron/services/sessions-api');
  return createSessionsApi({ rpc, isConnected } as never);
}

describe('remote sessions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isConnected.mockReturnValue(true);
  });

  it('maps remote session summaries and filters them by requested key', async () => {
    rpc.mockResolvedValueOnce({
      sessions: [
        {
          key: 'agent:main:session-a',
          label: 'Remote session',
          updatedAt: '2026-08-13T12:00:00.000Z',
          cwd: '/srv/openx/project-a',
        },
        { key: 'agent:main:session-b', label: 'Other session' },
        { label: 'Invalid session without a key' },
      ],
    });
    const api = await createApi();

    await expect(api.summaries({ sessionKeys: ['agent:main:session-a'] })).resolves.toEqual({
      success: true,
      summaries: [{
        sessionKey: 'agent:main:session-a',
        firstUserText: 'Remote session',
        lastTimestamp: Date.parse('2026-08-13T12:00:00.000Z'),
        workspacePath: '/srv/openx/project-a',
      }],
    });
    expect(rpc).toHaveBeenCalledWith('sessions.list', { limit: 1 });
  });

  it('accepts the remote workspace field when cwd is unavailable', async () => {
    rpc.mockResolvedValueOnce({
      sessions: [{
        key: 'agent:main:session-a',
        updatedAt: 42,
        workspace: '/srv/openx/project-b',
      }],
    });
    const api = await createApi();

    await expect(api.summaries({})).resolves.toEqual({
      success: true,
      summaries: [{
        sessionKey: 'agent:main:session-a',
        firstUserText: null,
        lastTimestamp: 42,
        workspacePath: '/srv/openx/project-b',
      }],
    });
    expect(rpc).toHaveBeenCalledWith('sessions.list', { limit: 200 });
  });

  it('loads history only through the remote Gateway', async () => {
    const messages = [{ role: 'assistant', content: 'Remote history' }];
    rpc.mockResolvedValueOnce({ messages });
    const api = await createApi();

    await expect(api.history({
      sessionKey: ' agent:main:session-a ',
      limit: 5,
    })).resolves.toEqual({ success: true, messages });
    expect(rpc).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'agent:main:session-a',
      limit: 5,
    });
  });

  it('builds a history key from an agent and session id', async () => {
    rpc.mockResolvedValueOnce({});
    const api = await createApi();

    await expect(api.history({ agentId: 'main', sessionId: 'session-a' }))
      .resolves.toEqual({ success: true, messages: [] });
    expect(rpc).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'agent:main:session-a',
      limit: 200,
    });
  });

  it('does not fabricate local turn timings while disconnected', async () => {
    isConnected.mockReturnValue(false);
    const api = await createApi();

    await expect(api.turnTimings({ sessionKey: 'agent:main:session-a' }))
      .resolves.toEqual({ success: false, error: 'Gateway not connected' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
