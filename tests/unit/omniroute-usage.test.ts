import { describe, expect, it, vi } from 'vitest';
import { normalizeOmniRouteProviderLimits } from '../../electron/services/omniroute-usage';

describe('OmniRoute provider limits', () => {
  it('maps Codex session and weekly quotas to remaining percentages', () => {
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    const result = normalizeOmniRouteProviderLimits(
      {
        caches: {
          'connection-1': {
            plan: 'plus',
            fetchedAt: '2026-08-11T10:00:00.000Z',
            quotas: {
              session: { used: 23, total: 100, remaining: 77, resetAt },
              weekly: { used: 64, total: 100, remainingPercentage: 36, resetAt },
            },
          },
        },
      },
      {
        connections: [{ id: 'connection-1', provider: 'codex', name: 'Work account' }],
      },
      'custom-omniroute',
    );

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({
      provider: 'custom-omniroute',
      displayName: 'OmniRoute',
      plan: 'plus',
    });
    expect(result.providers[0]?.windows).toEqual([
      expect.objectContaining({ label: 'session', usedPercent: 23, accountName: 'Work account', accountProvider: 'codex' }),
      expect.objectContaining({ label: 'weekly', usedPercent: 64, accountName: 'Work account', accountProvider: 'codex' }),
    ]);
  });

  it('treats a stale reset as a fully replenished window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:00.000Z'));
    try {
      const result = normalizeOmniRouteProviderLimits({
        caches: {
          old: {
            quotas: {
              session: {
                used: 100,
                total: 100,
                resetAt: '2026-08-11T11:00:00.000Z',
              },
            },
          },
        },
      }, { connections: [{ id: 'old', provider: 'codex', name: 'Old account' }] });

      expect(result.providers[0]?.windows[0]?.usedPercent).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not invent quota windows when OmniRoute has no numeric usage data', () => {
    const result = normalizeOmniRouteProviderLimits({
      caches: {
        empty: { quotas: { session: { resetAt: null } } },
      },
    }, { connections: [] });

    expect(result.providers).toEqual([]);
  });

  it('drops cached limits for connections that no longer exist', () => {
    const result = normalizeOmniRouteProviderLimits({
      caches: {
        'deleted-connection-id': {
          quotas: { weekly: { used: 10, total: 100 } },
        },
      },
    }, { connections: [] });

    expect(result.providers).toEqual([]);
  });

  it('does not substitute an internal id when an active connection has no display name', () => {
    const result = normalizeOmniRouteProviderLimits({
      caches: {
        'active-connection-id': {
          quotas: { weekly: { used: 10, total: 100 } },
        },
      },
    }, { connections: [{ id: 'active-connection-id', provider: 'codex' }] });

    expect(result.providers[0]?.windows[0]).toMatchObject({
      accountId: 'active-connection-id',
      accountProvider: 'codex',
    });
    expect(result.providers[0]?.windows[0]?.accountName).toBeUndefined();
  });

  it('preserves 5-hour and weekly periods and selects the latest active connection', () => {
    const result = normalizeOmniRouteProviderLimits({
      caches: {
        active: {
          quotas: {
            'gemini-3.6-flash-low': { used: 20, total: 100, resetAt: '2026-08-11T20:00:00.000Z' },
            gemini_weekly: { displayName: 'Gemini Models', used: 30, total: 100, resetAt: '2026-08-18T20:00:00.000Z' },
          },
        },
        idle: {
          quotas: {
            'gemini-3.6-flash-low': { used: 5, total: 100, resetAt: '2026-08-11T20:00:00.000Z' },
          },
        },
      },
    }, {
      connections: [
        { id: 'active', provider: 'agy', name: 'active@example.com' },
        { id: 'idle', provider: 'agy', name: 'idle@example.com' },
      ],
    }, 'custom-omniroute', [
      { connectionId: 'active', model: 'gemini-3.6-flash-low', status: 200 },
    ], 'custom-omniroute/agy/gemini-3.6-flash-low');

    expect(result.providers[0]).toMatchObject({
      activeAccountId: 'active',
      activeAccountName: 'active@example.com',
    });
    expect(result.providers[0]?.windows).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: 'active', label: 'gemini-3.6-flash-low', period: 'five_hour' }),
      expect.objectContaining({ accountId: 'active', label: 'Gemini Models', period: 'weekly' }),
    ]));
  });
});
