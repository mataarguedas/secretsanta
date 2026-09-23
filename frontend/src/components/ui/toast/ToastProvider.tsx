import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

import { Button } from '../Button';
import { ToastContext, type ToastApi, type ToastKind, type ToastOptions } from './toastContext';

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
}

const DEFAULT_DURATION: Record<ToastKind, number> = { success: 5000, info: 5000, error: 8000 };

// Green/red appear only on the icon and text, never as a background (CLAUDE.md §6.2).
const TONE: Record<ToastKind, string> = {
  success: 'text-success',
  error: 'text-error',
  info: 'text-ink-black',
};

function ToastIcon({ kind }: { kind: ToastKind }) {
  const paths: Record<ToastKind, ReactNode> = {
    success: <path d="M3.5 8.5l3 3 6-7" />,
    error: <path d="M8 4v5M8 11.5v.5" />,
    info: <path d="M8 7v5M8 4.5v.5" />,
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-[2px] size-16 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      {kind !== 'success' && <circle cx="8" cy="8" r="7" />}
      {paths[kind]}
    </svg>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);

  // Auto-dismiss, paused while hovered or focused (WCAG 2.2.1).
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, item.id, onDismiss]);

  return (
    <li
      className="pointer-events-auto flex w-full max-w-[420px] animate-toast-in items-start gap-10 border border-ink-black bg-pure-white py-8 pr-8 pl-15 motion-reduce:animate-none"
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
    >
      <span className={cn('flex flex-1 items-start gap-10 py-6 text-body', TONE[item.kind])}>
        <ToastIcon kind={item.kind} />
        <span>{item.message}</span>
      </span>
      <Button
        variant="ghost"
        iconOnly
        aria-label={t('ui.toast.dismiss')}
        onClick={() => {
          onDismiss(item.id);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-16">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </Button>
    </li>
  );
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const show = ({ kind = 'info', message, duration }: ToastOptions) => {
      nextId += 1;
      const id = `toast-${String(nextId)}`;
      setToasts((list) => [
        ...list.slice(-2), // keep at most 3 on screen
        { id, kind, message, duration: duration ?? DEFAULT_DURATION[kind] },
      ]);
      return id;
    };
    return {
      show,
      success: (message) => show({ kind: 'success', message }),
      error: (message) => show({ kind: 'error', message }),
      info: (message) => show({ kind: 'info', message }),
      dismiss,
    };
  }, [dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <section aria-label={t('ui.toast.region')}>
          {/* Always mounted so screen readers pick up additions (aria-live="polite"). */}
          <ol
            aria-live="polite"
            aria-relevant="additions"
            className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-10 px-16 md:inset-x-auto md:right-24 md:bottom-24 md:items-end md:px-0"
          >
            {toasts.map((item) => (
              <Toast key={item.id} item={item} onDismiss={dismiss} />
            ))}
          </ol>
        </section>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
