import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import {
  useWishlist,
  wishlistKeys,
  type CopySource,
  type Wishlist,
  type WishlistItem,
  type WishlistPhoto,
} from '@/features/wishlist/api';
import {
  createTestQueryClient,
  eventDetail,
  jsonResponse,
  mockSession,
  participant,
  renderApp,
  TEST_USER,
  urlOf,
} from '@/test/render';

const ANA = participant({
  user_id: TEST_USER.id,
  name: 'Ana Rojas',
  avatar_url: TEST_USER.avatar_url,
  is_host: true,
  is_self: true,
});
const BETO = participant({ user_id: 'u-beto', name: 'Beto Solís' });

const photo = (n: number): WishlistPhoto => ({
  id: `ph-${String(n)}`,
  url: `https://storage.test/full-${String(n)}.webp`,
  thumb_url: `https://storage.test/thumb-${String(n)}.webp`,
  width: 1600,
  height: 1200,
});

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

const mine = (items: WishlistItem[]): Wishlist => ({
  owner: { id: ANA.user_id, name: ANA.name, avatar_url: ANA.avatar_url },
  is_self: true,
  items,
});

const BETOS: Wishlist = {
  owner: { id: BETO.user_id, name: BETO.name, avatar_url: null },
  is_self: false,
  items: [item('x', 'Bufanda', { photos: [photo(1), photo(2)] })],
};

const file = (name = 'foto.jpg', size = 1024) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

async function renderTab({
  query = '',
  event = eventDetail(),
  items = [item('a', 'Audífonos')],
  photoUpload,
  copySources = {},
  copyItems = {},
}: {
  query?: string;
  event?: EventDetail;
  items?: WishlistItem[];
  photoUpload?: Parameters<typeof mockSession>[0]['photoUpload'];
  copySources?: Record<string, CopySource[]>;
  copyItems?: Record<string, WishlistItem[]>;
} = {}) {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: { [event.id]: event },
    participants: { [event.id]: [ANA, BETO] },
    wishlists: { [ANA.user_id]: mine(items), [BETO.user_id]: BETOS },
    ...(photoUpload ? { photoUpload } : {}),
    copySources,
    copyItems,
  });
  const utils = renderApp(`/events/${event.id}/wishlists${query}`);
  await screen.findByRole('group', { name: 'Lista de quién' });
  return { ...session, ...utils, event };
}

async function openEdit(title: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Editar ${title}` }));
  const sheet = screen.getByRole('dialog', { name: 'Editar artículo' });
  return { user, sheet };
}

const photoInput = () => screen.getByTestId('photo-input');

const calls = (spy: ReturnType<typeof mockSession>['spy'], method: string, part: string) =>
  spy.mock.calls
    .filter(([url, init]) => urlOf(url).includes(part) && init?.method === method)
    .map(([url, init]) => ({ url: urlOf(url), init }));

describe('Photo uploader (owner edit sheet)', () => {
  it('offers exactly three dashed slots, each with an "Add photo" pill', async () => {
    await renderTab();
    const { sheet } = await openEdit('Audífonos');
    const group = within(sheet).getByRole('group', { name: 'Fotos' });
    const slots = within(group).getAllByRole('listitem');
    expect(slots).toHaveLength(3);
    slots.forEach((slot) => {
      expect(slot).toHaveClass('border-dashed');
    });
    const add = within(group).getByRole('button', { name: 'Agregar foto 1 de 3' });
    expect(add).toHaveClass('rounded-full-2');
    expect(within(group).getAllByRole('button', { name: /^Agregar foto/ })).toHaveLength(3);
  });

  it('uploads with progress, shows the thumbnail, and offers no 4th slot', async () => {
    const { spy } = await renderTab({ items: [item('a', 'Audífonos', { photos: [photo(1)] })] });
    const { user, sheet } = await openEdit('Audífonos');
    const group = within(sheet).getByRole('group', { name: 'Fotos' });
    expect(within(group).getByRole('img', { name: 'Audífonos: foto 1 de 1' })).toHaveAttribute(
      'src',
      'https://storage.test/thumb-1.webp',
    );

    await user.upload(photoInput(), file());
    await waitFor(() => {
      expect(within(group).getAllByRole('img')).toHaveLength(2);
    });
    const [upload] = calls(spy, 'POST', '/photos');
    expect(upload?.url).toBe('/api/v1/wishlist/items/a/photos');
    expect((upload?.init?.headers as Record<string, string>)['X-Requested-With']).toBe('fetch');
    expect((upload?.init?.body as FormData).get('file')).toBeInstanceOf(File);

    await user.upload(photoInput(), file());
    await waitFor(() => {
      expect(within(group).getAllByRole('img')).toHaveLength(3);
    });
    expect(within(group).getAllByRole('listitem')).toHaveLength(3);
    expect(within(group).queryByRole('button', { name: /^Agregar foto/ })).not.toBeInTheDocument();
  });

  it('shows per-slot progress while a photo uploads', async () => {
    let finish: (response: Response) => void = () => undefined;
    await renderTab({
      photoUpload: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    const { user, sheet } = await openEdit('Audífonos');
    await user.upload(photoInput(), file());

    const bar = await within(sheet).findByRole('progressbar', {
      name: 'Progreso de la foto 1',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(within(sheet).getByText('Subiendo… 50 %')).toBeInTheDocument();
    // The other two slots are still offered.
    expect(within(sheet).getAllByRole('button', { name: /^Agregar foto/ })).toHaveLength(2);

    finish(jsonResponse(201, item('a', 'Audífonos', { photos: [photo(7)] })));
    await waitFor(() => {
      expect(within(sheet).queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  it('refuses files over 10 MB before uploading anything', async () => {
    const { spy } = await renderTab();
    const { user } = await openEdit('Audífonos');
    await user.upload(photoInput(), file('huge.jpg', 10 * 1024 * 1024 + 1));
    expect(await screen.findByText('El archivo pesa más de 10 MB.')).toBeInTheDocument();
    expect(calls(spy, 'POST', '/photos')).toEqual([]);
  });

  it('a refused upload shows the translated error and frees the slot', async () => {
    await renderTab({
      photoUpload: () => jsonResponse(409, { error: { code: 'PHOTO_LIMIT_REACHED', message: '' } }),
    });
    const { user, sheet } = await openEdit('Audífonos');
    await user.upload(photoInput(), file());
    expect(await screen.findByText('Cada artículo puede tener hasta 3 fotos.')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(sheet).getAllByRole('button', { name: /^Agregar foto/ })).toHaveLength(3);
    });
  });

  it('removes a photo', async () => {
    const { spy } = await renderTab({
      items: [item('a', 'Audífonos', { photos: [photo(1), photo(2)] })],
    });
    const { user, sheet } = await openEdit('Audífonos');
    await user.click(within(sheet).getByRole('button', { name: 'Quitar la foto 2' }));
    await waitFor(() => {
      expect(within(sheet).getAllByRole('img')).toHaveLength(1);
    });
    expect(calls(spy, 'DELETE', '/photos').map((c) => c.url)).toEqual([
      '/api/v1/wishlist/items/a/photos/ph-2',
    ]);
    expect(within(sheet).getAllByRole('button', { name: /^Agregar foto/ })).toHaveLength(2);
  });

  it('a new item gets photos after it is saved', async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(await screen.findByRole('button', { name: 'Agregar artículo' }));
    const sheet = screen.getByRole('dialog', { name: 'Agregar artículo' });
    expect(
      within(sheet).getByText('Guarda el artículo y luego edítalo para agregarle fotos.'),
    ).toBeInTheDocument();
    expect(within(sheet).queryByRole('group', { name: 'Fotos' })).not.toBeInTheDocument();
  });

  it('the edit sheet with photos has no axe violations', async () => {
    await renderTab({ items: [item('a', 'Audífonos', { photos: [photo(1)] })] });
    const { sheet } = await openEdit('Audífonos');
    expect(await axe(sheet)).toHaveNoViolations();
  });
});

describe('Item photos (card carousel)', () => {
  it('shows lazy thumbnails with "photo n of N" alt text and an indicator', async () => {
    await renderTab({ query: '?user=u-beto' });
    const card = within(await screen.findByRole('article', { name: 'Bufanda' }));
    const carousel = card.getByRole('region', { name: 'Fotos de Bufanda' });
    const imgs = within(carousel).getAllByRole('img', { hidden: true });
    expect(imgs.map((img) => img.getAttribute('alt'))).toEqual([
      'Bufanda: foto 1 de 2',
      'Bufanda: foto 2 de 2',
    ]);
    imgs.forEach((img, i) => {
      expect(img).toHaveAttribute('loading', 'lazy');
      expect(img).toHaveAttribute('src', `https://storage.test/thumb-${String(i + 1)}.webp`);
    });
    expect(card.getByText('1 / 2')).toBeInTheDocument();
  });

  it('opens a full-size lightbox on the photo being viewed', async () => {
    const user = userEvent.setup();
    await renderTab({ query: '?user=u-beto' });
    const card = within(await screen.findByRole('article', { name: 'Bufanda' }));
    await user.click(card.getByRole('button', { name: 'Foto siguiente' }));
    await user.click(card.getByRole('button', { name: 'Ver las fotos de Bufanda en grande' }));

    const lightbox = screen.getByRole('dialog', { name: 'Bufanda' });
    expect(within(lightbox).getByText('2 / 2')).toBeInTheDocument();
    const shown = within(lightbox).getByRole('img', { name: 'Bufanda: foto 2 de 2' });
    expect(shown).toHaveAttribute('src', 'https://storage.test/full-2.webp');
    expect(await axe(lightbox)).toHaveNoViolations();
  });

  it('items without photos show no carousel', async () => {
    await renderTab();
    const card = within(await screen.findByRole('article', { name: 'Audífonos' }));
    expect(card.queryByRole('region')).not.toBeInTheDocument();
  });
});

describe('Copy from another event', () => {
  const SOURCES: CopySource[] = [{ event_id: 'ev-2025', name: 'Navidad 2025', item_count: 2 }];

  it('lists my other lists, then imports the chosen one with a toast', async () => {
    const user = userEvent.setup();
    const event = eventDetail();
    const { spy } = await renderTab({
      event,
      copySources: { [event.id]: SOURCES },
      copyItems: {
        'ev-2025': [item('s1', 'Termo', { photos: [photo(3)] }), item('s2', 'Calcetines')],
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Copiar de otro evento' }));
    const sheet = screen.getByRole('dialog', { name: 'Copiar de otro evento' });
    const confirm = within(sheet).getByRole('button', { name: 'Copiar artículos' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveClass('bg-coral-pop');

    const choice = await within(sheet).findByRole('button', {
      name: 'Navidad 2025, 2 artículos',
    });
    await user.click(choice);
    expect(choice).toHaveAttribute('aria-pressed', 'true');
    expect(await axe(sheet)).toHaveNoViolations();
    await user.click(confirm);

    expect(await screen.findByText('Se importaron 2 artículos.')).toBeInTheDocument();
    expect(calls(spy, 'POST', '/copy-from/').map((c) => c.url)).toEqual([
      `/api/v1/events/${event.id}/wishlist/copy-from/ev-2025`,
    ]);
    await waitFor(() => {
      expect(
        within(screen.getByRole('list', { name: 'Mi lista de deseos' }))
          .getAllByRole('article')
          .map((card) => card.getAttribute('aria-label')),
      ).toEqual(['Audífonos', 'Termo', 'Calcetines']);
    });
    expect(screen.queryByRole('dialog', { name: 'Copiar de otro evento' })).not.toBeInTheDocument();
  });

  it('says so when there is nothing to copy', async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(await screen.findByRole('button', { name: 'Copiar de otro evento' }));
    expect(
      await screen.findByText('Todavía no tienes artículos en otras listas.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar artículos' })).toBeDisabled();
  });

  it('is offered only on my own list in an editable event', async () => {
    await renderTab({ query: '?user=u-beto' });
    await screen.findByRole('article', { name: 'Bufanda' });
    expect(screen.queryByRole('button', { name: 'Copiar de otro evento' })).not.toBeInTheDocument();
  });

  it('is not offered in an archived event', async () => {
    await renderTab({ event: eventDetail({ state: 'archived' }) });
    await screen.findByRole('article', { name: 'Audífonos' });
    expect(screen.queryByRole('button', { name: 'Copiar de otro evento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Audífonos' })).not.toBeInTheDocument();
  });
});

describe('useWishlist › presigned URL expiry', () => {
  it('goes stale well before the 1 h URLs expire and refetches on focus', async () => {
    mockSession({ me: TEST_USER, wishlists: { [BETO.user_id]: BETOS } });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useWishlist('ev', BETO.user_id), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const query = queryClient.getQueryCache().find({ queryKey: wishlistKeys.list('ev', 'u-beto') });
    const options = query?.options as {
      staleTime: number;
      refetchOnWindowFocus: boolean;
      refetchInterval: number;
    };
    expect(options.staleTime).toBeLessThan(60 * 60_000);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchInterval).toBeLessThan(60 * 60_000);
  });
});
