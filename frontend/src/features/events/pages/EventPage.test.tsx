import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventDetail } from '@/features/events/api';
import { eventDetail, mockSession, renderApp, TEST_USER } from '@/test/render';

const HOST_EVENT = eventDetail();
// A participant's view has no invite_token key at all.
const { invite_token: _hostOnly, ...GUEST_EVENT } = eventDetail({
  id: 'e2',
  name: 'Oficina',
  my_role: 'participant',
  host: { id: 'someone-else', name: 'Beto Solís', avatar_url: null },
});

async function renderEvent(path: string, events: EventDetail[] = [HOST_EVENT, GUEST_EVENT]) {
  const session = mockSession({
    me: TEST_USER,
    eventDetails: Object.fromEntries(events.map((e) => [e.id, e])),
  });
  const utils = renderApp(path);
  await screen.findByRole('heading', { level: 1 });
  return { ...session, ...utils };
}

function headerEl(): HTMLElement {
  const header = screen.getByRole('heading', { level: 1 }).closest('header');
  if (!header) throw new Error('no header');
  return header;
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const location = (router: { state: { location: { pathname: string } } }) =>
  router.state.location.pathname;

describe('EventPage header', () => {
  it('shows state + HOSTING eyebrows, serif name, budget, date and place', async () => {
    await renderEvent('/events/e1');
    const h = within(headerEl());
    expect(h.getByText('Abierto')).toHaveClass('font-mono', 'uppercase');
    expect(h.getByText('Organizando')).toHaveClass('font-mono', 'uppercase');
    expect(h.getByRole('heading', { level: 1, name: 'Familia' })).toHaveClass(
      'font-serif',
      'text-heading',
      'md:text-heading-lg',
    );
    expect(h.getByText(/^₡15\s000$/)).toBeInTheDocument();
    expect(h.getByText('Heredia')).toBeInTheDocument();
    expect(document.title).toBe('Secret Santa · Familia');
  });

  it('shows "Online" and no HOSTING for a participant of an online event', async () => {
    await renderEvent('/events/e2', [{ ...GUEST_EVENT, is_online: true, location: null }]);
    const header = headerEl();
    expect(within(header).queryByText('Organizando')).not.toBeInTheDocument();
    expect(within(header).getByText('En línea')).toBeInTheDocument();
  });
});

describe('EventPage tabs ↔ URL', () => {
  it('host: five tabs; clicking changes the URL, and Back/Forward follow', async () => {
    const user = userEvent.setup();
    const { router } = await renderEvent('/events/e1');
    expect(tabNames()).toEqual([
      'Resumen',
      'Participantes',
      'Listas de deseos',
      'Chat',
      'Administrar',
    ]);
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'Participantes' }));
    expect(location(router)).toBe('/events/e1/participants');
    expect(screen.getByRole('tab', { name: 'Participantes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby');

    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(location(router)).toBe('/events/e1/chat');

    await router.navigate(-1);
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Participantes' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    await router.navigate(1);
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    });

    await user.click(screen.getByRole('tab', { name: 'Resumen' }));
    expect(location(router)).toBe('/events/e1');
  });

  it('opens the tab named in the URL (reload keeps the tab)', async () => {
    await renderEvent('/events/e1/wishlists');
    expect(screen.getByRole('tab', { name: 'Listas de deseos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it.each(['/events/e1/manage-xyz', '/events/e1/overview', '/events/e1/nope'])(
    '%s redirects to Overview',
    async (path) => {
      const { router } = await renderEvent(path);
      await waitFor(() => {
        expect(location(router)).toBe('/events/e1');
      });
      expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    },
  );

  it('Manage is hidden for non-hosts, and its URL falls back to Overview', async () => {
    const { router } = await renderEvent('/events/e2/manage');
    await waitFor(() => {
      expect(location(router)).toBe('/events/e2');
    });
    expect(tabNames()).not.toContain('Administrar');
    expect(tabNames()).toHaveLength(4);
  });
});

describe('Overview', () => {
  it('keeps line breaks in the description and shows details and host', async () => {
    await renderEvent('/events/e2');
    const description = screen.getByText(/Traer algo hecho a mano/);
    expect(description).toHaveClass('whitespace-pre-line');
    expect(description.textContent).toContain('\n');
    const host = screen.getByRole('region', { name: 'Organiza' });
    expect(within(host).getByText('Beto Solís')).toHaveClass('font-serif');
    expect(within(host).getByRole('img', { name: 'Beto Solís' })).toHaveTextContent('BS');
    expect(screen.getByText('3 participantes')).toBeInTheDocument();
    expect(screen.getByText('Activado')).toBeInTheDocument();
  });
});

describe('not found', () => {
  it('shows a typographic not-found page with a way back', async () => {
    await renderEvent('/events/unknown');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'No encontramos este evento',
    );
    expect(screen.getByRole('link', { name: 'Volver a tus eventos' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});

describe('Manage › Edit', () => {
  const field = (name: string) => screen.getByLabelText(name);

  it('OPEN: every field is editable and Delete is offered', async () => {
    await renderEvent('/events/e1/manage');
    for (const label of [
      'Nombre del evento',
      'Descripción (opcional)',
      'Presupuesto',
      'Fecha y hora del intercambio',
      'Fecha límite para unirse (opcional)',
      'Lugar (opcional)',
    ]) {
      expect(field(label)).toBeEnabled();
    }
    expect(field('Nombre del evento')).toHaveValue('Familia');
    expect(field('Presupuesto')).toHaveValue('15000');
    expect(screen.getByRole('button', { name: 'Eliminar evento' })).toBeInTheDocument();
  });

  it('DRAWN: only description, location/online and date are editable; no Delete', async () => {
    await renderEvent('/events/e1/manage', [{ ...HOST_EVENT, state: 'drawn' }]);
    expect(
      screen.getByText(
        'El sorteo ya se hizo: solo puedes cambiar la descripción, el lugar y la fecha.',
      ),
    ).toBeInTheDocument();
    expect(field('Nombre del evento')).toBeDisabled();
    expect(field('Presupuesto')).toBeDisabled();
    expect(field('Fecha límite para unirse (opcional)')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Chat grupal' })).toBeDisabled();

    expect(field('Descripción (opcional)')).toBeEnabled();
    expect(field('Lugar (opcional)')).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'En línea' })).toBeEnabled();
    expect(field('Fecha y hora del intercambio')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Eliminar evento' })).not.toBeInTheDocument();
  });

  it('saves only what changed, toasts, and Overview shows both lines', async () => {
    const user = userEvent.setup();
    const { spy, router } = await renderEvent('/events/e1/manage', [
      { ...HOST_EVENT, description: null },
    ]);
    await user.type(field('Descripción (opcional)'), 'Primera línea{Enter}Segunda línea');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    const patch = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toBe('/api/v1/events/e1');
    expect(JSON.parse(patch?.[1]?.body as string)).toEqual({
      description: 'Primera línea\nSegunda línea',
    });

    await user.click(screen.getByRole('tab', { name: 'Resumen' }));
    expect(location(router)).toBe('/events/e1');
    expect(screen.getByText(/Primera línea/).textContent).toBe('Primera línea\nSegunda línea');
  });

  it('a DRAWN event whose date already passed can still save its description', async () => {
    const user = userEvent.setup();
    const { spy } = await renderEvent('/events/e1/manage', [
      { ...HOST_EVENT, state: 'drawn', exchange_at: '2020-12-20T19:00:00-06:00' },
    ]);
    await user.type(field('Descripción (opcional)'), '!');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    const patch = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(Object.keys(JSON.parse(patch?.[1]?.body as string) as object)).toEqual(['description']);
  });
});

describe('Manage › Delete', () => {
  it('confirms in a modal naming the event, deletes, toasts and goes home', async () => {
    const user = userEvent.setup();
    const { spy, router } = await renderEvent('/events/e1/manage');

    const open = screen.getByRole('button', { name: 'Eliminar evento' });
    expect(open).toHaveClass('border-terracotta-whisper');
    await user.click(open);
    const dialog = screen.getByRole('dialog', { name: '¿Eliminar «Familia»?' });
    expect(dialog).toHaveTextContent('Esto no se puede deshacer.');

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Eliminar evento' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, eliminar' }),
    );

    expect(await screen.findByText('Evento eliminado.')).toBeInTheDocument();
    await waitFor(() => {
      expect(location(router)).toBe('/');
    });
    const del = spy.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(del?.[0]).toBe('/api/v1/events/e1');
    expect(screen.queryByRole('heading', { name: 'No encontramos este evento' })).toBeNull();
  });
});

describe('accessibility', () => {
  it.each(['/events/e1', '/events/e1/manage', '/events/unknown'])(
    '%s has no axe violations',
    async (path) => {
      const { container } = await renderEvent(path);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
