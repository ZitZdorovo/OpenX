import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type ChatScrollNavigatorItem = {
  id: string;
  anchorId: string;
  userPreview: string;
  assistantPreview?: string;
};

type ChatScrollNavigatorProps = {
  items: ChatScrollNavigatorItem[];
  scrollElement: HTMLElement | null;
  label: string;
};

function findVisibleTurn(items: ChatScrollNavigatorItem[], scrollElement: HTMLElement): number {
  const threshold = scrollElement.getBoundingClientRect().top + Math.min(140, scrollElement.clientHeight * 0.25);
  let current = 0;
  for (let index = 0; index < items.length; index += 1) {
    const anchor = document.getElementById(items[index].anchorId);
    if (!anchor || anchor.getBoundingClientRect().top > threshold) break;
    current = index;
  }
  return current;
}

export function ChatScrollNavigator({ items, scrollElement, label }: ChatScrollNavigatorProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [preview, setPreview] = useState<{ index: number; left: number; top: number } | null>(null);

  const jumpTo = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(items.length - 1, index));
    const item = items[bounded];
    if (!item) return;
    setActiveIndex(bounded);
    document.getElementById(item.anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [items]);

  useEffect(() => {
    if (!scrollElement || items.length < 2) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActiveIndex(findVisibleTurn(items, scrollElement)));
    };
    update();
    scrollElement.addEventListener('scroll', update, { passive: true });
    return () => {
      scrollElement.removeEventListener('scroll', update);
      cancelAnimationFrame(frame);
    };
  }, [items, scrollElement]);

  const showPreview = (index: number, marker: HTMLButtonElement) => {
    const markerRect = marker.getBoundingClientRect();
    setPreview({
      index,
      left: Math.min(markerRect.right + 12, window.innerWidth - 336),
      top: Math.max(76, Math.min(markerRect.top + markerRect.height / 2, window.innerHeight - 76)),
    });
  };

  if (items.length < 2) return null;
  return (
    <div
      data-testid="chat-scroll-navigator"
      className="absolute top-1/2 z-20 hidden -translate-y-1/2 min-[900px]:block"
      style={{ left: 'max(0px, calc((100% - 56rem) / 2 - 2.5rem))' }}
      onWheel={(event) => {
        event.preventDefault();
        jumpTo(activeIndex + (event.deltaY > 0 ? 1 : -1));
      }}
    >
      <div className="flex max-h-[78vh] w-10 flex-col items-center justify-center overflow-y-auto py-2" aria-label={label}>
        {items.map((item, index) => {
          const distance = preview ? Math.abs(preview.index - index) : Number.POSITIVE_INFINITY;
          return (
          <button
            key={item.id}
            type="button"
            aria-label={`${label}: ${item.userPreview}`}
            className="group relative flex h-2.5 w-full shrink-0 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => jumpTo(index)}
            onMouseEnter={(event) => showPreview(index, event.currentTarget)}
            onMouseLeave={() => setPreview(null)}
            onFocus={(event) => showPreview(index, event.currentTarget)}
            onBlur={() => setPreview(null)}
          >
            <span className={cn(
              'block h-0.5 w-2.5 rounded-full transition-[width,opacity,background-color] duration-300',
              index === activeIndex ? 'bg-foreground/90 opacity-100' : 'bg-muted-foreground/45 opacity-55',
              distance === 0 && 'w-8 bg-foreground opacity-100',
              distance === 1 && 'w-[17px] bg-foreground/85 opacity-95',
              distance === 2 && 'w-3 bg-foreground/70 opacity-85',
              distance === 3 && 'w-[9px] bg-foreground/55 opacity-75',
            )}
            style={{
              transitionDelay: preview ? `${Math.min(distance, 5) * 28}ms` : `${Math.max(0, 4 - Math.min(distance, 4)) * 18}ms`,
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            />
          </button>
          );
        })}
      </div>

      {preview && items[preview.index] && createPortal(
        <div
          data-testid="chat-scroll-preview"
          className="openx-scroll-preview pointer-events-none fixed z-[140] w-80 max-w-[min(20rem,calc(100vw-5rem))] -translate-y-1/2 overflow-hidden rounded-xl border border-black/10 bg-surface-modal/95 px-3 py-2.5 text-left shadow-xl shadow-black/20 backdrop-blur-xl dark:border-white/10 dark:shadow-black/45"
          style={{ left: preview.left, top: preview.top }}
        >
          <div className="truncate text-xs font-semibold leading-5 text-foreground">
            {items[preview.index].userPreview}
          </div>
          {items[preview.index].assistantPreview && (
            <div className="mt-0.5 line-clamp-3 text-xs leading-5 text-muted-foreground">{items[preview.index].assistantPreview}</div>
          )}
        </div>
      , document.body)}
    </div>
  );
}
