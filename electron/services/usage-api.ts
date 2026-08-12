import type {
  ProviderLimitsResult,
  ProviderUsageSnapshot,
} from '../../shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { isRecord } from './payload-utils';
import {
  deleteOmniRouteCredential,
  getOmniRouteConfig,
  getOmniRouteCredential,
  setOmniRouteCredential,
  updateOmniRouteBaseUrl,
} from './secrets/omniroute-credential-store';
import {
  fetchOmniRouteProviderLimits,
  normalizeOmniRouteBaseUrl,
} from './omniroute-usage';

type RecentTokenHistoryPayload = {
  limit?: unknown;
};

function getSafeLimit(payload: unknown): number {
  const value = isRecord(payload) ? (payload as RecentTokenHistoryPayload).limit : payload;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(Math.floor(value), 1);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(Math.floor(parsed), 1);
  }
  return 100;
}

function numberFrom(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function stringFrom(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeGatewayUsageResult(value: unknown): ProviderLimitsResult {
  if (!isRecord(value)) return { updatedAt: Date.now(), providers: [] };
  const providers = Array.isArray(value.providers)
    ? value.providers.filter((entry): entry is ProviderUsageSnapshot => (
      isRecord(entry)
      && typeof entry.provider === 'string'
      && Array.isArray(entry.windows)
    ))
    : [];
  return {
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : Date.now(),
    providers,
  };
}

function mergeProviderLimits(
  gateway: ProviderLimitsResult,
  omniRoute: ProviderLimitsResult,
): ProviderLimitsResult {
  const byProvider = new Map<string, ProviderUsageSnapshot>();
  for (const snapshot of gateway.providers) {
    byProvider.set(snapshot.provider.toLowerCase(), snapshot);
  }
  for (const snapshot of omniRoute.providers) {
    const key = snapshot.provider.toLowerCase();
    const existing = byProvider.get(key);
    byProvider.set(key, existing
      ? {
        ...existing,
        ...snapshot,
        windows: [...snapshot.windows, ...existing.windows],
        billing: snapshot.billing ?? existing.billing,
      }
      : snapshot);
  }
  return {
    updatedAt: Math.max(gateway.updatedAt, omniRoute.updatedAt),
    providers: Array.from(byProvider.values()),
  };
}

/** Token history is projected exclusively from the connected Gateway catalog. */
export function createUsageApi(gatewayManager: GatewayManager): CompleteHostServiceRegistry['usage'] {
  return {
    recentTokenHistory: async (payload) => {
      const limit = getSafeLimit(payload);
      const response = await gatewayManager.rpc<{ sessions?: unknown[] }>('sessions.list', { limit });
      const rows = Array.isArray(response.sessions) ? response.sessions : [];
      return rows.flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        const usage = isRecord(candidate.usage) ? candidate.usage : candidate;
        const inputTokens = numberFrom(usage, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens', 'input') ?? 0;
        const outputTokens = numberFrom(usage, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens', 'output') ?? 0;
        const cacheReadTokens = numberFrom(usage, 'cacheReadTokens', 'cache_read_tokens', 'cacheRead', 'cache_read') ?? 0;
        const cacheWriteTokens = numberFrom(usage, 'cacheWriteTokens', 'cache_write_tokens', 'cacheWrite', 'cache_write') ?? 0;
        const totalTokens = numberFrom(usage, 'totalTokens', 'total_tokens', 'total', 'used')
          ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
        const sessionKey = stringFrom(candidate, 'key', 'sessionKey') ?? '';
        const keyParts = sessionKey.split(':');
        const sessionId = stringFrom(candidate, 'sessionId', 'id') ?? (keyParts.slice(2).join(':') || sessionKey);
        const agentId = stringFrom(candidate, 'agentId') ?? keyParts[1] ?? 'main';
        const timestampValue = candidate.updatedAt ?? candidate.createdAt;
        const timestamp = typeof timestampValue === 'number'
          ? new Date(timestampValue).toISOString()
          : typeof timestampValue === 'string' && !Number.isNaN(Date.parse(timestampValue))
            ? new Date(timestampValue).toISOString()
            : new Date(0).toISOString();
        const costRecord = isRecord(usage.cost) ? usage.cost : {};
        const costUsd = numberFrom(usage, 'costUsd', 'cost_usd', 'estimatedCostUsd')
          ?? numberFrom(costRecord, 'total', 'totalUsd', 'total_usd');
        const hasUsage = totalTokens > 0 || costUsd !== undefined;
        return [{
          timestamp,
          sessionId,
          agentId,
          model: stringFrom(candidate, 'model', 'modelRef'),
          provider: stringFrom(candidate, 'provider'),
          usageStatus: hasUsage ? 'available' as const : 'missing' as const,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          totalTokens,
          ...(costUsd !== undefined ? { costUsd } : {}),
        }];
      }).slice(0, limit);
    },
    providerLimits: async (payload) => {
      const gatewayResultPromise = (async (): Promise<ProviderLimitsResult> => {
        try {
          return normalizeGatewayUsageResult(
            await gatewayManager.rpc('usage.status', {}, 3_000),
          );
        } catch {
          // Older Gateways may not expose usage.status. OmniRoute remains available below.
          return { updatedAt: Date.now(), providers: [] };
        }
      })();

      const credential = await getOmniRouteCredential();
      if (!credential) return gatewayResultPromise;
      const providerKey = typeof payload?.providerKey === 'string'
        ? payload.providerKey.trim()
        : '';
      const modelRef = typeof payload?.modelRef === 'string'
        ? payload.modelRef.trim()
        : '';
      const omniRouteResultPromise = (async (): Promise<ProviderLimitsResult> => {
        try {
          return await fetchOmniRouteProviderLimits({
            ...credential,
            ...(providerKey ? { providerKey } : {}),
            ...(modelRef ? { modelRef } : {}),
            forceRefresh: payload?.forceRefresh === true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            updatedAt: Date.now(),
            providers: [{
              provider: providerKey || 'omniroute',
              displayName: 'OmniRoute',
              windows: [],
              error: message,
              summary: message,
            }],
          };
        }
      })();

      const [gatewayResult, omniRouteResult] = await Promise.all([
        gatewayResultPromise,
        omniRouteResultPromise,
      ]);
      return mergeProviderLimits(gatewayResult, omniRouteResult);
    },
    omniRouteConfig: () => getOmniRouteConfig(),
    configureOmniRoute: async (payload) => {
      try {
        if (payload.clearToken === true) {
          await deleteOmniRouteCredential();
          return { success: true, baseUrl: '', configured: false };
        }
        const baseUrl = normalizeOmniRouteBaseUrl(payload.baseUrl);
        const incomingToken = payload.managementToken?.trim();
        const existing = await getOmniRouteCredential();
        const managementToken = incomingToken || existing?.managementToken;
        if (!managementToken) throw new Error('OmniRoute management token is required');

        await fetchOmniRouteProviderLimits({
          baseUrl,
          managementToken,
          forceRefresh: false,
        });
        if (incomingToken) await setOmniRouteCredential(baseUrl, incomingToken);
        else await updateOmniRouteBaseUrl(baseUrl);
        return { success: true, baseUrl, configured: true };
      } catch (error) {
        const config = await getOmniRouteConfig();
        return {
          success: false,
          ...config,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
