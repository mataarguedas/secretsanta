import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { EventSection, EventSummary } from '@/features/events/api';
import {
  eventSummary,
  jsonResponse,
  mockSession,
  renderApp,
  TEST_USER,
  urlOf,
} from '@/test/render';

const hostingEvent = eventSummary({ id: 'e-host', name: 'Oficina 2026' });
const joinedEvent = eventSummary({
  id: 'e-joined',
  name: 'Familia Rojas',
  is_host: false,
  participant_count: 6,
});
const pastEvent = eventSummary({ id: 'e-past', name: 'Navidad 2025', state: 'archived' });

async function renderDashboard(events: Partial<Record<EventSection, EventSummary[]>>) {
  mockSession({ me: TEST_USER, events });
  const utils = renderApp('/');
  await screen.findByRole('heading', { level: 1 });
  return utils;
}

const sectionHeadings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('DashboardPage', () => {
  it('renders Hosting, Participating and Past in order, as card grids', async () => {
    await renderDashboard({
      hosting: [hostingEvent],
      participating: [joinedEvent],
      past: [pastEvent],
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tus eventos');
    expect(sectionHeadings()).toEqual([
      'Eventos que organizas',
      'Eventos en los que participas',
      'Pasados',
    ]);

    const hosting = screen.getByRole('region', { name: 'Eventos que organizas' });
    expect(within(hosting).getByText('Organizando')).toHaveClass('font-mono', 'uppercase');
    expect(within(hosting).getByRole('list')).toHaveClass(
      'grid-cols-1',
      'md:grid-cols-2',
      'lg:grid-cols-3',
    );
    expect(within(hosting).getByRole('link', { name: /Oficina 2026/ })).toHaveAttribute(
      'href',
      '/events/e-host',
    );
    const participating = screen.getByRole('region', { name: 'Eventos en los que participas' });
    expect(within(participating).getByText('6 participantes')).toBeInTheDocument();
    const past = screen.getByRole('region', { name: 'Pasados' });
    expect(within(past).getByText('Archivado')).toBeInTheDocument();
    expect(document.title).toBe('Secret Santa · Tus eventos');
  });

  it('has exactly one coral Create event button, in the header', async () => {
    const { container } = await renderDashboard({ hosting: [hostingEvent] });
    const create = screen.getByRole('link', { name: 'Crear evento' });
    expect(create).toHaveAttribute('href', '/events/new');
    expect(create).toHaveClass('bg-coral-pop');
    expect(screen.getByRole('main').querySelectorAll('.bg-coral-pop')).toHaveLength(1);
    expect(container.querySelectorAll('[class*="shadow-"]')).toHaveLength(0);
  });

  it('hides empty Participating and Past, but always shows Hosting', async () => {
    await renderDashboard({ participating: [joinedEvent] });
    expect(sectionHeadings()).toEqual(['Eventos que organizas', 'Eventos en los que participas']);
    expect(screen.getByText('Todavía no organizas ningún evento.')).toBeInTheDocument();
  });

  it('shows a typographic empty state when there are no events at all', async () => {
    await renderDashboard({});
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Tu primer intercambio empieza aquí',
    );
    expect(
      screen.getByText('Crea un evento e invita a tu gente con un enlace.'),
    ).toBeInTheDocument();
    const ctas = screen.getAllByRole('link', { name: 'Crear evento' });
    expect(ctas).toHaveLength(1);
    expect(ctas[0]).toHaveClass('bg-coral-pop');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('loads more pages with the cursor', async () => {
    const user = userEvent.setup();
    const first = Array.from({ length: 20 }, (_, i) =>
      eventSummary({ id: `e${String(i)}`, name: `Evento ${String(i)}` }),
    );
    const extra = eventSummary({ id: 'e20', name: 'Evento 20' });
    const empty = { items: [], next_cursor: null };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = urlOf(input);
      if (url === '/api/v1/me') return Promise.resolve(jsonResponse(200, TEST_USER));
      if (url === '/api/v1/events?section=hosting')
        return Promise.resolve(jsonResponse(200, { items: first, next_cursor: 'CURSOR' }));
      if (url === '/api/v1/events?section=hosting&cursor=CURSOR')
        return Promise.resolve(jsonResponse(200, { items: [extra], next_cursor: null }));
      return Promise.resolve(jsonResponse(200, empty));
    });
    renderApp('/');
    const hosting = await screen.findByRole('region', { name: 'Eventos que organizas' });
    expect(within(hosting).getAllByRole('listitem')).toHaveLength(20);

    await user.click(within(hosting).getByRole('button', { name: 'Ver más' }));

    expect(await within(hosting).findByText('Evento 20')).toBeInTheDocument();
    expect(within(hosting).getAllByRole('listitem')).toHaveLength(21);
    expect(within(hosting).queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.map(([input]) => urlOf(input))).toContain(
      '/api/v1/events?section=hosting&cursor=CURSOR',
    );
  });

  it('a failing section offers a retry without hiding the others', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = urlOf(input);
      if (url === '/api/v1/me') return Promise.resolve(jsonResponse(200, TEST_USER));
      if (url.includes('section=past'))
        return Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL_ERROR' } }));
      return Promise.resolve(
        jsonResponse(200, {
          items: url.includes('hosting') ? [hostingEvent] : [],
          next_cursor: null,
        }),
      );
    });
    renderApp('/');
    const past = await screen.findByRole('region', { name: 'Pasados' });
    expect(within(past).getByText('No pudimos cargar esta sección.')).toHaveClass('text-error');
    expect(within(past).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Oficina 2026/ })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = await renderDashboard({
      hosting: [hostingEvent],
      participating: [joinedEvent],
      past: [pastEvent],
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('empty state has no axe violations', async () => {
    const { container } = await renderDashboard({});
    expect(await axe(container)).toHaveNoViolations();
  });
});
