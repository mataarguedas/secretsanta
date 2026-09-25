import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { ConversationDetail, MessagePublic } from '@/features/chat/api';
import { FakeWebSocket } from '@/test/fakeWebSocket';
import {
  conversation,
  member,
  message,
  mockSession,
  MY_MEMBER,
  renderApp,
  TEST_USER,
} from '@/test/render';

const HISTORY: MessagePublic[] = [
  message({ id: 'm2', body: 'Me gustan los libros', created_at: '2026-09-24T12:05:00Z' }),
  message({ id: 'm1', body: 'Hola', created_at: '2026-09-24T12:00:00Z' }),
];

async function renderThread({
  conv = conversation(),
  history = HISTORY,
  socket = 'open',
  sendFails,
  messagePageSize,
}: {
  conv?: ConversationDetail;
  history?: MessagePublic[];
  socket?: 'open' | 'down';
  sendFails?: string;
  messagePageSize?: number;
} = {}) {
  const session = mockSession({
    me: TEST_USER,
    conversations: [conv],
    messages: { [conv.id]: history },
    ...(sendFails ? { sendFails } : {}),
    ...(messagePageSize ? { messagePageSize } : {}),
  });
  const utils = renderApp(`/chats/${conv.id}`);
  await screen.findByRole('region', { name: /./ });
  await screen.findByRole('list', { name: 'Mensajes' });
  const ws = FakeWebSocket.latest();
  if (!ws) throw new Error('the app should open its socket when signed in');
  if (socket === 'open') {
    act(() => {
      ws.open();
    });
  }
  return { ...session, ...utils, ws };
}

const bubbles = () =>
  within(screen.getByRole('list', { name: 'Mensajes' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('p')?.textContent);

async function type(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Escribir un mensaje' }), text);
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  return user;
}

describe('Thread page', () => {
  it('shows the history oldest first, and marks it read and active', async () => {
    const { ws, calls } = await renderThread();
    expect(bubbles()).toEqual(['Hola', 'Me gustan los libros']);
    expect(screen.getByRole('heading', { level: 1, name: 'Beto Solís' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Oficina 2026' })).toHaveAttribute(
      'href',
      `/events/${conversation().event.id}/chat`,
    );
    await waitFor(() => {
      expect(calls()).toContain('POST /api/v1/conversations/conv-1/read');
    });
    expect(ws.frames()).toContainEqual({ type: 'active', conversation_id: 'conv-1' });
    expect(document.title).toBe('Secret Santa · Beto Solís');
  });

  it('Send is the only coral primary, and the tab bar is gone', async () => {
    await renderThread();
    // (The desktop header's selected "Chats" pill is coral too: that's the nav state.)
    const coral = document.querySelectorAll('main .bg-coral-pop, button.bg-coral-pop');
    expect(coral).toHaveLength(1);
    expect(coral[0]).toHaveAccessibleName('Enviar');
    expect(screen.queryByRole('navigation', { name: 'Navegación' })).not.toBeInTheDocument();
  });

  it('sends optimistically over the socket and reconciles on the ack', async () => {
    const { ws } = await renderThread();
    await type('  ¿Qué talla usás?  ');

    const pending = screen.getByText('¿Qué talla usás?').closest('li');
    if (!pending) throw new Error('no bubble');
    expect(pending).toHaveAttribute('data-status', 'pending');
    expect(within(pending).getByText('Enviando…')).toBeInTheDocument();
    const sent = ws.frames().find((f) => f.type === 'send');
    expect(sent).toMatchObject({ conversation_id: 'conv-1', body: '¿Qué talla usás?' });
    expect(typeof sent?.client_id).toBe('string');

    act(() => {
      ws.receive({ type: 'ack', client_id: sent?.client_id, message_id: 'm3' });
    });
    await waitFor(() => {
      expect(screen.getByText('¿Qué talla usás?').closest('li')).not.toHaveAttribute('data-status');
    });
    // The broadcast copy of the same message doesn't duplicate it.
    act(() => {
      ws.receive({
        type: 'message',
        conversation_id: 'conv-1',
        message: message({ id: 'm3', sender_member_id: MY_MEMBER.id, body: '¿Qué talla usás?' }),
      });
    });
    expect(screen.getAllByText('¿Qué talla usás?')).toHaveLength(1);
  });

  it('a refused send is marked failed with Retry, and Retry sends it again', async () => {
    const { ws } = await renderThread();
    const user = await type('otra vez');
    const first = ws.frames().find((f) => f.type === 'send');
    act(() => {
      ws.receive({ type: 'error', client_id: first?.client_id, code: 'RATE_LIMITED' });
    });
    const failed = await screen.findByText(/No se envió\. Demasiados intentos/);
    expect(failed).toHaveClass('text-error');
    expect(screen.getByText('otra vez').closest('li')).toHaveAttribute('data-status', 'failed');

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    const retried = ws.frames().filter((f) => f.type === 'send');
    expect(retried).toHaveLength(2);
    expect(retried[1]?.client_id).not.toBe(first?.client_id);
    act(() => {
      ws.receive({ type: 'ack', client_id: retried[1]?.client_id, message_id: 'm9' });
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    });
  });

  it('falls back to REST while the socket is down', async () => {
    const { calls } = await renderThread({ socket: 'down' });
    await type('por REST');
    await waitFor(() => {
      expect(screen.getByText('por REST').closest('li')).not.toHaveAttribute('data-status');
    });
    expect(calls()).toContain('POST /api/v1/conversations/conv-1/messages');
  });

  it('a failed REST send shows the reason', async () => {
    await renderThread({ socket: 'down', sendFails: 'CONVERSATION_READ_ONLY' });
    await type('no va');
    expect(await screen.findByText(/No se envió\. Este evento está archivado/)).toBeInTheDocument();
  });

  it('shows a reconnecting state when the socket drops', async () => {
    const { ws } = await renderThread();
    act(() => {
      ws.serverClose(1006);
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Reconectando…');
  });

  it('incoming messages appear and are announced politely', async () => {
    const { ws } = await renderThread();
    act(() => {
      ws.receive({
        type: 'message',
        conversation_id: 'conv-1',
        message: message({ id: 'm4', body: '¿Y la talla?', created_at: '2026-09-24T12:10:00Z' }),
      });
    });
    expect(await screen.findByText('¿Y la talla?')).toBeInTheDocument();
    const live = document.querySelector('[aria-live="polite"].sr-only');
    await waitFor(() => {
      expect(live).toHaveTextContent('Nuevo mensaje de Beto Solís: ¿Y la talla?');
    });
  });

  it('deletes my message after a confirm, leaving a placeholder', async () => {
    const mine = message({ id: 'mine', sender_member_id: MY_MEMBER.id, body: 'Borrame' });
    await renderThread({ history: [mine, ...HISTORY] });
    const user = userEvent.setup();
    // Only my message has a delete action.
    expect(screen.getAllByRole('button', { name: 'Eliminar tu mensaje' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Eliminar tu mensaje' }));
    const dialog = screen.getByRole('dialog', { name: '¿Eliminar este mensaje?' });
    await user.click(within(dialog).getByRole('button', { name: 'Sí, eliminar' }));
    expect(await screen.findByText('Mensaje eliminado')).toBeInTheDocument();
    expect(screen.queryByText('Borrame')).not.toBeInTheDocument();
  });

  it('loads older messages on request', async () => {
    const older = message({ id: 'm0', body: 'El primero', created_at: '2026-09-24T11:00:00Z' });
    await renderThread({ history: [...HISTORY, older], messagePageSize: 2 });
    expect(bubbles()).toEqual(['Hola', 'Me gustan los libros']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cargar mensajes anteriores' }));
    await waitFor(() => {
      expect(bubbles()).toEqual(['El primero', 'Hola', 'Me gustan los libros']);
    });
    expect(
      screen.queryByRole('button', { name: 'Cargar mensajes anteriores' }),
    ).not.toBeInTheDocument();
  });

  it('archived: no composer, a read-only note', async () => {
    await renderThread({
      conv: conversation({ event: { ...conversation().event, state: 'archived' } }),
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.getByText('Este evento está archivado: los chats son de solo lectura.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar tu mensaje' })).not.toBeInTheDocument();
  });

  it('counts characters and refuses more than 2000', async () => {
    await renderThread();
    const box = screen.getByRole('textbox', { name: 'Escribir un mensaje' });
    const user = userEvent.setup();
    await user.click(box);
    await user.paste('x'.repeat(2001));
    expect(screen.getByText('Máximo 2000 caracteres.')).toHaveClass('text-error');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await user.clear(box);
    await user.type(box, '   ');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    expect(screen.getByText('3 / 2000')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = await renderThread();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Thread page › anonymity', () => {
  it('the anonymous initiator sees the persistent notice', async () => {
    await renderThread({
      conv: conversation({
        kind: 'anonymous',
        my_member: member({ ...MY_MEMBER, is_anonymous: true, anon_number: 7, avatar_url: null }),
      }),
    });
    expect(screen.getByText('Eres anónimo: te ven como Elfo secreto #7.')).toBeInTheDocument();
  });

  it('the recipient sees only SECRET ELF #N and ✦, never a name, even if one leaked', async () => {
    const elf = member({
      id: 'mem-elf',
      display_name: 'Beto Secreto',
      avatar_url: 'https://lh3.googleusercontent.com/leak.png',
      is_anonymous: true,
      anon_number: 3,
    });
    const conv = conversation({ kind: 'anonymous', title_member: elf, members: [MY_MEMBER, elf] });
    const { ws } = await renderThread({
      conv,
      history: [message({ id: 'e1', sender_member_id: elf.id, body: '¿Te gusta leer?' })],
    });
    act(() => {
      ws.receive({
        type: 'message',
        conversation_id: conv.id,
        message: message({ id: 'e2', sender_member_id: elf.id, body: '¿Fantasía?' }),
      });
    });
    await screen.findByText('¿Fantasía?');

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Elfo secreto #3');
    expect(within(heading).getByText('Elfo secreto #3')).toHaveClass('font-mono', 'uppercase');
    expect(screen.getAllByRole('img', { name: 'Elfo secreto #3' })[0]).toHaveTextContent('✦');
    expect(document.body).not.toHaveTextContent('Beto Secreto');
    expect(document.querySelector('img[src*="leak"]')).toBeNull();
    expect(document.title).toBe('Secret Santa · Elfo secreto #3');
    expect(screen.queryByText(/Eres anónimo/)).not.toBeInTheDocument();
  });
});
