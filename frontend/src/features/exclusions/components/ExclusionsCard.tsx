import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertCircleIcon, CheckCircleIcon, CloseIcon } from '@/components/icons';
import { Avatar, Button, Card, PillToggle, Select, useToast } from '@/components/ui';
import { useParticipants, type EventDetail, type Participant } from '@/features/events/api';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';

import { useCreateExclusions, useDeleteExclusion, useExclusions, type Exclusion } from '../api';

const MIN_GROUP = 3;

/**
 * Manage › Exclusions (FR-EXC): add a pair, the group helper, the list of pairs and the
 * live feasibility status. Host only; read-only once the event isn't OPEN.
 */
export function ExclusionsCard({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const exclusions = useExclusions(event.id);
  const roster = useParticipants(event.id);
  const editable = event.state === 'open';

  let body;
  if (exclusions.isPending || (editable && roster.isPending)) {
    body = (
      <p role="status" className="text-body text-stone">
        {t('exclusions.loading')}
      </p>
    );
  } else if (exclusions.isError || roster.isError) {
    body = (
      <div className="flex flex-wrap items-center gap-15">
        <p className="text-body text-error">{errorMessage(t, exclusions.error ?? roster.error)}</p>
        <Button
          variant="nav"
          onClick={() => {
            void exclusions.refetch();
            void roster.refetch();
          }}
        >
          {t('events.dashboard.retry')}
        </Button>
      </div>
    );
  } else {
    const people = roster.data ?? [];
    body = (
      <>
        {editable ? (
          <FeasibilityStatus feasible={exclusions.data.feasible} />
        ) : (
          <p className="text-body text-charcoal">{t('exclusions.locked')}</p>
        )}
        <PairList eventId={event.id} items={exclusions.data.items} editable={editable} />
        {editable && (
          <>
            <AddPairForm eventId={event.id} people={people} />
            <GroupHelper eventId={event.id} people={people} />
          </>
        )}
      </>
    );
  }

  return (
    <Card as="section" aria-labelledby="manage-exclusions" className="flex flex-col gap-15">
      <h2 id="manage-exclusions" className="font-serif text-heading-sm font-medium">
        {t('exclusions.title')}
      </h2>
      <p className="text-sm text-stone">{t('exclusions.help')}</p>
      {body}
    </Card>
  );
}

/** Status text + icon only (never a coloured surface): CLAUDE.md §6.2. */
function FeasibilityStatus({ feasible }: { feasible: boolean }) {
  const { t } = useTranslation();
  const Icon = feasible ? CheckCircleIcon : AlertCircleIcon;
  return (
    <p
      role="status"
      data-feasible={feasible}
      className={cn('flex items-start gap-8 text-body', feasible ? 'text-success' : 'text-error')}
    >
      <Icon className="mt-[1px] size-20 shrink-0" />
      <span>{t(feasible ? 'exclusions.feasible' : 'exclusions.infeasible')}</span>
    </p>
  );
}

function PairList({
  eventId,
  items,
  editable,
}: {
  eventId: string;
  items: Exclusion[];
  editable: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const remove = useDeleteExclusion(eventId);

  if (items.length === 0) {
    return <p className="text-body text-charcoal">{t('exclusions.empty')}</p>;
  }

  return (
    <ul aria-label={t('exclusions.list')} className="divide-y divide-mist border-y border-mist">
      {items.map((pair) => {
        const label = t('exclusions.removeLabel', { a: pair.user_a.name, b: pair.user_b.name });
        return (
          <li key={pair.id} className="flex items-center gap-10 py-8">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-10 gap-y-6">
              <Person user={pair.user_a} />
              <span aria-hidden="true" className="font-mono text-stone">
                ⟷
              </span>
              <span className="sr-only">{t('exclusions.and')}</span>
              <Person user={pair.user_b} />
            </div>
            {editable && (
              <Button
                variant="ghost"
                iconOnly
                aria-label={label}
                loading={remove.isPending && remove.variables === pair.id}
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(pair.id, {
                    onSuccess: () => toast.success(t('exclusions.removed')),
                    onError: (error) => toast.error(errorMessage(t, error)),
                  });
                }}
              >
                {!(remove.isPending && remove.variables === pair.id) && <CloseIcon />}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Person({ user }: { user: { name: string; avatar_url: string | null } }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-8">
      <span aria-hidden="true" className="inline-flex">
        <Avatar size="sm" src={user.avatar_url} alt={user.name} />
      </span>
      <span className="text-body break-words">{user.name}</span>
    </span>
  );
}

function useDisplayName() {
  const { t } = useTranslation();
  return (p: Participant) => (p.is_self ? `${p.name} ${t('events.participants.you')}` : p.name);
}

function AddPairForm({ eventId, people }: { eventId: string; people: Participant[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateExclusions(eventId);
  const displayName = useDisplayName();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!first || !second) return;
    create.mutate([first, second], {
      onSuccess: () => {
        toast.success(t('exclusions.pair.added'));
        setFirst('');
        setSecond('');
      },
      onError: (error) => toast.error(errorMessage(t, error)),
    });
  };

  const options = (other: string) =>
    people
      .filter((p) => p.user_id !== other)
      .map((p) => (
        <option key={p.user_id} value={p.user_id}>
          {displayName(p)}
        </option>
      ));

  return (
    <form onSubmit={onSubmit} aria-labelledby="exclusions-pair" className="flex flex-col gap-12">
      <h3 id="exclusions-pair" className="font-serif text-subheading font-medium">
        {t('exclusions.pair.title')}
      </h3>
      <div className="flex flex-col gap-12 md:flex-row md:items-end">
        <Select
          label={t('exclusions.pair.first')}
          value={first}
          onChange={(e) => {
            setFirst(e.target.value);
          }}
          className="md:flex-1"
        >
          <option value="" disabled>
            {t('exclusions.pair.placeholder')}
          </option>
          {options(second)}
        </Select>
        <Select
          label={t('exclusions.pair.second')}
          value={second}
          onChange={(e) => {
            setSecond(e.target.value);
          }}
          className="md:flex-1"
        >
          <option value="" disabled>
            {t('exclusions.pair.placeholder')}
          </option>
          {options(first)}
        </Select>
        <div>
          <Button
            type="submit"
            variant="nav"
            disabled={!first || !second}
            loading={create.isPending}
          >
            {t('exclusions.pair.submit')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function GroupHelper({ eventId, people }: { eventId: string; people: Participant[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateExclusions(eventId);
  const displayName = useDisplayName();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const labelId = useId();
  const helpId = useId();
  // Only people still on the roster (someone may have left since they were picked).
  const chosen = people.filter((p) => selected.has(p.user_id)).map((p) => p.user_id);

  const toggle = (userId: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-12">
      <h3 id={labelId} className="font-serif text-subheading font-medium">
        {t('exclusions.group.title')}
      </h3>
      <p id={helpId} className="text-sm text-stone">
        {t('exclusions.group.help')}
      </p>
      <div
        role="group"
        aria-label={t('exclusions.group.label')}
        aria-describedby={helpId}
        className="flex flex-wrap gap-10"
      >
        {people.map((p) => (
          <PillToggle
            key={p.user_id}
            pressed={selected.has(p.user_id)}
            onPressedChange={(on) => {
              toggle(p.user_id, on);
            }}
            className="pl-6"
          >
            <span aria-hidden="true" className="inline-flex">
              <Avatar size="sm" src={p.avatar_url} alt={p.name} />
            </span>
            {displayName(p)}
          </PillToggle>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-15">
        <Button
          variant="nav"
          disabled={chosen.length < MIN_GROUP}
          loading={create.isPending}
          onClick={() => {
            create.mutate(chosen, {
              onSuccess: () => {
                toast.success(t('exclusions.group.added'));
                setSelected(new Set());
              },
              onError: (error) => toast.error(errorMessage(t, error)),
            });
          }}
        >
          {t('exclusions.group.submit')}
        </Button>
        <span className="text-sm text-stone">
          {t('exclusions.group.selected', { count: chosen.length })}
        </span>
      </div>
    </section>
  );
}
