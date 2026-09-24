import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { Avatar, Button, PillToggle } from '@/components/ui';
import { useParticipants, type EventDetail, type Participant } from '@/features/events/api';
import { errorMessage } from '@/lib/errors';

import { useWishlist } from '../api';
import { WishlistView } from './WishlistView';

/**
 * Event › Wishlists (FR-WSH-6): pick a participant ("My wishlist" first) and see their
 * list. The choice lives in `?user=` so "See their wishlist" links and reloads land on it.
 */
export function WishlistsTab({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const roster = useParticipants(event.id);
  const [params, setParams] = useSearchParams();

  if (roster.isPending) {
    return (
      <p role="status" className="text-body text-stone">
        {t('wishlist.loading')}
      </p>
    );
  }
  if (roster.isError) {
    return (
      <div className="flex flex-wrap items-center gap-15">
        <p className="text-body text-error">{errorMessage(t, roster.error)}</p>
        <Button variant="nav" onClick={() => void roster.refetch()}>
          {t('events.dashboard.retry')}
        </Button>
      </div>
    );
  }

  const people = [...roster.data].sort((a, b) => Number(b.is_self) - Number(a.is_self));
  const me = people.find((p) => p.is_self) ?? null;
  const wanted = params.get('user');
  const selected = people.find((p) => p.user_id === wanted) ?? me ?? people[0] ?? null;

  const select = (person: Participant) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('user', person.user_id);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col gap-24">
      <div
        role="group"
        aria-label={t('wishlist.picker.label')}
        className="-mx-16 flex gap-10 overflow-x-auto px-16 pb-6 md:mx-0 md:flex-wrap md:px-0"
      >
        {people.map((person) => (
          <PillToggle
            key={person.user_id}
            pressed={person.user_id === selected?.user_id}
            onPressedChange={() => {
              select(person);
            }}
            className="shrink-0 pl-6"
          >
            <span aria-hidden="true" className="inline-flex">
              <Avatar size="sm" src={person.avatar_url} alt={person.name} />
            </span>
            {person.is_self ? t('wishlist.picker.mine') : person.name}
          </PillToggle>
        ))}
      </div>
      {selected && (
        <SelectedWishlist
          key={selected.user_id}
          event={event}
          person={selected}
          myId={me?.user_id ?? null}
        />
      )}
    </div>
  );
}

function SelectedWishlist({
  event,
  person,
  myId,
}: {
  event: EventDetail;
  person: Participant;
  myId: string | null;
}) {
  const { t } = useTranslation();
  const wishlist = useWishlist(event.id, person.user_id);

  if (wishlist.isPending) {
    return (
      <p role="status" className="text-body text-stone">
        {t('wishlist.loading')}
      </p>
    );
  }
  if (wishlist.isError) {
    return (
      <div className="flex flex-wrap items-center gap-15">
        <p className="text-body text-error">{errorMessage(t, wishlist.error)}</p>
        <Button variant="nav" onClick={() => void wishlist.refetch()}>
          {t('events.dashboard.retry')}
        </Button>
      </div>
    );
  }
  return (
    <WishlistView
      eventId={event.id}
      wishlist={wishlist.data}
      editable={wishlist.data.is_self && myId !== null && event.state !== 'archived'}
      archived={event.state === 'archived'}
    />
  );
}
