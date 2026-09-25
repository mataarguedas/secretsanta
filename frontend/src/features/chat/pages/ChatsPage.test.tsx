import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

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

// An anonymous initiator as the recipient sees them. The API never sends a real identity;
// these "leaked" fields prove the UI wouldn't show one even if it did.
const ELF = member({
  id: 'mem-elf',
  display_name: 'Beto Secreto',
  avatar_url: 'https://lh3.googleusercontent.com/leak.png',
  is_anonymous: true,
  anon_number: 7,
});

const OFFICE = { id: 'ev-office', name: 'Oficina 2026', state: 'drawn' as const };
const FAMILY = { id: 'ev-family', name: 'Familia', state: 'open' as const };

const CONVERSATIONS = [
  conversation({
    id: 'anon',
    event: OFFICE,
    kind: 'anonymous',
    title_member: ELF,
    last_message: message({
      id: 'm1',
      conversation_id: 'anon',
      sender_member_id: ELF.id,
      body: '¿Talla?',
    }),
    last_message_at: '2026-09-24T12:00:00Z',
    unread_count: 2,
  }),
  conversation({
    id: 'fam-direct',
    event: FAMILY,
    kind: 'direct',
    last_message: message({
      id: 'm2',
      conversation_id: 'fam-direct',
      sender_member_id: MY_MEMBER.id,
      body: 'Nos vemos',
    }),
    unread_count: 0,
  }),
  conversation({
    id: 'office-group',
    event: OFFICE,
    kind: 'group',
    title_member: null,
    last_message: message({ id: 'm3', conversation_id: 'office-group', deleted: true, body: null }),
    unread_count: 1,
  }),
];

async function renderChats(conversations = CONVERSATIONS) {
  mockSession({ me: TEST_USER, conversations });
  const utils = renderApp('/chats');
  await screen.findByRole('heading', { level: 1, name: 'Chats' });
  return utils;
}

describe('Chats page', () => {
  it('groups conversations by event, in order of latest activity', async () => {
    await renderChats();
    const office = await screen.findByRole('region', { name: 'Oficina 2026' });
    const family = screen.getByRole('region', { name: 'Familia' });
    expect(within(office).getByRole('heading', { level: 2 })).toHaveClass('font-serif');
    expect(within(office).getByText('Sorteado')).toHaveClass('font-mono', 'uppercase');
    expect(within(family).getByText('Abierto')).toBeInTheDocument();
    expect(office.compareDocumentPosition(family) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const officeRows = within(office).getAllByRole('link');
    expect(officeRows.map((row) => row.getAttribute('href'))).toEqual([
      '/chats/anon',
      '/chats/office-group',
    ]);
  });

  it('rows: preview, "You:" for mine, "Message deleted", and an unread count', async () => {
    await renderChats();
    const anon = await screen.findByRole('link', {
      name: 'Elfo secreto #7, 2 mensajes sin leer',
    });
    expect(anon).toHaveTextContent('¿Talla?');
    expect(within(anon).getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Beto Solís/ })).toHaveTextContent('Tú: Nos vemos');
    expect(screen.getByRole('link', { name: /Chat grupal/ })).toHaveTextContent(
      'Mensaje eliminado',
    );
  });

  it('an anonymous member is only ever the alias and the ✦ avatar', async () => {
    await renderChats();
    const row = await screen.findByRole('link', { name: /Elfo secreto #7/ });
    expect(within(row).getByText('Elfo secreto #7')).toHaveClass('font-mono', 'uppercase');
    const avatar = within(row).getByRole('img', { name: 'Elfo secreto #7' });
    expect(avatar).toHaveTextContent('✦');
    expect(document.body).not.toHaveTextContent('Beto Secreto');
    expect(document.querySelector('img[src*="leak"]')).toBeNull();
  });

  it('the Chats nav shows the total unread count', async () => {
    await renderChats();
    const tabBar = screen.getByRole('navigation', { name: 'Navegación' });
    const chats = await within(tabBar).findByRole('link', { name: /Chats/ });
    expect(chats).toHaveTextContent('3');
    expect(chats).toHaveAccessibleName('Chats, 3 mensajes sin leer');
  });

  it('empty state: serif headline, one line, one CTA', async () => {
    await renderChats([]);
    expect(await screen.findByText('Todavía no tienes conversaciones')).toHaveClass('font-serif');
    expect(screen.getByRole('link', { name: 'Ir a mis eventos' })).toHaveAttribute('href', '/');
  });

  it('follows every loaded conversation over the socket and updates live', async () => {
    await renderChats();
    await screen.findByRole('region', { name: 'Oficina 2026' });
    const ws = FakeWebSocket.latest();
    if (!ws) throw new Error('no socket');
    act(() => {
      ws.open();
    });
    const subscribed = ws
      .frames()
      .filter((f) => f.type === 'subscribe')
      .flatMap((f) => f.conversation_ids as string[]);
    expect(new Set(subscribed)).toEqual(new Set(['anon', 'fam-direct', 'office-group']));

    act(() => {
      ws.receive({
        type: 'message',
        conversation_id: 'fam-direct',
        message: message({
          id: 'live',
          conversation_id: 'fam-direct',
          body: '¡Llegó!',
          created_at: '2026-09-25T09:00:00Z',
        }),
      });
    });
    const row = await screen.findByRole('link', { name: 'Beto Solís, 1 mensaje sin leer' });
    expect(row).toHaveTextContent('¡Llegó!');
    const tabBar = screen.getByRole('navigation', { name: 'Navegación' });
    expect(within(tabBar).getByRole('link', { name: /Chats/ })).toHaveAccessibleName(
      'Chats, 4 mensajes sin leer',
    );
  });

  it('has no axe violations', async () => {
    const { container } = await renderChats();
    await screen.findByRole('region', { name: 'Oficina 2026' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
