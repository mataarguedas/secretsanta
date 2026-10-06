import { zodResolver } from '@hookform/resolvers/zod';
import type { ParseKeys } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button, Input, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors } from '@/lib/formErrors';

import { useUpdateName } from '../api';
import {
  NAME_MAX,
  nameFormErrors,
  nameSchema,
  type NameFormOutput,
  type NameFormValues,
} from '../schemas';

/**
 * The name everyone else sees (FR-ACC-1). It starts as the Google name; once changed here,
 * signing in again keeps it (e.g. a parent's Google account used for their baby).
 */
export function NameSetting({ name }: { name: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdateName();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<NameFormValues, unknown, NameFormOutput>({
    resolver: zodResolver(nameSchema),
    values: { name },
    mode: 'onTouched',
  });
  const message = (key: string | undefined) => (key ? t(key as ParseKeys) : undefined);

  const submit = handleSubmit(async (values) => {
    if (values.name === name) {
      reset({ name });
      return;
    }
    try {
      await update.mutateAsync(values.name);
      toast.success(t('profile.name.saved'));
    } catch (error) {
      const mapped = applyServerFieldErrors(
        error,
        setError,
        { name: 'name' },
        nameFormErrors.server,
      );
      if (!mapped) toast.error(errorMessage(t, error));
    }
  });

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-15">
      <Input
        label={t('profile.name.label')}
        autoComplete="off"
        maxLength={NAME_MAX}
        help={t('profile.name.help')}
        error={message(errors.name?.message)}
        {...register('name')}
      />
      <div>
        <Button variant="secondary" type="submit" loading={isSubmitting} disabled={!isDirty}>
          {t('profile.name.save')}
        </Button>
      </div>
    </form>
  );
}
