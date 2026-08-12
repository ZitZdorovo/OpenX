import type { ProviderUsageWindow } from '@shared/host-api/contract';

export type ProviderQuotaFamily = 'gemini' | 'claude' | 'chatgpt' | 'provider';

export interface ProviderQuotaGroup {
  key: string;
  accountName?: string;
  windows: ProviderUsageWindow[];
}

function normalized(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isGeneralWindow(label: string): boolean {
  const value = normalized(label);
  return value === 'session'
    || value === 'weekly'
    || value === 'monthly'
    || value.includes('5h')
    || value.includes('7d')
    || value.includes('code-review');
}

function isGeneralQuotaWindow(window: ProviderUsageWindow): boolean {
  return window.period === 'weekly'
    || window.period === 'monthly'
    || isGeneralWindow(window.label);
}

function inferredPeriod(window: ProviderUsageWindow): ProviderUsageWindow['period'] {
  if (window.period) return window.period;
  const value = normalized(window.label);
  if (value === 'session' || value.includes('5h')) return 'five_hour';
  if (value.startsWith('weekly') || value.includes('7d')) return 'weekly';
  if (value.includes('monthly')) return 'monthly';
  return undefined;
}

function isPrimaryWindow(window: ProviderUsageWindow): boolean {
  const value = normalized(window.label);
  return value === 'session'
    || value === 'session-5h'
    || value === 'weekly'
    || value === 'weekly-7d';
}

function collapseAccountPeriods(windows: ProviderUsageWindow[]): ProviderUsageWindow[] {
  const selected = new Map<string, ProviderUsageWindow>();
  for (const window of windows) {
    const period = inferredPeriod(window);
    if (period !== 'five_hour' && period !== 'weekly') continue;
    const accountKey = window.accountName?.trim().toLowerCase()
      || window.accountId?.trim().toLowerCase()
      || 'default';
    const key = `${accountKey}:${period}`;
    const candidate = { ...window, period };
    const current = selected.get(key);
    if (!current
      || (isPrimaryWindow(candidate) && !isPrimaryWindow(current))
      || (isPrimaryWindow(candidate) === isPrimaryWindow(current) && candidate.usedPercent > current.usedPercent)) {
      selected.set(key, candidate);
    }
  }
  return Array.from(selected.values());
}

function modelFamily(label: string): ProviderQuotaFamily {
  const value = normalized(label);
  if (value.includes('claude')) return 'claude';
  if (value.includes('gemini')) return 'gemini';
  if (value.includes('gpt') || value.includes('codex')) return 'chatgpt';
  return 'provider';
}

function collapseSharedModelPool(windows: ProviderUsageWindow[]): ProviderUsageWindow[] {
  const byAccount = new Map<string, ProviderUsageWindow>();
  for (const window of windows) {
    const accountKey = window.accountName?.trim().toLowerCase()
      || window.accountId?.trim().toLowerCase()
      || 'default';
    const key = `${accountKey}:${window.period ?? 'five_hour'}`;
    const current = byAccount.get(key);
    if (!current || window.usedPercent > current.usedPercent) {
      byAccount.set(key, {
        ...window,
        label: 'account-shared',
        period: window.period ?? 'five_hour',
      });
    }
  }
  return Array.from(byAccount.values());
}

export function providerQuotaFamily(modelRef: string, runtimeProviderKey = ''): ProviderQuotaFamily {
  const reference = `${runtimeProviderKey}/${modelRef}`.toLowerCase();
  const modelId = modelRef.split('/').at(-1)?.toLowerCase() ?? modelRef.toLowerCase();

  if (modelId.includes('claude') || reference.includes('anthropic')) return 'claude';
  if (modelId.includes('gemini') || reference.includes('/agy/') || reference.includes('/antigravity/')) return 'gemini';
  if (modelId.includes('gpt') || modelId.includes('codex') || reference.includes('openai') || reference.includes('chatgpt')) return 'chatgpt';
  return 'provider';
}

function accountFamily(provider: string | undefined): ProviderQuotaFamily {
  const value = provider?.toLowerCase() ?? '';
  if (value.includes('claude') || value.includes('anthropic')) return 'claude';
  if (value.includes('gemini') || value.includes('google') || value.includes('antigravity') || value === 'agy') return 'gemini';
  if (value.includes('codex') || value.includes('openai') || value.includes('chatgpt')) return 'chatgpt';
  return 'provider';
}

function modelWindowMatches(label: string, modelRef: string): boolean {
  const modelId = normalized(modelRef.split('/').at(-1) ?? modelRef);
  const quotaId = normalized(label);
  return Boolean(modelId) && quotaId === modelId;
}

export function selectProviderQuotaWindows(
  windows: ProviderUsageWindow[],
  modelRef: string,
  runtimeProviderKey = '',
  omniRoute = false,
): ProviderUsageWindow[] {
  if (!omniRoute) return windows;

  const family = providerQuotaFamily(modelRef, runtimeProviderKey);
  const exact = windows.filter((window) => modelWindowMatches(window.label, modelRef));
  const general = windows.filter((window) => (
    isGeneralQuotaWindow(window)
    && (accountFamily(window.accountProvider) === family || accountFamily(window.accountProvider) === 'provider')
  ));

  if (family === 'gemini' || family === 'claude') {
    const sharedPool = collapseSharedModelPool(windows.filter((window) => (
      modelFamily(window.label) === family
      && !general.includes(window)
    )));
    return collapseAccountPeriods([...general, ...sharedPool]);
  }

  return collapseAccountPeriods([...general, ...exact]);
}

export function groupProviderQuotaWindows(windows: ProviderUsageWindow[]): ProviderQuotaGroup[] {
  const groups = new Map<string, ProviderQuotaGroup>();

  for (const window of windows) {
    const accountKey = window.accountName?.trim().toLowerCase()
      || window.accountId?.trim().toLowerCase()
      || 'default';
    const group = groups.get(accountKey) ?? {
      key: accountKey,
      ...(window.accountName ? { accountName: window.accountName } : {}),
      windows: [],
    };
    const duplicateIndex = group.windows.findIndex((entry) => normalized(entry.label) === normalized(window.label));
    if (duplicateIndex < 0) {
      group.windows.push(window);
    } else {
      const existing = group.windows[duplicateIndex];
      if ((window.resetAt ?? 0) >= (existing?.resetAt ?? 0)) group.windows[duplicateIndex] = window;
    }
    groups.set(accountKey, group);
  }

  return Array.from(groups.values());
}
