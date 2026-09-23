import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import { eventDetail, mockSession, renderApp, TEST_USER, urlOf } from '@/test/render';

const TOKEN = 'invite-token';
const EXPECTED_URL = `${window.location.origin}/join/${TOKEN}`;

async function renderManage(event: EventDetail = eventDetail()) {
  const session = mockSession({ me: TEST_USER, eventDetails: { [event.id]: event } });
  const utils = renderApp(`/events/${event.id}/manage`);
  const card = await screen.findByRole('region', { name: 'Enlace de invitación' });
  return { ...session, ...utils, card };
}

// userEvent.setup() installs its own clipboard stub, so spy on it after setup.
function setupWithClipboard() {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  return { user, writeText };
}

describe('InviteLinkCard', () => {
  let originalShare: PropertyDescriptor | undefined;
  beforeEach(() => {
    originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
  });
  afterEach(() => {
    if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
    else Reflect.deleteProperty(navigator, 'share');
  });

  it('shows the full join URL in the mono font', async () => {
    const { card } = await renderManage();
    const url = within(card).getByTestId('invite-url');
    expect(url).toHaveTextContent(EXPECTED_URL);
    expect(url).toHaveClass('font-mono', 'break-all');
    for (const button of within(card).getAllByRole('button')) {
      expect(button).toHaveClass('rounded-full-2');
    }
  });

  it('Copy writes the URL to the clipboard and toasts', async () => {
    const { user, writeText } = setupWithClipboard();
    const { card } = await renderManage();
    await user.click(within(card).getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith(EXPECTED_URL);
    expect(await screen.findByText('Enlace copiado.')).toBeInTheDocument();
  });

  it('a clipboard failure is reported', async () => {
    const { user, writeText } = setupWithClipboard();
    writeText.mockRejectedValue(new Error('denied'));
    const { card } = await renderManage();
    await user.click(within(card).getByRole('button', { name: 'Copiar' }));
    expect(await screen.findByText('No pudimos copiar el enlace.')).toBeInTheDocument();
  });

  it('Share appears only with the Web Share API, and shares the link', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const first = await renderManage();
    expect(within(first.card).queryByRole('button', { name: 'Compartir' })).toBeNull();
    first.unmount();

    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const user = userEvent.setup();
    const { card } = await renderManage();
    await user.click(within(card).getByRole('button', { name: 'Compartir' }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: EXPECTED_URL, title: 'Familia' }),
    );
  });

  it('Regenerate asks first, then shows the new link', async () => {
    const user = userEvent.setup();
    const { card, spy } = await renderManage();
    await user.click(within(card).getByRole('button', { name: 'Generar uno nuevo' }));
    const dialog = screen.getByRole('dialog', { name: '¿Generar un enlace nuevo?' });
    expect(dialog).toHaveTextContent('El enlace anterior dejará de funcionar.');

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(spy.mock.calls.some(([url]) => urlOf(url).endsWith('/regenerate'))).toBe(false);

    await user.click(within(card).getByRole('button', { name: 'Generar uno nuevo' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Generar enlace' }),
    );
    expect(await screen.findByText('Listo: hay un enlace nuevo.')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(card).getByTestId('invite-url')).toHaveTextContent(
        `${window.location.origin}/join/regenerated-token-1`,
      );
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Disable turns the link off; Enable brings a new one', async () => {
    const user = userEvent.setup();
    const { card, spy } = await renderManage();
    await user.click(within(card).getByRole('button', { name: 'Desactivar' }));
    expect(await within(card).findByText(/El enlace está desactivado/)).toBeInTheDocument();
    expect(within(card).queryByTestId('invite-url')).not.toBeInTheDocument();
    expect(spy.mock.calls.find(([, init]) => init?.method === 'DELETE')?.[0]).toBe(
      '/api/v1/events/e1/invite',
    );

    await user.click(within(card).getByRole('button', { name: 'Activar enlace' }));
    expect(await within(card).findByTestId('invite-url')).toHaveTextContent('regenerated-token');
  });

  it('when the event is not OPEN, joining is closed', async () => {
    const { card } = await renderManage(eventDetail({ state: 'drawn' }));
    expect(within(card).getByText(/Ya no se aceptan participantes/)).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = await renderManage();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Overview invite banner', () => {
  it('shows one coral banner with a copy action while the host is alone', async () => {
    const { user, writeText } = setupWithClipboard();
    mockSession({ me: TEST_USER, eventDetails: { e1: eventDetail({ participant_count: 1 }) } });
    renderApp('/events/e1');
    const banner = await screen.findByRole('heading', { level: 2, name: 'Invita a tus amigos' });
    expect(banner.closest('section')).toHaveClass('bg-coral-pop');
    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(writeText).toHaveBeenCalledWith(EXPECTED_URL);
  });

  it.each([
    ['more than one participant', { participant_count: 2 }],
    ['not the host', { my_role: 'participant' as const }],
    ['drawn', { state: 'drawn' as const }],
    ['link disabled', { invite_token: null }],
  ])('is hidden when %s', async (_case, overrides) => {
    mockSession({
      me: TEST_USER,
      eventDetails: { e1: eventDetail({ participant_count: 1, ...overrides }) },
    });
    renderApp('/events/e1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Invita a tus amigos')).not.toBeInTheDocument();
  });
});
