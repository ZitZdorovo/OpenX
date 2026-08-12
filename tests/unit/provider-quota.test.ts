import { describe, expect, it } from 'vitest';
import {
  groupProviderQuotaWindows,
  providerQuotaFamily,
  selectProviderQuotaWindows,
} from '@/lib/provider-quota';
import type { ProviderUsageWindow } from '@shared/host-api/contract';

const windows: ProviderUsageWindow[] = [
  { label: 'gemini-3.6-flash-high', usedPercent: 10, accountId: 'g1', accountName: 'gemini@example.com', accountProvider: 'antigravity' },
  { label: 'gemini-pro-agent', usedPercent: 25, accountId: 'g1', accountName: 'gemini@example.com', accountProvider: 'antigravity' },
  { label: 'gpt-oss-120b-medium', usedPercent: 30, accountId: 'g1', accountName: 'gemini@example.com', accountProvider: 'antigravity' },
  { label: 'session', usedPercent: 20, accountId: 'c1', accountName: 'chatgpt@example.com', accountProvider: 'codex' },
  { label: 'weekly', usedPercent: 55, accountId: 'c1', accountName: 'chatgpt@example.com', accountProvider: 'codex' },
];

describe('provider quota selection', () => {
  it('collapses Gemini model quotas into one shared account pool', () => {
    const selected = selectProviderQuotaWindows(
      windows,
      'custom/agy/gemini-pro-agent',
      'custom-omniroute',
      true,
    );

    expect(providerQuotaFamily('custom/agy/gemini-pro-agent')).toBe('gemini');
    expect(selected).toEqual([
      expect.objectContaining({ label: 'account-shared', usedPercent: 25, accountName: 'gemini@example.com' }),
    ]);
  });

  it('keeps Claude model quotas separate from the Gemini pool', () => {
    const selected = selectProviderQuotaWindows([
      ...windows,
      { label: 'claude-sonnet-4-6', usedPercent: 35, accountId: 'g1', accountName: 'gemini@example.com', accountProvider: 'antigravity' },
    ], 'custom/agy/claude-sonnet-4-6', 'custom-omniroute', true);

    expect(selected).toEqual([
      expect.objectContaining({ label: 'account-shared', usedPercent: 35 }),
    ]);
  });

  it('keeps only the primary Claude 5-hour and weekly account windows', () => {
    const selected = selectProviderQuotaWindows([
      { label: 'session (5h)', period: 'five_hour', usedPercent: 20, accountId: 'c1', accountProvider: 'claude' },
      { label: 'weekly (7d)', period: 'weekly', usedPercent: 30, accountId: 'c1', accountProvider: 'claude' },
      { label: 'weekly designer (7d)', period: 'weekly', usedPercent: 90, accountId: 'c1', accountProvider: 'claude' },
    ], 'cc/claude-opus-4-6', 'custom-omniroute', true);

    expect(selected.map((entry) => entry.label)).toEqual(['session (5h)', 'weekly (7d)']);
  });

  it('keeps ChatGPT account-wide session and weekly windows', () => {
    const selected = selectProviderQuotaWindows(windows, 'cx/gpt-5.5', 'custom-omniroute', true);
    expect(providerQuotaFamily('cx/gpt-5.5')).toBe('chatgpt');
    expect(selected.map((entry) => entry.label)).toEqual(['session', 'weekly']);
  });

  it('groups duplicate connections with the same account name and quota', () => {
    const groups = groupProviderQuotaWindows([
      { label: 'weekly', usedPercent: 50, resetAt: 1, accountId: 'one', accountName: 'same@example.com' },
      { label: 'weekly', usedPercent: 40, resetAt: 2, accountId: 'two', accountName: 'same@example.com' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.windows).toEqual([expect.objectContaining({ usedPercent: 40, resetAt: 2 })]);
  });
});
