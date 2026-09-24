import { zodResolver } from '@hookform/resolvers/zod';
import type { ParseKeys } from 'i18next';
import { useId, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button, Input, Select, Sheet, Textarea, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors } from '@/lib/formErrors';

import type { ItemPayload } from '../api';
import {
  emptyItemForm,
  ITEM_LIMITS,
  itemSchema,
  itemServerFieldMap,
  toItemPayload,
  type ItemFormOutput,
  type ItemFormValues,
} from '../schemas';

export interface ItemFormSheetProps {
  open: boolean;
  mode: 'add' | 'edit';
  defaultValues?: ItemFormValues;
  onClose: () => void;
  /** Resolve on success (the sheet closes); throw to show the error. */
  onSubmit: (payload: ItemPayload) => Promise<unknown>;
  /** Shown under the form (the photo uploader, which saves on its own). */
  children?: ReactNode;
}

/** Add/edit a wishlist item (FR-WSH-2) in a Sheet: bottom sheet on mobile. */
export function ItemFormSheet({
  open,
  mode,
  defaultValues = emptyItemForm,
  onClose,
  onSubmit,
  children,
}: ItemFormSheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const formId = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues, unknown, ItemFormOutput>({
    resolver: zodResolver(itemSchema),
    defaultValues,
    mode: 'onTouched',
  });
  const noteLength = useWatch({ control, name: 'note' }).length;
  const message = (key: string | undefined) => (key ? t(key as ParseKeys) : undefined);

  const close = () => {
    if (isSubmitting) return;
    reset(defaultValues);
    onClose();
  };

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(toItemPayload(values));
      reset(emptyItemForm);
      onClose();
    } catch (error) {
      const mapped = applyServerFieldErrors(
        error,
        setError,
        itemServerFieldMap,
        'wishlist.form.errors.server',
      );
      if (!mapped) toast.error(errorMessage(t, error));
    }
  });

  return (
    <Sheet
      open={open}
      onClose={close}
      title={mode === 'add' ? t('wishlist.form.addTitle') : t('wishlist.form.editTitle')}
      footer={
        <>
          <Button variant="ghost" disabled={isSubmitting} onClick={close}>
            {t('wishlist.form.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={isSubmitting}>
            {mode === 'add' ? t('wishlist.form.submitAdd') : t('wishlist.form.submitEdit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-15"
      >
        <Input
          label={t('wishlist.form.title')}
          autoComplete="off"
          maxLength={ITEM_LIMITS.titleMax}
          error={message(errors.title?.message)}
          {...register('title')}
        />
        <Select
          label={t('wishlist.priority.label')}
          error={message(errors.priority?.message)}
          {...register('priority')}
        >
          <option value="high">{t('wishlist.priority.high')}</option>
          <option value="medium">{t('wishlist.priority.medium')}</option>
          <option value="low">{t('wishlist.priority.low')}</option>
        </Select>
        <Input
          label={t('wishlist.form.price')}
          prefix="₡"
          inputMode="numeric"
          autoComplete="off"
          error={message(errors.price?.message)}
          {...register('price')}
        />
        <Input
          label={t('wishlist.form.url')}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          help={t('wishlist.form.urlHelp')}
          error={message(errors.url?.message)}
          {...register('url')}
        />
        <Textarea
          label={t('wishlist.form.note')}
          maxLength={ITEM_LIMITS.noteMax}
          help={t('wishlist.form.noteCounter', { count: noteLength, max: ITEM_LIMITS.noteMax })}
          error={message(errors.note?.message)}
          {...register('note')}
        />
      </form>
      {children && <div className="mt-24">{children}</div>}
    </Sheet>
  );
}
