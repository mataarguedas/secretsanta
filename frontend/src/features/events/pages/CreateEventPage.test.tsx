import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import i18n from '@/i18n';
import { toLocalInputValue } from '@/lib/datetime';
import { jsonResponse, mockSession, renderApp, TEST_USER } from '@/test/render';

const inDays = (days: number) => toLocalInputValue(new Date(Date.now() + days * 86_400_000));

async function renderForm(options: Omit<Parameters<typeof mockSession>[0], 'me'> = {}) {
  const session = mockSession({ me: TEST_USER, ...options });
  const utils = renderApp('/events/new');
  await screen.findByRole('heading', { level: 1, name: 'Crear evento' });
  return { ...session, ...utils };
}

const field = (name: string) => screen.getByLabelText(name);
const submit = () => screen.getByRole('button', { name: 'Crear evento' });

/** datetime-local can't be typed key by key in jsdom; set the value like a picker does. */
function pickDate(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
  fireEvent.blur(field(label));
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field('Nombre del evento'), 'Familia');
  await user.type(field('Presupuesto'), '15000');
  pickDate('Fecha y hora del intercambio', inDays(30));
}

const postBody = (spy: ReturnType<typeof mockSession>['spy']) => {
  const call = spy.mock.calls.find(([, init]) => init?.method === 'POST');
  return call ? (JSON.parse(call[1]?.body as string) as Record<string, unknown>) : undefined;
};

describe('CreateEventPage', () => {
  it('shows translated inline errors for an empty form and sends nothing', async () => {
    const user = userEvent.setup();
    const { spy } = await renderForm();
    await user.click(submit());

    expect(await screen.findByText('Debe tener entre 3 y 80 caracteres.')).toHaveClass(
      'text-error',
    );
    expect(screen.getByText('Indica un presupuesto.')).toBeInTheDocument();
    expect(screen.getByText('Elige la fecha del intercambio.')).toBeInTheDocument();
    expect(field('Nombre del evento')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Nombre del evento')).toHaveFocus();
    expect(postBody(spy)).toBeUndefined();
  });

  it('shows the errors in English for an English-speaking user', async () => {
    const user = userEvent.setup();
    mockSession({ me: { ...TEST_USER, locale: 'en' } });
    renderApp('/events/new');
    await user.click(await screen.findByRole('button', { name: 'Create event' }));
    expect(i18n.language).toBe('en');
    expect(await screen.findByText('Must be between 3 and 80 characters.')).toBeInTheDocument();
    expect(screen.getByText('Enter a budget.')).toBeInTheDocument();
  });

  it.each([
    ['a 2-letter name', 'Nombre del evento', 'ab', 'Debe tener entre 3 y 80 caracteres.'],
    ['a decimal budget', 'Presupuesto', '12.5', 'Usa solo números enteros, sin decimales.'],
    ['letters in the budget', 'Presupuesto', 'mil', 'Usa solo números enteros, sin decimales.'],
  ])('rejects %s on blur', async (_case, label, value, message) => {
    const user = userEvent.setup();
    await renderForm();
    await user.type(field(label), value);
    await user.tab();
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('rejects a past date and a deadline after the exchange', async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.type(field('Nombre del evento'), 'Familia');
    await user.type(field('Presupuesto'), '15000');
    pickDate('Fecha y hora del intercambio', inDays(-1));
    pickDate('Fecha límite para unirse (opcional)', inDays(8));
    await user.click(submit());
    expect(await screen.findByText('La fecha debe estar en el futuro.')).toBeInTheDocument();

    pickDate('Fecha y hora del intercambio', inDays(5));
    await user.click(submit());
    expect(
      await screen.findByText('Debe ser antes de la fecha del intercambio.'),
    ).toBeInTheDocument();
  });

  it('Online disables the location, and group chat defaults on', async () => {
    const user = userEvent.setup();
    await renderForm();
    expect(screen.getByRole('switch', { name: 'Chat grupal' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(field('Lugar (opcional)')).toBeEnabled();
    await user.click(screen.getByRole('switch', { name: 'En línea' }));
    expect(field('Lugar (opcional)')).toBeDisabled();
  });

  it('counts description characters', async () => {
    const user = userEvent.setup();
    await renderForm();
    expect(screen.getByText('0 / 1000')).toBeInTheDocument();
    await user.type(field('Descripción (opcional)'), 'Hola');
    expect(screen.getByText('4 / 1000')).toBeInTheDocument();
  });

  it('submits valid data with an offset date and opens the new event', async () => {
    const user = userEvent.setup();
    const { spy, router, queryClient } = await renderForm();
    await fillValid(user);
    await user.type(field('Lugar (opcional)'), 'Heredia');
    await user.click(submit());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/events/new-event');
    });
    const body = postBody(spy);
    expect(body).toMatchObject({
      name: 'Familia',
      description: null,
      budget_crc: 15000,
      join_deadline: null,
      location: 'Heredia',
      is_online: false,
      group_chat_enabled: true,
    });
    expect(body?.exchange_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
    expect(queryClient.getQueryData(['events', 'new-event'])).toMatchObject({ name: 'Familia' });
  });

  it('puts a server validation error on its field', async () => {
    const user = userEvent.setup();
    await renderForm({
      createEvent: () =>
        jsonResponse(422, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The request is invalid.',
            params: { fields: [{ loc: ['body', 'exchange_at'], type: 'value_error' }] },
          },
        }),
    });
    await fillValid(user);
    await user.click(submit());
    expect(await screen.findByText('Revisa este campo.')).toBeInTheDocument();
    expect(field('Fecha y hora del intercambio')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows other server errors as a toast', async () => {
    const user = userEvent.setup();
    const { router } = await renderForm({
      createEvent: () =>
        jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }),
    });
    await fillValid(user);
    await user.click(submit());
    expect(
      await screen.findByText('Demasiados intentos. Espera un momento e inténtalo de nuevo.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/events/new');
  });

  it('the submit is a sticky full-width pill on mobile, content-sized on desktop', async () => {
    await renderForm();
    expect(submit()).toHaveClass('bg-coral-pop', 'rounded-full-2', 'w-full', 'md:w-auto');
    const bar = submit().parentElement;
    expect(bar).toHaveClass('sticky', 'md:static');
    expect(bar?.className).toContain(
      'bottom-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom))]',
    );
    expect(screen.getByRole('main').querySelectorAll('.bg-coral-pop')).toHaveLength(1);
  });

  it('has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = await renderForm();
    await user.click(submit());
    await screen.findByText('Indica un presupuesto.');
    expect(await axe(container)).toHaveNoViolations();
  });
});
