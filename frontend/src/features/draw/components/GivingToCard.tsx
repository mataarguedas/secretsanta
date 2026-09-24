import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Avatar, Banner, Button, Card } from '@/components/ui';
import type { EventDetail, MyAssignment } from '@/features/events/api';
import { eventTabPath } from '@/features/events/tabs';

/**
 * FR-DRW-4: "You're giving to…". The header is the screen's one coral Banner. Only ever
 * rendered from the caller's own `my_assignment`.
 */
export function GivingToCard({
  event,
  assignment,
}: {
  event: EventDetail;
  assignment: MyAssignment;
}) {
  const { t } = useTranslation();
  const { receiver } = assignment;
  const wishlist = `${eventTabPath(event.id, 'wishlists')}?user=${encodeURIComponent(receiver.user_id)}`;

  return (
    <Card as="section" aria-labelledby="giving-to" className="flex flex-col p-0">
      <Banner as="h2" className="min-h-0 py-20">
        <span id="giving-to">{t('draw.givingTo.title')}</span>
      </Banner>
      <div className="flex flex-col items-center gap-15 p-20 text-center">
        <Avatar size="xl" src={receiver.avatar_url} alt={receiver.name} />
        <p className="font-serif text-heading-lg font-medium break-words">{receiver.name}</p>
        <Button variant="secondary" asChild>
          <Link to={wishlist}>{t('draw.givingTo.wishlist')}</Link>
        </Button>
      </div>
    </Card>
  );
}
