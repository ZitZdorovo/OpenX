import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type { ProviderUsageSnapshot } from '@shared/host-api/contract';

interface ProviderUsageState {
  providers: ProviderUsageSnapshot[];
  loading: boolean;
  updatedAt: number | null;
  refresh: (providerKey?: string, forceRefresh?: boolean, modelRef?: string) => Promise<void>;
}

const inFlightRefreshes = new Map<string, Promise<void>>();

export const useProviderUsageStore = create<ProviderUsageState>((set) => ({
  providers: [],
  loading: false,
  updatedAt: null,
  refresh: async (providerKey, forceRefresh = false, modelRef) => {
    const refreshKey = `${providerKey ?? ''}:${modelRef ?? ''}:${forceRefresh ? 'force' : 'cached'}`;
    const inFlight = inFlightRefreshes.get(refreshKey);
    if (inFlight) return inFlight;

    set({ loading: true });
    const request = (async () => {
      try {
        const result = await hostApi.usage.providerLimits({ providerKey, forceRefresh, modelRef });
        set((state) => {
          const incoming = Array.isArray(result.providers) ? result.providers : [];
          const providers = incoming.map((snapshot) => {
            if (!snapshot.error || snapshot.windows.length > 0) return snapshot;
            const previous = state.providers.find((entry) => (
              entry.provider.toLowerCase() === snapshot.provider.toLowerCase()
              && entry.windows.length > 0
            ));
            return previous
              ? { ...previous, error: snapshot.error, summary: snapshot.summary }
              : snapshot;
          });
          return {
            providers,
            updatedAt: typeof result.updatedAt === 'number' ? result.updatedAt : Date.now(),
            loading: false,
          };
        });
      } catch {
        // Keep the last valid snapshot during a transient transport failure.
        set({ updatedAt: Date.now(), loading: false });
      } finally {
        inFlightRefreshes.delete(refreshKey);
      }
    })();
    inFlightRefreshes.set(refreshKey, request);
    return request;
  },
}));
