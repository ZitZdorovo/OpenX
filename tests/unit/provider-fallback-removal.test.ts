import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  set: vi.fn((key: string, value: unknown) => storeState.values.set(key, value)),
}));

vi.mock('../../electron/services/providers/store-instance', () => ({
  getOpenXProviderStore: async () => ({
    get: (key: string) => storeState.values.get(key),
    set: storeState.set,
  }),
}));

import { listProviderAccounts } from '../../electron/services/providers/provider-store';

describe('provider fallback removal', () => {
  beforeEach(() => {
    storeState.values.clear();
    storeState.set.mockClear();
  });

  it('removes legacy fallback configuration while loading provider accounts', async () => {
    storeState.values.set('providerAccounts', {
      primary: {
        id: 'primary',
        vendorId: 'openai',
        label: 'Primary',
        authMode: 'api_key',
        model: 'gpt-5.6',
        fallbackModels: ['gpt-5.6-mini'],
        fallbackAccountIds: ['backup'],
        enabled: true,
        isDefault: true,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    });

    const accounts = await listProviderAccounts();

    expect(accounts).toEqual([
      expect.objectContaining({ id: 'primary', model: 'gpt-5.6' }),
    ]);
    expect(accounts[0]).not.toHaveProperty('fallbackModels');
    expect(accounts[0]).not.toHaveProperty('fallbackAccountIds');
    expect(storeState.set).toHaveBeenCalledWith(
      'providerAccounts',
      expect.objectContaining({
        primary: expect.not.objectContaining({
          fallbackModels: expect.anything(),
          fallbackAccountIds: expect.anything(),
        }),
      }),
    );
  });
});
