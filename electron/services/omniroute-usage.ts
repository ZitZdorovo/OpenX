import type {
  ProviderLimitsResult,
  ProviderUsageSnapshot,
  ProviderUsageWindow,
} from '../../shared/host-api/contract';
import { proxyAwareFetch } from '../utils/proxy-fetch';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBaseUrl(input: string): string {
  const candidate = input.trim();
  if (!candidate) throw new Error('OmniRoute URL is required');
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OmniRoute URL must use http:// or https://');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname
    .replace(/\/(?:v1|api\/usage\/provider-limits)\/?$/i, '')
    .replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function parseTimestamp(value: unknown): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric !== undefined) {
    const milliseconds = numeric < 1e12 ? numeric * 1_000 : numeric;
    return milliseconds > 0 ? milliseconds : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function quotaUsedPercent(quota: JsonRecord, resetAt: number | undefined): number | undefined {
  if (resetAt !== undefined && resetAt <= Date.now()) return 0;
  const remainingPercentage = finiteNumber(quota.remainingPercentage);
  if (remainingPercentage !== undefined) {
    return Math.min(100, Math.max(0, 100 - remainingPercentage));
  }

  const used = finiteNumber(quota.used);
  const total = finiteNumber(quota.total);
  if (used !== undefined && total !== undefined && total > 0) {
    return Math.min(100, Math.max(0, (used / total) * 100));
  }

  const remaining = finiteNumber(quota.remaining);
  if (remaining !== undefined && total !== undefined && total > 0) {
    return Math.min(100, Math.max(0, 100 - (remaining / total) * 100));
  }
  return undefined;
}

function quotaOrder(label: string): number {
  const normalized = label.toLowerCase();
  if (normalized === 'session' || normalized.includes('5h')) return 0;
  if (normalized === 'weekly' || normalized.includes('7d')) return 1;
  return 2;
}

function quotaPeriod(
  quotaKey: string,
  displayName: string | undefined,
  provider: string | undefined,
): ProviderUsageWindow['period'] {
  const value = `${quotaKey} ${displayName ?? ''}`.toLowerCase();
  if (value.includes('weekly') || value.includes('7d') || value.includes('seven_day')) return 'weekly';
  if (value.includes('monthly')) return 'monthly';
  if (value.includes('session') || value.includes('5h') || value.includes('five_hour')) return 'five_hour';
  if (provider === 'agy' || provider === 'antigravity') return 'five_hour';
  return undefined;
}

function connectionMetadata(payload: unknown): Map<string, { name?: string; provider?: string }> {
  const body = asRecord(payload);
  const connections = Array.isArray(body.connections) ? body.connections : [];
  const result = new Map<string, { name?: string; provider?: string }>();
  for (const candidate of connections) {
    const row = asRecord(candidate);
    const id = nonEmptyString(row.id);
    if (!id) continue;
    result.set(id, {
      name: nonEmptyString(row.name) ?? nonEmptyString(row.email),
      provider: nonEmptyString(row.provider),
    });
  }
  return result;
}

function normalizedModelId(value: string): string {
  return value
    .split('/')
    .at(-1)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') ?? '';
}

function activeConnection(
  payload: unknown,
  metadata: Map<string, { name?: string; provider?: string }>,
  modelRef: string | undefined,
): { id: string; name?: string } | undefined {
  if (!modelRef || !Array.isArray(payload)) return undefined;
  const expectedModel = normalizedModelId(modelRef);
  for (const candidate of payload) {
    const row = asRecord(candidate);
    const connectionId = nonEmptyString(row.connectionId);
    if (!connectionId || !metadata.has(connectionId)) continue;
    const status = finiteNumber(row.status);
    if (row.active !== true && (status === undefined || status < 200 || status >= 300)) continue;
    const actualModels = [nonEmptyString(row.requestedModel), nonEmptyString(row.model)]
      .filter((value): value is string => Boolean(value))
      .map(normalizedModelId);
    if (expectedModel && !actualModels.some((value) => value === expectedModel)) continue;
    const account = metadata.get(connectionId);
    return {
      id: connectionId,
      ...(account?.name ? { name: account.name } : {}),
    };
  }
  return undefined;
}

export function normalizeOmniRouteProviderLimits(
  limitsPayload: unknown,
  providersPayload: unknown,
  providerKey = 'omniroute',
  callLogsPayload?: unknown,
  modelRef?: string,
): ProviderLimitsResult {
  const body = asRecord(limitsPayload);
  const caches = asRecord(body.caches);
  const metadata = connectionMetadata(providersPayload);
  const windows: ProviderUsageWindow[] = [];
  const plans = new Set<string>();
  let updatedAt = 0;

  for (const [connectionId, cacheValue] of Object.entries(caches)) {
    const cache = asRecord(cacheValue);
    const fetchedAt = parseTimestamp(cache.fetchedAt);
    if (fetchedAt !== undefined) updatedAt = Math.max(updatedAt, fetchedAt);
    const plan = nonEmptyString(cache.plan);
    if (plan && plan.toLowerCase() !== 'unknown') plans.add(plan);
    const account = metadata.get(connectionId);
    // OmniRoute may retain cached limits after a provider connection is deleted.
    // Never expose an orphaned internal connection id as if it were an account name.
    if (!account) continue;
    const quotas = asRecord(cache.quotas);

    for (const [quotaKey, quotaValue] of Object.entries(quotas)) {
      const quota = asRecord(quotaValue);
      if (quota.unlimited === true) continue;
      const resetAt = parseTimestamp(quota.resetAt);
      const usedPercent = quotaUsedPercent(quota, resetAt);
      if (usedPercent === undefined) continue;
      const displayName = nonEmptyString(quota.displayName);
      const period = quotaPeriod(quotaKey, displayName, account.provider);
      windows.push({
        label: displayName ?? quotaKey,
        usedPercent,
        ...(period ? { period } : {}),
        ...(resetAt !== undefined ? { resetAt } : {}),
        accountId: connectionId,
        ...(account.name ? { accountName: account.name } : {}),
        ...(account.provider ? { accountProvider: account.provider } : {}),
      });
    }
  }

  windows.sort((left, right) => {
    const accountOrder = (left.accountName ?? '').localeCompare(right.accountName ?? '');
    return accountOrder || quotaOrder(left.label) - quotaOrder(right.label) || left.label.localeCompare(right.label);
  });

  if (updatedAt === 0) updatedAt = Date.now();
  if (windows.length === 0) return { updatedAt, providers: [] };
  const active = activeConnection(callLogsPayload, metadata, modelRef);
  const snapshot: ProviderUsageSnapshot = {
    provider: providerKey,
    displayName: 'OmniRoute',
    windows,
    ...(active ? {
      activeAccountId: active.id,
      ...(active.name ? { activeAccountName: active.name } : {}),
    } : {}),
    ...(plans.size > 0 ? { plan: Array.from(plans).join(', ') } : {}),
  };
  return { updatedAt, providers: [snapshot] };
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    const suffix = text.trim() ? `: ${text.slice(0, 240)}` : '';
    if (response.status === 401 || response.status === 403) {
      throw new Error(`OmniRoute management authentication failed${suffix}`);
    }
    throw new Error(`OmniRoute returned HTTP ${response.status}${suffix}`);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('OmniRoute returned invalid JSON');
  }
}

async function readEndpoint(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await readResponse(await proxyAwareFetch(url, {
      ...init,
      signal: controller.signal,
    }));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`OmniRoute ${label} request timed out`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOmniRouteProviderLimits(input: {
  baseUrl: string;
  managementToken: string;
  providerKey?: string;
  modelRef?: string;
  forceRefresh?: boolean;
}): Promise<ProviderLimitsResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${input.managementToken}`,
  };
  const requestInit = { headers, redirect: 'error' as const };
  const limitsUrl = `${baseUrl}/api/usage/provider-limits`;
  const modelId = input.modelRef ? input.modelRef.split('/').at(-1)?.trim() : undefined;

  const limitsPromise = readEndpoint(
    limitsUrl,
    { ...requestInit, method: input.forceRefresh ? 'POST' : 'GET' },
    input.forceRefresh ? 45_000 : 20_000,
    'provider limits',
  ).catch(async (error: unknown) => {
    // A forced refresh may wait on slow upstream quota APIs. Preserve the last
    // successful OmniRoute cache instead of blanking the whole limits panel.
    if (!input.forceRefresh) throw error;
    return readEndpoint(
      limitsUrl,
      { ...requestInit, method: 'GET' },
      20_000,
      'cached provider limits',
    );
  });
  const providersPromise = readEndpoint(
    `${baseUrl}/api/providers?limit=500`,
    { ...requestInit, method: 'GET' },
    20_000,
    'provider catalog',
  );
  const callLogsPromise = modelId
    ? readEndpoint(
      `${baseUrl}/api/usage/call-logs?status=ok&limit=20&model=${encodeURIComponent(modelId)}`,
      { ...requestInit, method: 'GET' },
      8_000,
      'active account',
    ).catch(() => undefined)
    : Promise.resolve(undefined);

  const [limitsPayload, providersPayload, callLogsPayload] = await Promise.all([
    limitsPromise,
    providersPromise,
    callLogsPromise,
  ]);
  return normalizeOmniRouteProviderLimits(
    limitsPayload,
    providersPayload,
    input.providerKey?.trim() || 'omniroute',
    callLogsPayload,
    input.modelRef,
  );
}

export { normalizeBaseUrl as normalizeOmniRouteBaseUrl };
