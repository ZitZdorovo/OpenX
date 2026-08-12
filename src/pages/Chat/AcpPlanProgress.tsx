import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronUp, Circle, CircleX, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlanEntry } from '@agentclientprotocol/sdk';
import type { PlanItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';

type PlanStatus = 'completed' | 'in_progress' | 'failed' | 'cancelled' | 'pending';

function entryRecord(entry: PlanEntry): Record<string, unknown> {
  return entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
}

function entryText(entry: PlanEntry, fallback: string): string {
  const record = entryRecord(entry);
  for (const key of ['content', 'title', 'description', 'text', 'message']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function entryStatus(entry: PlanEntry): PlanStatus {
  const status = entryRecord(entry).status;
  if (status === 'completed' || status === 'in_progress' || status === 'failed' || status === 'cancelled') {
    return status;
  }
  return 'pending';
}

function StatusIcon({ status }: { status: PlanStatus }) {
  if (status === 'completed') return <Check className="h-3.5 w-3.5" aria-hidden="true" />;
  if (status === 'in_progress') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-blue-500" aria-hidden="true" />;
  if (status === 'failed' || status === 'cancelled') return <CircleX className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

export function AcpPlanProgress({ item }: { item: PlanItem }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const entries = item.entries;
  const progress = useMemo(() => {
    const statuses = entries.map(entryStatus);
    const runningIndex = statuses.findIndex((status) => status === 'in_progress');
    const completed = statuses.filter((status) => status === 'completed').length;
    return {
      current: runningIndex >= 0 ? runningIndex + 1 : Math.min(Math.max(completed, 1), statuses.length),
      total: statuses.length,
    };
  }, [entries]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (entries.length === 0) return null;

  return (
    <div ref={rootRef} className="relative z-40 flex justify-center px-4 pb-2" data-testid="acp-plan-progress">
      {open && (
        <div
          role="dialog"
          aria-label={t('acp.plan')}
          className="absolute bottom-full mb-2 w-[min(34rem,calc(100vw-2rem))] origin-bottom rounded-xl border border-border/80 bg-surface-modal p-2 shadow-xl shadow-black/20 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1"
          data-testid="acp-plan-progress-popover"
        >
          <div className="max-h-72 space-y-0.5 overflow-y-auto p-1">
            {entries.map((entry, index) => {
              const status = entryStatus(entry);
              return (
                <div
                  key={`${index}-${entryText(entry, '')}`}
                  className={cn(
                    'flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-sm',
                    status === 'in_progress' && 'bg-black/5 dark:bg-white/7',
                    status === 'completed' && 'text-muted-foreground',
                  )}
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    <StatusIcon status={status} />
                  </span>
                  <span className={cn('min-w-0 flex-1 leading-5', status === 'completed' && 'line-through decoration-foreground/20')}>
                    {entryText(entry, t('acp.plan'))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center gap-2 rounded-full border border-border/80 bg-surface-modal px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/7"
        data-testid="acp-plan-progress-trigger"
      >
        <span className="h-2.5 w-2.5 rounded-full border-2 border-blue-500/90 border-r-transparent" aria-hidden="true" />
        <span>{t('acp.stepProgress', { current: progress.current, total: progress.total })}</span>
        <ChevronUp className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
    </div>
  );
}
