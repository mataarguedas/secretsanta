import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { formatDate } from '@/lib/format';
import { eventSummary, renderWithProviders } from '@/test/render';

import { EventCard } from './EventCard';

describe('EventCard', () => {
  it('is one interactive link with state, serif name, count, date and budget', () => {
    const event = eventSummary({ participant_count: 1 });
    renderWithProviders(<EventCard event={event} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `/events/${event.id}`);
    expect(link).toHaveClass('border-ink-black', 'bg-pure-white');
    expect(link.className).not.toMatch(/shadow/);
    expect(screen.getByText('Abierto')).toHaveClass('font-mono', 'uppercase', 'text-coral-pop');
    expect(screen.getByRole('heading', { name: 'Oficina 2026' })).toHaveClass('font-serif');
    expect(screen.getByText('1 participante')).toBeInTheDocument();
    // es-CR grouping with a (narrow) no-break space: ₡25 000.
    expect(screen.getByText(/^₡25\s000$/)).toBeInTheDocument();
    expect(screen.getByText(formatDate(event.exchange_at, 'es'))).toHaveAttribute(
      'datetime',
      event.exchange_at,
    );
  });

  it('pluralizes the participant count', () => {
    renderWithProviders(<EventCard event={eventSummary({ participant_count: 12 })} />);
    expect(screen.getByText('12 participantes')).toBeInTheDocument();
  });

  it('localizes state and date, but money stays in colones', async () => {
    await i18n.changeLanguage('en');
    const event = eventSummary({ state: 'drawn', budget_crc: 15000 });
    renderWithProviders(<EventCard event={event} />);
    expect(screen.getByText('Drawn')).toBeInTheDocument();
    expect(screen.getByText(formatDate(event.exchange_at, 'en'))).toBeInTheDocument();
    expect(screen.getByText(formatDate(event.exchange_at, 'en'))).toHaveTextContent(/Dec/);
    expect(screen.getByText(/^₡15\s000$/)).toBeInTheDocument();
  });
});
