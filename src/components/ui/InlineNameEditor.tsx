import { useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';

interface InlineNameEditorProps {
  value: string;
  ariaLabel: string;
  saveLabel: string;
  cancelLabel: string;
  resetLabel?: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  onReset?: () => void;
}

export function InlineNameEditor({
  value,
  ariaLabel,
  saveLabel,
  cancelLabel,
  resetLabel,
  onSave,
  onCancel,
  onReset,
}: InlineNameEditorProps) {
  const [draft, setDraft] = useState(value);
  const cancelledRef = useRef(false);

  const save = () => {
    if (cancelledRef.current) return;
    const next = draft.trim();
    if (next) onSave(next);
    else onCancel();
  };

  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1 px-2"
      onSubmit={(event) => { event.preventDefault(); save(); }}
    >
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (event.currentTarget.form?.contains(event.relatedTarget as Node | null)) return;
          save();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelledRef.current = true;
            onCancel();
          }
        }}
        className="h-7 min-w-0 flex-1 rounded-md border border-black/10 bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-primary dark:border-white/10"
        aria-label={ariaLabel}
      />
      <button type="submit" className="rounded p-1 text-muted-foreground hover:text-foreground" title={saveLabel}>
        <Check className="h-3.5 w-3.5" />
      </button>
      {onReset && (
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title={resetLabel}
          onClick={() => { cancelledRef.current = true; onReset(); }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title={cancelLabel}
        onClick={() => { cancelledRef.current = true; onCancel(); }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
