import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConfiguredModelOption } from '@/lib/model-options';
import {
  groupProviderQuotaWindows,
  providerQuotaFamily,
  selectProviderQuotaWindows,
} from '@/lib/provider-quota';
import { cn } from '@/lib/utils';
import { useProviderUsageStore } from '@/stores/provider-usage';

type UsageRecord = Record<string, unknown>;

function asUsage(value: unknown): UsageRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UsageRecord : {};
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function metric(record: UsageRecord, ...paths: string[]): number | null {
  for (const path of paths) {
    let value: unknown = record;
    for (const key of path.split('.')) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        value = undefined;
        break;
      }
      value = (value as UsageRecord)[key];
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function tokenCost(tokens: number | null, price: number | undefined): number | null {
  return tokens !== null && typeof price === 'number' ? (tokens / 1_000_000) * price : null;
}

function providerMatches(catalogProvider: string, usageProvider: string): boolean {
  const catalog = catalogProvider.toLowerCase();
  const usage = usageProvider.toLowerCase();
  if (catalog === usage) return true;
  if (usage === 'openai') return catalog.includes('openai') || catalog === 'codex';
  if (usage === 'anthropic') return catalog.includes('anthropic') || catalog.includes('claude');
  if (usage === 'gemini') return catalog.includes('gemini') || catalog.includes('google');
  return catalog.startsWith(`${usage}-`);
}

function quotaLabel(window: { label: string; period?: 'five_hour' | 'weekly' | 'monthly' }, t: (key: string) => string): string {
  if (window.period === 'five_hour') return t('composer.fiveHourLimit');
  if (window.period === 'weekly') return t('composer.weeklyLimit');
  const normalized = window.label.trim().toLowerCase();
  if (normalized === 'account-shared') {
    return t('composer.sharedAccountLimit');
  }
  if (normalized === 'session' || normalized === 'session (5h)' || normalized.includes('5h')) {
    return t('composer.fiveHourLimit');
  }
  if (normalized === 'weekly' || normalized === 'weekly (7d)' || normalized.includes('7d')) {
    return t('composer.weeklyLimit');
  }
  return window.label;
}

function quotaHeading(family: ReturnType<typeof providerQuotaFamily>, t: (key: string) => string): string {
  if (family === 'gemini') return t('composer.accountLimitsGemini');
  if (family === 'claude') return t('composer.accountLimitsClaude');
  if (family === 'chatgpt') return t('composer.accountLimitsChatGPT');
  return t('composer.accountLimitsProvider');
}

export function RequestStats({ usage, model }: { usage: unknown; model?: ConfiguredModelOption }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const providers = useProviderUsageStore((state) => state.providers);
  const loading = useProviderUsageStore((state) => state.loading);
  const refresh = useProviderUsageStore((state) => state.refresh);
  const parsed = asUsage(usage);
  const used = metric(parsed, 'used', 'totalTokens', 'total_tokens', 'usage.totalTokens', 'usage.total_tokens', 'context.used', 'context.usedTokens');
  const limit = model?.contextWindow ?? metric(parsed, 'size', 'contextWindow', 'context_window', 'context.limit', 'usage.size');
  const percent = used !== null && limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const cost = metric(parsed, 'estimatedCostUsd', 'estimated_cost_usd', 'cost', 'cost.total', 'cost.totalUsd', 'cost.total_usd');
  const inputTokens = metric(parsed, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens', 'input', 'tokens.input', 'usage.inputTokens', 'usage.input_tokens');
  const outputTokens = metric(parsed, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens', 'output', 'tokens.output', 'usage.outputTokens', 'usage.output_tokens');
  const cacheReadTokens = metric(parsed, 'cacheReadTokens', 'cache_read_tokens', 'cacheReadInputTokens', 'cache_read_input_tokens', 'cacheRead', 'tokens.cacheRead', 'usage.cacheReadTokens', 'usage.cache_read_tokens');
  const cacheWriteTokens = metric(parsed, 'cacheWriteTokens', 'cache_write_tokens', 'cacheCreationInputTokens', 'cache_creation_input_tokens', 'cacheWrite', 'tokens.cacheWrite', 'usage.cacheWriteTokens', 'usage.cache_write_tokens');
  const tokenMetrics = [
    { label: t('composer.input'), value: inputTokens, cost: tokenCost(inputTokens, model?.pricing?.input) },
    { label: t('composer.output'), value: outputTokens, cost: tokenCost(outputTokens, model?.pricing?.output) },
    { label: t('composer.cacheRead'), value: cacheReadTokens, cost: tokenCost(cacheReadTokens, model?.pricing?.cacheRead) },
    { label: t('composer.cacheWrite'), value: cacheWriteTokens, cost: tokenCost(cacheWriteTokens, model?.pricing?.cacheWrite) },
  ];
  const hasTokenBreakdown = tokenMetrics.some((entry) => entry.value !== null);
  const hasCostBreakdown = tokenMetrics.some((entry) => entry.cost !== null);
  const quota = useMemo(() => providers.find((entry) => (
    model && providerMatches(model.runtimeProviderKey, entry.provider)
  )), [model, providers]);
  const quotaFamily = providerQuotaFamily(model?.modelRef ?? '', model?.runtimeProviderKey);
  const selectedQuotaWindows = useMemo(() => selectProviderQuotaWindows(
    quota?.windows ?? [],
    model?.modelRef ?? '',
    model?.runtimeProviderKey,
    quota?.displayName === 'OmniRoute',
  ), [model?.modelRef, model?.runtimeProviderKey, quota]);
  const quotaWindows = useMemo(() => {
    if (quota?.displayName !== 'OmniRoute') return selectedQuotaWindows;
    if (!quota.activeAccountId) return [];
    return selectedQuotaWindows.filter((window) => window.accountId === quota.activeAccountId);
  }, [quota, selectedQuotaWindows]);
  const quotaGroups = useMemo(() => groupProviderQuotaWindows(quotaWindows), [quotaWindows]);
  const missingQuotaPeriods = useMemo(() => {
    if (quota?.displayName !== 'OmniRoute' || !quota.activeAccountId || quotaWindows.length === 0) return [];
    const periods = new Set(quotaWindows.map((window) => window.period));
    return (['five_hour', 'weekly'] as const).filter((period) => !periods.has(period));
  }, [quota?.activeAccountId, quota?.displayName, quotaWindows]);
  const hasQuota = Boolean(quota && (quota.windows.length > 0 || quota.billing?.length || quota.summary));
  const usageRefreshKey = `${used ?? ''}:${limit ?? ''}:${model?.runtimeProviderKey ?? ''}`;

  useEffect(() => {
    if (used === null) return;
    void refresh(model?.runtimeProviderKey, false, model?.modelRef);
  }, [model?.modelRef, model?.runtimeProviderKey, refresh, usageRefreshKey, used]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!limit && !hasQuota) return null;

  return (
    <div
      ref={rootRef}
      className="relative z-40 shrink-0"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="flex h-6 items-center justify-center gap-0.5 rounded-full px-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        title={t('composer.requestStats')}
        aria-label={used !== null && limit ? `${t('composer.requestStats')}: ${compactNumber(used)} / ${compactNumber(limit)}, ${percent}%` : t('composer.requestStats')}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        data-testid="chat-request-stats-button"
      >
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
          style={{ background: `conic-gradient(currentColor ${percent ?? 0}%, hsl(var(--muted)) ${percent ?? 0}% 100%)` }}
          aria-hidden="true"
        >
          <span className="h-3 w-3 rounded-full bg-surface-sidebar" />
        </span>
        {percent !== null && <span className="font-mono text-2xs tabular-nums">{percent}%</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('composer.requestStats')}
          className="absolute bottom-full right-0 z-[70] mb-2 w-80 rounded-xl border border-black/10 bg-surface-modal p-4 text-left shadow-2xl shadow-black/20 dark:border-white/10 dark:shadow-black/40"
          data-testid="chat-request-stats-panel"
        >
          {limit && (
            <div>
              <div className="flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-wide">
                <span className="text-muted-foreground">{t('composer.contextWindow')}</span>
                <span className="font-mono text-foreground">{used !== null ? `${compactNumber(used)} / ` : ''}{compactNumber(limit)}{percent !== null ? ` · ${percent}%` : ''}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full rounded-full bg-foreground/55 transition-[width] duration-300" style={{ width: `${percent ?? 0}%` }} />
              </div>
            </div>
          )}

          {hasTokenBreakdown && (
            <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
              <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('composer.lastRequestTokens')}</div>
              <div className="grid grid-cols-2 gap-2">
                {tokenMetrics.filter((entry) => entry.value !== null).map((entry) => (
                  <div key={entry.label} className="bg-black/[0.025] px-2.5 py-2 dark:bg-white/[0.035]">
                    <div className="text-2xs uppercase tracking-wide text-muted-foreground">{entry.label}</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-foreground">{compactNumber(entry.value ?? 0)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(cost !== null || hasCostBreakdown) && (
            <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
              <div className="mb-2 flex items-center justify-between text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>{t('composer.costByType')}</span>
                {cost !== null && <span className="font-mono text-foreground">${cost.toFixed(4)}</span>}
              </div>
              {hasCostBreakdown && (
                <div className="grid grid-cols-2 gap-2">
                  {tokenMetrics.filter((entry) => entry.cost !== null).map((entry) => (
                    <div key={entry.label} className="flex items-center justify-between bg-black/[0.025] px-2.5 py-2 text-2xs dark:bg-white/[0.035]">
                      <span className="text-muted-foreground">{entry.label}</span>
                      <span className="font-mono text-foreground">${(entry.cost ?? 0).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {hasQuota && quota && (
            <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{quotaHeading(quotaFamily, t)}</span>
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10" title={t('composer.refreshLimits')} onClick={() => void refresh(model?.runtimeProviderKey, true, model?.modelRef)}>
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </button>
              </div>
              {quotaGroups.map((group) => (
                <div key={group.key} className="mt-2.5 border-t border-black/5 pt-2 first:border-t-0 first:pt-0 dark:border-white/5">
                  {group.accountName && (
                    <div className="mb-1 truncate text-2xs text-muted-foreground" title={group.accountName}>
                      {t('composer.limitAccount', { account: group.accountName })}
                    </div>
                  )}
                  {group.windows.map((window) => (
                    <div key={`${window.label}:${window.resetAt ?? ''}`} className="mt-1.5 flex items-start justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-foreground/80" title={window.label}>{quotaLabel(window, t)}</span>
                      <span className="shrink-0 text-right font-mono text-foreground">
                        {Math.max(0, 100 - Math.round(window.usedPercent))}% {t('composer.remaining')}
                        {window.resetAt ? <span className="block text-2xs text-muted-foreground">{t('composer.resetsAt', { time: new Date(window.resetAt).toLocaleString() })}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {missingQuotaPeriods.map((period) => (
                <div key={period} className="mt-2 flex items-start justify-between gap-3 text-xs text-muted-foreground">
                  <span>{period === 'five_hour' ? t('composer.fiveHourLimit') : t('composer.weeklyLimit')}</span>
                  <span className="max-w-[150px] text-right text-2xs">{t('composer.limitNotReturned')}</span>
                </div>
              ))}
              {quota.windows.length > 0 && quotaGroups.length === 0 && (
                <div className="mt-2 text-2xs text-muted-foreground">
                  {quota.displayName === 'OmniRoute' && !quota.activeAccountId
                    ? t('composer.noActiveLimitAccount')
                    : t('composer.noLimitsForCurrentModel')}
                </div>
              )}
              {quota.billing?.map((entry, index) => (
                <div key={`${entry.type}:${entry.unit}:${index}`} className="mt-2 flex items-start justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{entry.type === 'budget' ? t('composer.budget') : t('composer.balance')}</span>
                  <span className="text-right font-mono text-foreground">
                    {entry.type === 'budget' ? `${entry.used.toFixed(2)} / ${entry.limit.toFixed(2)} ${entry.unit}` : `${entry.amount.toFixed(2)} ${entry.unit}`}
                  </span>
                </div>
              ))}
              {quota.error
                ? <div className="mt-2 text-2xs text-status-error">{t('composer.limitsUnavailable')}: {quota.error}</div>
                : quota.summary && <div className="mt-2 text-2xs text-muted-foreground">{quota.summary}</div>}
            </div>
          )}

          {model && (
            <div className="mt-4 border-t border-black/10 pt-3 text-2xs leading-5 text-muted-foreground dark:border-white/10">
              <div>{t('composer.provider')}: <span className="font-mono text-foreground/80">{model.runtimeProviderKey}</span></div>
              <div>{t('composer.model')}: <span className="font-mono text-foreground/80">{model.modelRef}</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
