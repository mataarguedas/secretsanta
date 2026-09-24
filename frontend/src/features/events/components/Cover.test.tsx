import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import { toLocalInputValue } from '@/lib/datetime';
import {
  eventDetail,
  eventSummary,
  jsonResponse,
  mockSession,
  renderApp,
  TEST_USER,
  urlOf,
} from '@/test/render';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const photo = (name = 'playa.jpg', size = 1024) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

beforeEach(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

const fileInput = (root: ParentNode = document) => {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  return input;
};

const uploads = (spy: ReturnType<typeof mockSession>['spy']) =>
  spy.mock.calls.filter(([url, init]) => urlOf(url).endsWith('/cover') && init?.method === 'POST');

describe('Create event › cover photo', () => {
  async function renderCreate(options: Omit<Parameters<typeof mockSession>[0], 'me'> = {}) {
    const session = mockSession({
      me: TEST_USER,
      eventDetails: { 'new-event': eventDetail({ id: 'new-event' }) },
      ...options,
    });
    const utils = renderApp('/events/new');
    await screen.findByRole('heading', { level: 1, name: 'Crear evento' });
    return { ...session, ...utils };
  }

  async function fillAndPick(user: ReturnType<typeof userEvent.setup>, file: File) {
    await user.type(screen.getByLabelText('Nombre del evento'), 'Familia');
    await user.type(screen.getByLabelText('Presupuesto'), '15000');
    const when = screen.getByLabelText('Fecha y hora del intercambio');
    fireEvent.change(when, {
      target: { value: toLocalInputValue(new Date(Date.now() + 30 * 86_400_000)) },
    });
    fireEvent.blur(when);
    await user.upload(fileInput(), file);
  }

  it('accepts only the four image types and previews the choice', async () => {
    const user = userEvent.setup();
    await renderCreate();
    const group = screen.getByRole('group', { name: 'Foto de portada' });
    expect(fileInput(group)).toHaveAttribute('accept', ACCEPT);
    await user.upload(fileInput(group), photo());
    expect(
      within(group).getByRole('img', { name: 'Vista previa de la foto de portada elegida' }),
    ).toHaveAttribute('src', 'blob:preview');
    expect(within(group).getByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument();
  });

  it('refuses files over 10 MB before uploading anything', async () => {
    const user = userEvent.setup();
    await renderCreate();
    await user.upload(fileInput(), photo('huge.jpg', 10 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('El archivo pesa más de 10 MB.');
    expect(screen.queryByRole('img', { name: /Vista previa/ })).not.toBeInTheDocument();
  });

  it('creates the event, then uploads the cover with progress, then opens the event', async () => {
    const user = userEvent.setup();
    const { spy, router } = await renderCreate();
    await fillAndPick(user, photo());
    await user.click(screen.getByRole('button', { name: 'Crear evento' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/events/new-event');
    });
    const calls = spy.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url]) => urlOf(url));
    expect(calls).toEqual(['/api/v1/events', '/api/v1/events/new-event/cover']);
    const [, init] = uploads(spy)[0] ?? [];
    const sent = (init?.body as FormData).get('file') as File;
    expect(sent.name).toBe('playa.jpg');
    expect(await screen.findByRole('img', { name: 'Foto de portada de Familia' })).toHaveAttribute(
      'src',
      'https://storage.test/cover-1.webp',
    );
  });

  it('a failed photo upload still opens the created event, with a toast', async () => {
    const user = userEvent.setup();
    const { router } = await renderCreate({
      coverUpload: () => jsonResponse(415, { error: { code: 'UNSUPPORTED_IMAGE', message: '' } }),
    });
    await fillAndPick(user, photo('notes.jpg'));
    await user.click(screen.getByRole('button', { name: 'Crear evento' }));

    expect(
      await screen.findByText(/El evento se creó, pero la foto no se pudo subir/),
    ).toHaveTextContent('Ese archivo no es una imagen compatible.');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/events/new-event');
    });
  });
});

describe('Manage › cover photo', () => {
  async function renderManage(event: EventDetail, options = {}) {
    const session = mockSession({ me: TEST_USER, eventDetails: { [event.id]: event }, ...options });
    const utils = renderApp(`/events/${event.id}/manage`);
    await screen.findByRole('heading', { level: 1 });
    return { ...session, ...utils };
  }

  it('uploads as soon as a file is picked, then shows it in the header', async () => {
    const user = userEvent.setup();
    const { spy } = await renderManage(eventDetail());
    const section = screen.getByRole('region', { name: 'Foto de portada' });
    expect(within(section).getByRole('button', { name: 'Elegir foto' })).toBeInTheDocument();

    await user.upload(fileInput(section), photo());
    expect(await screen.findByText('Foto de portada guardada.')).toBeInTheDocument();
    expect(uploads(spy)).toHaveLength(1);
    const images = screen.getAllByRole('img', { name: 'Foto de portada de Familia' });
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://storage.test/cover-1.webp', // header
      'https://storage.test/cover-1.webp', // preview in the picker
    ]);
    expect(images[0]).toHaveClass('rounded-none', 'object-cover');
    expect(images[0]).not.toHaveClass('rounded-full-2');
  });

  it('shows server errors under the picker', async () => {
    const user = userEvent.setup();
    await renderManage(eventDetail(), {
      coverUpload: () => jsonResponse(413, { error: { code: 'FILE_TOO_LARGE', message: '' } }),
    });
    const section = screen.getByRole('region', { name: 'Foto de portada' });
    await user.upload(fileInput(section), photo());
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'El archivo pesa más de 10 MB.',
    );
  });

  it('removes the cover', async () => {
    const user = userEvent.setup();
    const withCover = eventDetail({
      cover_url: 'https://storage.test/old.webp',
      cover_thumb_url: 'https://storage.test/old_thumb.webp',
    });
    const { spy, container } = await renderManage(withCover);
    const section = screen.getByRole('region', { name: 'Foto de portada' });
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(section).getByRole('button', { name: 'Quitar foto' }));
    expect(await screen.findByText('Foto de portada quitada.')).toBeInTheDocument();
    expect(
      spy.mock.calls.some(
        ([url, init]) => urlOf(url) === '/api/v1/events/e1/cover' && init?.method === 'DELETE',
      ),
    ).toBe(true);
    expect(screen.queryByRole('img', { name: 'Foto de portada de Familia' })).toBeNull();
  });

  it('is not offered after the draw', async () => {
    await renderManage(eventDetail({ state: 'drawn' }));
    expect(screen.queryByRole('region', { name: 'Foto de portada' })).not.toBeInTheDocument();
  });
});

describe('Cover on the dashboard card', () => {
  it('shows the thumbnail with alt text, square-cornered', async () => {
    mockSession({
      me: TEST_USER,
      events: {
        hosting: [
          eventSummary({ cover_thumb_url: 'https://storage.test/t_thumb.webp' }),
          eventSummary({ id: 'no-cover', name: 'Sin foto' }),
        ],
      },
    });
    renderApp('/');
    const image = await screen.findByRole('img', { name: 'Foto de portada de Oficina 2026' });
    expect(image).toHaveAttribute('src', 'https://storage.test/t_thumb.webp');
    expect(image).toHaveClass('rounded-none');
    expect(screen.queryByRole('img', { name: 'Foto de portada de Sin foto' })).toBeNull();
  });
});
