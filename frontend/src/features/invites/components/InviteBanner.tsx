import { useTranslation } from 'react-i18next';

import { Banner, Button } from '@/components/ui';
import type { EventDetail } from '@/features/events/api';

import { useCopyInvite } from '../useCopyInvite';

/**
 * Overview nudge for a host who is still alone in an OPEN event: the screen's one coral
 * Banner, with a copy action. Renders nothing otherwise.
 */
export function InviteBanner({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const copy = useCopyInvite();
  const token = event.invite_token;
  const show =
    event.my_role === 'host' && event.state === 'open' && event.participant_count === 1 && token;
  if (!show) return null;

  return (
    <Banner
      as="h2"
      action={
        <Button variant="nav" className="bg-pure-white" onClick={() => void copy(token)}>
          {t('invites.banner.copy')}
        </Button>
      }
    >
      {t('invites.banner.text')}
    </Banner>
  );
}
