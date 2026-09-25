import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

import { MESSAGE_MAX } from '../api';

/** Enter sends where there's a physical keyboard; on touch screens it's a new line. */
function enterSends(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : false;
}

/**
 * The thread composer: 1–2000 characters (trimmed) with a counter, and the coral Send, the
 * only primary in the viewport. Shift+Enter always makes a new line.
 */
export function Composer({ onSend }: { onSend: (body: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  const trimmed = value.trim();
  const tooLong = value.length > MESSAGE_MAX;
  const canSend = trimmed.length > 0 && !tooLong;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!enterSends()) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      noValidate
      aria-label={t('chat.composer.label')}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-6 border-t border-ink-black bg-cream-linen px-16 pt-12 pb-[calc(12px+env(safe-area-inset-bottom))] md:px-0 md:pb-0"
    >
      <div className="flex items-end gap-10">
        <label className="sr-only" htmlFor={`${counterId}-input`}>
          {t('chat.composer.label')}
        </label>
        <textarea
          ref={input}
          id={`${counterId}-input`}
          rows={1}
          value={value}
          placeholder={t('chat.composer.placeholder')}
          aria-describedby={counterId}
          aria-invalid={tooLong ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'field-sizing-content max-h-[40dvh] min-h-11 flex-1 resize-none rounded-2xl border bg-pure-white px-19 py-10 text-body',
            tooLong ? 'border-error' : 'border-ink-black',
          )}
        />
        <Button variant="primary" type="submit" disabled={!canSend}>
          {t('chat.composer.send')}
        </Button>
      </div>
      <p
        id={counterId}
        className={cn('text-right text-caption', tooLong ? 'text-error' : 'text-stone')}
      >
        {tooLong
          ? t('chat.composer.tooLong', { max: MESSAGE_MAX })
          : t('chat.composer.counter', { count: value.length, max: MESSAGE_MAX })}
      </p>
    </form>
  );
}
