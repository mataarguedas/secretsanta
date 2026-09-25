import { useTranslation } from 'react-i18next';

import { Avatar, Button, useToast } from '@/components/ui';
import { useLogout, useMe } from '@/features/auth/api';
import { DeviceList } from '@/features/notifications/components/DeviceList';
import { NotificationSettings } from '@/features/notifications/components/NotificationSettings';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { DeleteAccountSection } from '../components/DeleteAccountSection';
import { LanguageSetting } from '../components/LanguageSetting';
import { LegalLinks } from '../components/LegalLinks';
import { ProfileSection } from '../components/ProfileSection';

/**
 * `/profile` (PRD §9.3.8, FR-ACC-1/2). Identity comes from Google and is read-only.
 * Settings are `ProfileSection`s, added in order as their prompts land:
 * Language → Notifications (the install guide on iOS) → Devices → Legal links, then Sign
 * out, and Delete account last (a secondary pill, never coral).
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: me } = useMe();
  const logout = useLogout();
  useDocumentTitle(t('profile.title'));

  if (!me) return null; // ProtectedRoute has already redirected.

  return (
    <>
      <section className="flex flex-col items-center gap-20 text-center md:flex-row md:text-left">
        <Avatar size="xl" src={me.avatar_url} name={me.name} alt={me.name} />
        <div className="flex min-w-0 flex-col gap-6">
          <h1 className="font-serif text-heading font-medium break-words md:text-heading-lg">
            {me.name}
          </h1>
          <p className="text-body break-all text-charcoal">{me.email}</p>
          <p className="text-sm text-stone">{t('profile.identityNote')}</p>
        </div>
      </section>

      <div className="flex flex-col gap-20">
        <ProfileSection title={t('profile.language.title')}>
          <LanguageSetting locale={me.locale} />
        </ProfileSection>
        <ProfileSection title={t('notifications.title')}>
          <NotificationSettings />
        </ProfileSection>
        <ProfileSection title={t('notifications.devices.title')}>
          <DeviceList />
        </ProfileSection>
        <ProfileSection title={t('legal.links.label')}>
          <LegalLinks />
        </ProfileSection>
      </div>

      <div>
        <Button
          variant="nav"
          loading={logout.isPending}
          onClick={() => {
            logout.mutate(undefined, {
              onError: (error) => toast.error(errorMessage(t, error)),
            });
          }}
        >
          {t('profile.signOut')}
        </Button>
      </div>

      <ProfileSection title={t('profile.delete.section')}>
        <DeleteAccountSection />
      </ProfileSection>
    </>
  );
}
