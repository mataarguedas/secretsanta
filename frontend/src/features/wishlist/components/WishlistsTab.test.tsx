import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import type { Wishlist, WishlistItem } from '@/features/wishlist/api';
import { formatCRC } from '@/lib/format';
import { eventDetail, mockSession, participant, renderApp, TEST_USER, urlOf } from '@/test/render';

const ANA = participant({
  user_id: TEST_USER.id,
  name: 'Ana Rojas',
  avatar_url: TEST_USER.avatar_url,
  is_host: true,
  is_self: true,
});
const BETO = participant({ user_id: 'u-beto', name: 'Beto Solís' });
const CARLA = participant({ user_id: 'u-carla', name: 'Carla Mora' });

const item = (id: string, title: string, extra: Partial<WishlistItem> = {}): WishlistItem => ({
  id,
  title,
  note: null,
  url: null,
  price_crc: null,
  priority: 'medium',
  position: 0,
  photos: [],
  ...extra,
});

const MINE: Wishlist = {
  owner: { id: ANA.user_id, name: ANA.name, avatar_url: ANA.avatar_url },
  is_self: true,
  items: [
    item('a', 'Audífonos', {
      priority: 'high',
      price_crc: 30000,
      url: 'https://tienda.example/audifonos',
    }),
    item('b', 'Libro'),
    item('c', 'Taza', { priority: 'low', note: 'Grande\nde cerámica' }),
  ],
};
const BETOS: Wishlist = {
  owner: { id: BETO.user_id, name: BETO.name, avatar_url: null },
  is_self: false,
  items: [item('x', 'Bufanda', { url: 'https://tienda.example/bufanda' })],
};
const CARLAS: Wishlist = {
  owner: { id: CARLA.user_id, name: CARLA.name, avatar_url: null },
  is_self: false,
  items: [],
};

async function renderTab({
  query = '',
  event = eventDetail(),
  mine = MINE,
  reorderFails = false,
}: {
  query?: string;
  event?: EventDetail;
  mine?: Wishlist;
  reorderFails?: boolean;
} = {}) {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: [ANA, BETO, CARLA] },
    wishlists: { [ANA.user_id]: mine, [BETO.user_id]: BETOS, [CARLA.user_id]: CARLAS },
    reorderFails,
  });
  const utils = renderApp(`/events/${event.id}/wishlists${query}`);
  await screen.findByRole('group', { name: 'Lista de quién' });
  return { ...session, ...utils };
}

const titles = async (name = 'Mi lista de deseos') =>
  within(await screen.findByRole('list', { name }))
    .getAllByRole('article')
    .map((card) => card.getAttribute('aria-label'));

const requests = (spy: ReturnType<typeof mockSession>['spy'], method: string) =>
  spy.mock.calls
    .filter(([url, init]) => urlOf(url).includes('/wishlist') && init?.method === method)
    .map(([url, init]) => ({
      url: urlOf(url),
      body: init?.body ? (JSON.parse(init.body as string) as unknown) : undefined,
    }));

describe('Wishlists tab › picker', () => {
  it('lists "Mi lista" first and shows my wishlist by default', async () => {
    await renderTab();
    const picker = screen.getByRole('group', { name: 'Lista de quién' });
    const pills = within(picker).getAllByRole('button');
    ['Mi lista', 'Beto Solís', 'Carla Mora'].forEach((name, index) => {
      expect(pills[index]).toHaveAccessibleName(name);
    });
    expect(pills[0]).toHaveAttribute('aria-pressed', 'true');
    expect(await titles()).toEqual(['Audífonos', 'Libro', 'Taza']);
  });

  it('opens the person in ?user= and keeps the URL in sync', async () => {
    const user = userEvent.setup();
    const { router } = await renderTab({ query: '?user=u-beto' });
    expect(await titles('Lista de deseos de Beto Solís')).toEqual(['Bufanda']);

    await user.click(screen.getByRole('button', { name: 'Carla Mora' }));
    expect(router.state.location.search).toBe('?user=u-carla');
    expect(await screen.findByText('Carla Mora todavía no ha agregado nada')).toBeInTheDocument();
  });

  it('falls back to my wishlist for an unknown ?user=', async () => {
    await renderTab({ query: '?user=someone-who-left' });
    expect(await titles()).toEqual(['Audífonos', 'Libro', 'Taza']);
  });
});

describe('Wishlists tab › items', () => {
  it('cards show the priority pill, the price, the note and a safe store link', async () => {
    await renderTab();
    const card = within(await screen.findByRole('article', { name: 'Audífonos' }));
    expect(card.getByText('Alta')).toBeInTheDocument();
    // formatCRC groups with a no-break space; match on any whitespace.
    expect(formatCRC(30000)).toMatch(/^₡30\s000$/);
    expect(card.getByText(/^₡30\s000$/)).toHaveClass('font-mono');
    const link = card.getByRole('link', {
      name: 'Ver Audífonos en la tienda (se abre en otra pestaña)',
    });
    expect(link).toHaveAttribute('href', 'https://tienda.example/audifonos');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveClass('rounded-full-2');
    expect(screen.getByRole('article', { name: 'Taza' })).toHaveTextContent('Grande de cerámica', {
      normalizeWhitespace: true,
    });
  });

  it('a viewer gets no add, edit, delete or reorder controls', async () => {
    await renderTab({ query: '?user=u-beto' });
    const list = await screen.findByRole('list', { name: 'Lista de deseos de Beto Solís' });
    const buttons = within(list).queryAllByRole('button');
    expect(buttons).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Agregar artículo' })).not.toBeInTheDocument();
    expect(within(list).getByRole('listitem')).not.toHaveAttribute('draggable', 'true');
  });

  it('a viewer of an empty list sees the empty state without a CTA', async () => {
    await renderTab({ query: '?user=u-carla' });
    expect(
      await screen.findByText('Vuelve más tarde o pregúntale por el chat.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar artículo' })).not.toBeInTheDocument();
  });

  it('my empty list: serif headline, one line and one coral CTA', async () => {
    await renderTab({ mine: { ...MINE, items: [] } });
    expect(await screen.findByText('Tu lista está vacía')).toHaveClass('font-serif');
    const cta = screen.getByRole('button', { name: 'Agregar artículo' });
    expect(cta).toHaveClass('bg-coral-pop');
  });
});

describe('Wishlists tab › owner', () => {
  it('adds an item, refusing a javascript: link inline first', async () => {
    const user = userEvent.setup();
    const { spy } = await renderTab();
    await titles();
    await user.click(screen.getByRole('button', { name: 'Agregar artículo' }));
    const sheet = screen.getByRole('dialog', { name: 'Agregar artículo' });

    await user.type(within(sheet).getByLabelText('¿Qué es?'), 'Termo');
    await user.type(
      within(sheet).getByLabelText('Enlace de la tienda (opcional)'),
      'javascript:alert(1)',
    );
    await user.click(within(sheet).getByRole('button', { name: 'Agregar' }));
    expect(
      await within(sheet).findByText('Usa un enlace que empiece con http:// o https://.'),
    ).toHaveClass('text-error');
    expect(requests(spy, 'POST')).toEqual([]);

    const link = within(sheet).getByLabelText('Enlace de la tienda (opcional)');
    await user.clear(link);
    await user.type(link, 'https://tienda.example/termo');
    await user.type(within(sheet).getByLabelText('Precio aproximado (opcional)'), '12000');
    await user.selectOptions(within(sheet).getByLabelText('Prioridad'), 'high');
    await user.click(within(sheet).getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText('Artículo agregado.')).toBeInTheDocument();
    expect(requests(spy, 'POST')[0]?.body).toEqual({
      title: 'Termo',
      note: null,
      url: 'https://tienda.example/termo',
      price_crc: 12000,
      priority: 'high',
    });
    await waitFor(async () => {
      expect(await titles()).toEqual(['Audífonos', 'Libro', 'Taza', 'Termo']);
    });
  });

  it('refuses a 121-character title', async () => {
    const user = userEvent.setup();
    const { spy } = await renderTab();
    await titles();
    await user.click(screen.getByRole('button', { name: 'Agregar artículo' }));
    const sheet = screen.getByRole('dialog');
    const title = within(sheet).getByLabelText('¿Qué es?');
    // maxLength stops typing; paste-like input still has to be validated.
    fireEvent.input(title, { target: { value: 'x'.repeat(121) } });
    await user.click(within(sheet).getByRole('button', { name: 'Agregar' }));
    expect(await within(sheet).findByText('Máximo 120 caracteres.')).toBeInTheDocument();
    expect(requests(spy, 'POST')).toEqual([]);
  });

  it('edits in a prefilled sheet and sends the changes', async () => {
    const user = userEvent.setup();
    const { spy } = await renderTab();
    await titles();
    await user.click(screen.getByRole('button', { name: 'Editar Libro' }));
    const sheet = screen.getByRole('dialog', { name: 'Editar artículo' });
    expect(within(sheet).getByLabelText('¿Qué es?')).toHaveValue('Libro');
    await user.selectOptions(within(sheet).getByLabelText('Prioridad'), 'high');
    await user.click(within(sheet).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    const [patch] = requests(spy, 'PATCH');
    expect(patch?.url).toBe('/api/v1/events/e1/wishlist/items/b');
    expect(patch?.body).toMatchObject({ title: 'Libro', priority: 'high' });
    const card = await screen.findByRole('article', { name: 'Libro' });
    await waitFor(() => {
      expect(card).toHaveTextContent('Alta');
    });
  });

  it('deletes after confirming', async () => {
    const user = userEvent.setup();
    const { spy } = await renderTab();
    await titles();
    await user.click(screen.getByRole('button', { name: 'Eliminar Taza' }));
    const dialog = screen.getByRole('dialog', { name: '¿Eliminar «Taza»?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(requests(spy, 'DELETE')).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Eliminar Taza' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, eliminar' }),
    );
    expect(await screen.findByText('Artículo eliminado.')).toBeInTheDocument();
    expect(requests(spy, 'DELETE')[0]?.url).toBe('/api/v1/events/e1/wishlist/items/c');
    await waitFor(async () => {
      expect(await titles()).toEqual(['Audífonos', 'Libro']);
    });
  });

  it('up/down pills reorder (optimistically) and save the new order', async () => {
    const user = userEvent.setup();
    const { spy } = await renderTab();
    await titles();
    expect(screen.getByRole('button', { name: 'Subir Audífonos' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar Taza' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Bajar Audífonos' }));
    expect(await titles()).toEqual(['Libro', 'Audífonos', 'Taza']);
    await waitFor(() => {
      expect(requests(spy, 'PUT')[0]?.body).toEqual({ item_ids: ['b', 'a', 'c'] });
    });

    await user.click(screen.getByRole('button', { name: 'Subir Taza' }));
    await waitFor(() => {
      expect(requests(spy, 'PUT')[1]?.body).toEqual({ item_ids: ['b', 'c', 'a'] });
    });
    expect(await titles()).toEqual(['Libro', 'Taza', 'Audífonos']);
  });

  it('rolls the order back when saving fails', async () => {
    const user = userEvent.setup();
    await renderTab({ reorderFails: true });
    await titles();
    await user.click(screen.getByRole('button', { name: 'Bajar Audífonos' }));
    expect(
      await screen.findByText('No se pudo guardar el nuevo orden. Inténtalo de nuevo.'),
    ).toBeInTheDocument();
    await waitFor(async () => {
      expect(await titles()).toEqual(['Audífonos', 'Libro', 'Taza']);
    });
  });

  it('drag and drop moves a card to where it is dropped', async () => {
    const { spy } = await renderTab();
    await titles();
    const rows = within(screen.getByRole('list', { name: 'Mi lista de deseos' })).getAllByRole(
      'listitem',
    );
    const [first, , last] = rows;
    if (!first || !last) throw new Error('rows expected');
    expect(last).toHaveAttribute('draggable', 'true');

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: 'all',
    };
    const fire = (element: Element, create: typeof createEvent.dragStart) => {
      const event = create(element);
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      fireEvent(element, event);
    };
    fire(last, createEvent.dragStart);
    fire(first, createEvent.dragOver);
    fire(first, createEvent.drop);

    await waitFor(() => {
      expect(requests(spy, 'PUT')[0]?.body).toEqual({ item_ids: ['c', 'a', 'b'] });
    });
    expect(await titles()).toEqual(['Taza', 'Audífonos', 'Libro']);
  });

  it('archived: my list is read-only', async () => {
    await renderTab({ event: eventDetail({ state: 'archived' }) });
    expect(
      await screen.findByText('Este evento está archivado: las listas son de solo lectura.'),
    ).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Mi lista de deseos' });
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Agregar artículo' })).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = await renderTab();
    await titles();
    expect(await axe(container)).toHaveNoViolations();
  });
});
