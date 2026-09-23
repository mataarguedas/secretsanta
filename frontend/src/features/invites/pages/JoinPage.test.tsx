import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import {
  eventDetail,
  invitePreview,
  jsonResponse,
  mockSession,
  renderApp,
  TEST_USER,
} from '@/test/render';

const TOKEN = 'tok_abc-123';

function renderJoin(options: Omit<Parameters<typeof mockSession>[0], 'me'> = {}) {
  const session = mockSession({ me: TEST_USER, ...options });
  return { ...session, ...renderApp(`/join/${TOKEN}`) };
}

const path = (router: { state: { location: { pathname: string; search: string } } }) =>
  `${router.state.location.pathname}${router.state.location.search}`;

describe('JoinPage', () => {
  it('signed out: sends to the landing with next=/join/<token>', async () => {
    mockSession({ me: null });
    const { router } = renderApp(`/join/${TOKEN}`);
    expect(await screen.findByRole('link', { name: 'Continuar con Google' })).toHaveAttribute(
      'href',
      `/api/v1/auth/google/login?next=${encodeURIComponent(`/join/${TOKEN}`)}`,
    );
    expect(path(router)).toBe(`/?next=${encodeURIComponent(`/join/${TOKEN}`)}`);
  });

  it('shows the event card with one coral Join button', async () => {
    renderJoin({ invites: { [TOKEN]: invitePreview() } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Familia' })).toHaveClass(
      'font-serif',
    );
    expect(screen.getByText('Organiza Beto Solís')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Beto Solís' })).toHaveTextContent('BS');
    expect(screen.getByText(/^₡15\s000$/)).toBeInTheDocument();
    expect(screen.getByText('1 participante')).toBeInTheDocument();
    const join = screen.getByRole('button', { name: 'Unirme' });
    expect(join).toHaveClass('bg-coral-pop');
    expect(screen.getByRole('main').querySelectorAll('.bg-coral-pop')).toHaveLength(1);
    expect(document.title).toBe('Secret Santa · Unirte al evento');
  });

  it('joins and opens the event', async () => {
    const user = userEvent.setup();
    const { spy, router } = renderJoin({
      invites: { [TOKEN]: invitePreview() },
      eventDetails: { 'joined-event': eventDetail({ id: 'joined-event', my_role: 'participant' }) },
    });
    await user.click(await screen.findByRole('button', { name: 'Unirme' }));
    await waitFor(() => {
      expect(path(router)).toBe('/events/joined-event');
    });
    expect(await screen.findByText('Ya estás en «Familia».')).toBeInTheDocument();
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe(`/api/v1/invites/${TOKEN}/join`);
  });

  it('already a participant: redirects to the event right away', async () => {
    const { router } = renderJoin({
      invites: {
        [TOKEN]: invitePreview({
          already_participant: true,
          event_id: 'e1',
          joinable: false,
          reason: 'ALREADY_PARTICIPANT',
        }),
      },
      eventDetails: { e1: eventDetail() },
    });
    await waitFor(() => {
      expect(path(router)).toBe('/events/e1');
    });
    expect(screen.queryByRole('button', { name: 'Unirme' })).not.toBeInTheDocument();
  });

  it('ALREADY_PARTICIPANT on join (another tab joined first) redirects too', async () => {
    const user = userEvent.setup();
    const { router } = renderJoin({
      invites: { [TOKEN]: invitePreview() },
      eventDetails: { e1: eventDetail() },
      joinResponse: () =>
        jsonResponse(409, {
          error: { code: 'ALREADY_PARTICIPANT', message: '', params: { event_id: 'e1' } },
        }),
    });
    await user.click(await screen.findByRole('button', { name: 'Unirme' }));
    await waitFor(() => {
      expect(path(router)).toBe('/events/e1');
    });
  });

  it('shows a toast when joining fails for another reason', async () => {
    const user = userEvent.setup();
    renderJoin({
      invites: { [TOKEN]: invitePreview() },
      joinResponse: () =>
        jsonResponse(409, { error: { code: 'JOIN_DEADLINE_PASSED', message: '' } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Unirme' }));
    expect(
      await screen.findByText('Ya pasó la fecha límite para unirse a este evento.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['EVENT_ALREADY_DRAWN', 'El sorteo ya se hizo y el grupo está cerrado.'],
    ['JOIN_DEADLINE_PASSED', 'Ya pasó la fecha límite para unirse.'],
  ] as const)('not joinable (%s): the reason and a way back', async (reason, text) => {
    renderJoin({ invites: { [TOKEN]: invitePreview({ joinable: false, reason }) } });
    expect(
      await screen.findByRole('heading', { name: 'Ya no te puedes unir a este evento' }),
    ).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a tus eventos' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Unirme' })).not.toBeInTheDocument();
  });

  it('an invalid or disabled link says so', async () => {
    renderJoin();
    expect(
      await screen.findByRole('heading', { name: 'Este enlace de invitación no es válido' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a tus eventos' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderJoin({ invites: { [TOKEN]: invitePreview() } });
    await screen.findByRole('button', { name: 'Unirme' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
