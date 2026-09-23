import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { Avatar, Button, Card, useToast } from '@/components/ui';
import { ApiError } from '@/lib/apiClient';
import { errorMessage } from '@/lib/errors';
import { formatCRC, formatDateTime } from '@/lib/format';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

import { useInvitePreview, useJoinEvent, type InvitePreview } from '../api';

/**
 * `/join/:token` (FR-INV-3/4). Signed-out visitors never get here: the protected route
 * sends them to the landing with `next=/join/<token>`, and sign-in brings them back.
 */
export function JoinPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams<{ token: string }>();
  const preview = useInvitePreview(token);
  useDocumentTitle(t('invites.join.title'));

  if (preview.isPending) {
    return (
      <p role="status" className="text-body text-stone">
        {t('invites.join.loading')}
      </p>
    );
  }
  if (preview.isError) {
    const invalid =
      preview.error instanceof ApiError &&
      (preview.error.code === 'INVITE_INVALID' || preview.error.status === 422);
    return invalid ? (
      <JoinProblem title={t('invites.join.invalidTitle')} body={t('invites.join.invalidBody')} />
    ) : (
      <JoinProblem
        title={t('invites.join.errorTitle')}
        body={errorMessage(t, preview.error)}
        action={
          <Button variant="nav" onClick={() => void preview.refetch()}>
            {t('events.dashboard.retry')}
          </Button>
        }
      />
    );
  }

  const invite = preview.data;
  if (invite.already_participant && invite.event_id) {
    return <Navigate to={`/events/${invite.event_id}`} replace />;
  }
  if (!invite.joinable) {
    const reason = invite.reason ?? 'EVENT_ALREADY_DRAWN';
    return (
      <JoinProblem
        title={t('invites.join.closedTitle')}
        body={t(`invites.join.reasons.${reason}`)}
      />
    );
  }
  return <JoinCard token={token} invite={invite} />;
}

function JoinCard({ token, invite }: { token: string; invite: InvitePreview }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const join = useJoinEvent(token);

  const onJoin = () => {
    join.mutate(undefined, {
      onSuccess: ({ event_id }) => {
        toast.success(t('invites.join.joined', { name: invite.event_name }));
        void navigate(`/events/${event_id}`, { replace: true });
      },
      onError: (error) => {
        const params = error instanceof ApiError ? error.details.params : undefined;
        const eventId = (params as { event_id?: unknown } | undefined)?.event_id;
        if (
          error instanceof ApiError &&
          error.code === 'ALREADY_PARTICIPANT' &&
          typeof eventId === 'string'
        ) {
          void navigate(`/events/${eventId}`, { replace: true });
          return;
        }
        toast.error(errorMessage(t, error));
      },
    });
  };

  return (
    <section className="flex flex-1 flex-col items-center justify-center py-24">
      <Card className="flex w-full max-w-[480px] flex-col items-center gap-15 text-center">
        <p className="text-sm text-stone">{t('invites.join.invitedTo')}</p>
        <h1 className="font-serif text-heading font-medium break-words md:text-heading-lg">
          {invite.event_name}
        </h1>
        <div className="flex items-center gap-10">
          <Avatar size="md" src={invite.host.avatar_url} alt={invite.host.name} />
          <p className="text-body">{t('invites.join.hostedBy', { name: invite.host.name })}</p>
        </div>
        <dl className="grid w-full grid-cols-[auto_1fr] gap-x-15 gap-y-6 text-left text-body">
          <div className="contents">
            <dt className="text-sm text-stone">{t('events.card.budget')}</dt>
            <dd className="font-mono">{formatCRC(invite.budget_crc)}</dd>
          </div>
          <div className="contents">
            <dt className="text-sm text-stone">{t('events.card.date')}</dt>
            <dd>
              <time dateTime={invite.exchange_at}>
                {formatDateTime(invite.exchange_at, i18n.language)}
              </time>
            </dd>
          </div>
          <div className="contents">
            <dt className="text-sm text-stone">{t('events.card.participantsLabel')}</dt>
            <dd>{t('events.card.participants', { count: invite.participant_count })}</dd>
          </div>
        </dl>
        <Button variant="primary" loading={join.isPending} onClick={onJoin}>
          {t('invites.join.join')}
        </Button>
      </Card>
    </section>
  );
}

/** A link that can't be used: serif headline, one line, a way to the dashboard. */
function JoinProblem({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col items-start gap-15">
      <h1 className="font-serif text-heading font-medium md:text-heading-lg">{title}</h1>
      <p className="text-body text-charcoal">{body}</p>
      <div className="flex flex-wrap gap-10">
        {action}
        <Button variant="nav" asChild>
          <Link to="/">{t('invites.join.backToDashboard')}</Link>
        </Button>
      </div>
    </section>
  );
}
