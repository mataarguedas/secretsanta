import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/ui';

/** The shareable join URL on this origin (same origin as APP_BASE_URL). */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

/** Copy the invite URL, then confirm (or explain the failure) with a toast. */
export function useCopyInvite() {
  const { t } = useTranslation();
  const toast = useToast();
  return async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast.success(t('invites.link.copied'));
    } catch {
      toast.error(t('invites.link.copyFailed'));
    }
  };
}
