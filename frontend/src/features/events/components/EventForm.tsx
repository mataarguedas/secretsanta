import { zodResolver } from '@hookform/resolvers/zod';
import type { ParseKeys } from 'i18next';
import { useMemo, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button, Input, Switch, Textarea, useToast } from '@/components/ui';
import { toLocalInputValue } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors } from '@/lib/formErrors';

import {
  createEventSchema,
  EVENT_LIMITS,
  emptyEventForm,
  serverFieldMap,
  type EventFormOutput,
  type EventFormValues,
  type EventSchemaOptions,
} from '../schemas';

const NONE: ReadonlySet<keyof EventFormValues> = new Set();

export interface EventFormProps {
  submitLabel: string;
  defaultValues?: EventFormValues;
  /** Read-only fields (e.g. everything but four after the draw). */
  disabledFields?: ReadonlySet<keyof EventFormValues>;
  schemaOptions?: EventSchemaOptions;
  /** Resolve on success; throw (e.g. an `ApiError`) to show errors. */
  onSubmit: (values: EventFormOutput) => Promise<unknown>;
  /** Extra fields rendered after the form's own, before the submit (e.g. the cover). */
  children?: ReactNode;
}

/**
 * The single-column event form (PRD §9.3.3). Validation mirrors the backend; server
 * validation errors land on their fields, anything else becomes a toast. Below md the
 * submit is a sticky full-width pill resting on the tab bar.
 */
export function EventForm({
  submitLabel,
  defaultValues = emptyEventForm,
  disabledFields = NONE,
  schemaOptions,
  onSubmit,
  children,
}: EventFormProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const originalExchangeAt = schemaOptions?.originalExchangeAt;
  const schema = useMemo(
    () =>
      createEventSchema(undefined, originalExchangeAt === undefined ? {} : { originalExchangeAt }),
    [originalExchangeAt],
  );
  const locked = (field: keyof EventFormValues) => disabledFields.has(field);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues, unknown, EventFormOutput>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onTouched',
  });

  const isOnline = useWatch({ control, name: 'isOnline' });
  const descriptionLength = useWatch({ control, name: 'description' }).length;
  const minDate = toLocalInputValue(new Date());
  const message = (key: string | undefined) => (key ? t(key as ParseKeys) : undefined);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      const mapped = applyServerFieldErrors(
        error,
        setError,
        serverFieldMap,
        'events.form.errors.server',
      );
      if (!mapped) toast.error(errorMessage(t, error));
    }
  });

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="flex max-w-[640px] flex-col gap-20"
    >
      <Input
        label={t('events.form.name')}
        autoComplete="off"
        maxLength={EVENT_LIMITS.nameMax}
        disabled={locked('name')}
        error={message(errors.name?.message)}
        {...register('name')}
      />

      <Textarea
        label={t('events.form.description')}
        maxLength={EVENT_LIMITS.descriptionMax}
        disabled={locked('description')}
        help={t('events.form.descriptionCounter', {
          count: descriptionLength,
          max: EVENT_LIMITS.descriptionMax,
        })}
        error={message(errors.description?.message)}
        {...register('description')}
      />

      <Input
        label={t('events.form.budget')}
        prefix="₡"
        inputMode="numeric"
        autoComplete="off"
        disabled={locked('budget')}
        help={t('events.form.budgetHelp')}
        error={message(errors.budget?.message)}
        {...register('budget')}
      />

      <div className="grid gap-20 md:grid-cols-2">
        <Input
          type="datetime-local"
          label={t('events.form.exchangeAt')}
          min={minDate}
          disabled={locked('exchangeAt')}
          error={message(errors.exchangeAt?.message)}
          {...register('exchangeAt')}
        />
        <Input
          type="datetime-local"
          label={t('events.form.joinDeadline')}
          min={minDate}
          disabled={locked('joinDeadline')}
          help={t('events.form.joinDeadlineHelp')}
          error={message(errors.joinDeadline?.message)}
          {...register('joinDeadline')}
        />
      </div>

      <div className="flex flex-col gap-12">
        <Input
          label={t('events.form.location')}
          autoComplete="off"
          maxLength={EVENT_LIMITS.locationMax}
          disabled={isOnline || locked('location')}
          error={isOnline ? undefined : message(errors.location?.message)}
          {...register('location')}
        />
        <Controller
          control={control}
          name="isOnline"
          render={({ field }) => (
            <Switch
              label={t('events.form.online')}
              description={t('events.form.onlineHelp')}
              disabled={locked('isOnline')}
              checked={field.value}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
      </div>

      <Controller
        control={control}
        name="groupChatEnabled"
        render={({ field }) => (
          <Switch
            label={t('events.form.groupChat')}
            description={t('events.form.groupChatHelp')}
            disabled={locked('groupChatEnabled')}
            checked={field.value}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />

      {children}

      {/* Mobile: sticky full-width pill just above the fixed tab bar. Desktop: inline. */}
      <div className="sticky bottom-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom))] -mx-16 border-t border-mist bg-cream-linen px-16 py-12 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button variant="primary" type="submit" fullWidthOnMobile loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
