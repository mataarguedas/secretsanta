import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

import { Button } from '../Button';
import { useFocusTrap } from './useFocusTrap';
import { useScrollLock } from './useScrollLock';

export interface DialogProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close button. */
  onClose: () => void;
  /** Visible serif title; also the dialog's accessible name. */
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions row at the bottom (e.g. Cancel + one primary). */
  footer?: ReactNode;
  /** Element to focus on open; defaults to the dialog itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

type Layout = 'modal' | 'sheet';

const OVERLAY: Record<Layout, string> = {
  modal: 'items-center justify-center p-16',
  sheet: 'items-end justify-center md:items-center md:p-16',
};

const PANEL: Record<Layout, string> = {
  modal: 'max-h-[calc(100dvh-32px)] max-w-[560px] border border-ink-black p-20 animate-dialog-in',
  // Bottom sheet below md (square corners, safe-area padding), centered panel above.
  sheet:
    'max-h-[90dvh] border-t border-ink-black px-20 pt-20 pb-[calc(20px+env(safe-area-inset-bottom))] animate-sheet-in md:max-h-[calc(100dvh-32px)] md:max-w-[560px] md:border md:pb-20 md:animate-dialog-in',
};

function DialogContent({
  layout,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  className,
}: Omit<DialogProps, 'open'> & { layout: Layout }) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerDownOnBackdrop = useRef(false);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  useFocusTrap(panelRef, initialFocusRef);
  useScrollLock();

  return (
    <div
      data-testid="dialog-backdrop"
      className={cn(
        'fixed inset-0 z-50 flex animate-fade-in bg-ink-black/40 motion-reduce:animate-none',
        OVERLAY[layout],
      )}
      onMouseDown={(e) => {
        pointerDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Only a press that starts *and* ends on the backdrop closes (not a text-selection drag).
        if (pointerDownOnBackdrop.current && e.target === e.currentTarget) onClose();
        pointerDownOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        className={cn(
          'relative flex w-full flex-col gap-15 overflow-y-auto bg-pure-white outline-none motion-reduce:animate-none',
          PANEL[layout],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-15">
          <h2 id={titleId} className="pt-8 font-serif text-heading-sm font-medium">
            {title}
          </h2>
          <Button variant="nav" iconOnly aria-label={t('ui.dialog.close')} onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-16">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Button>
        </div>
        {description && (
          <p id={descriptionId} className="text-body text-charcoal">
            {description}
          </p>
        )}
        {children}
        {footer && <div className="flex flex-wrap items-center justify-end gap-10">{footer}</div>}
      </div>
    </div>
  );
}

/** Shared portal + a11y frame for Modal and Sheet. Renders nothing while closed. */
export function DialogFrame({ open, layout, ...props }: DialogProps & { layout: Layout }) {
  if (!open) return null;
  return createPortal(<DialogContent layout={layout} {...props} />, document.body);
}
