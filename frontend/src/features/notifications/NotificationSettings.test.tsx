import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { fakePush, UA, type FakePushOptions } from '@/test/push';
import { mockSession, pushDevice, renderApp, TEST_USER, TEST_VAPID_KEY } from '@/test/render';

import { base64UrlToBytes, type PushDevice } from './api';

let restore: () => void = () => undefined;
afterEach(() => {
  restore();
});

function sectionTitled(name: string): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name }).closest('section');
  if (!section) throw new Error(`no section ${name}`);
  return section;
}

async function renderProfile(
  env: FakePushOptions = {},
  session: { devices?: PushDevice[]; vapidKey?: string | null; patchError?: number } = {},
) {
  const push = fakePush(env);
  restore = push.restore;
  const mocked = mockSession({ me: TEST_USER, ...session });
  const utils = renderApp('/profile');
  await screen.findByRole('heading', { level: 1, name: TEST_USER.name });
  const section = sectionTitled('Notificaciones'); // (the toast region shares the name)
  const devices = sectionTitled('Dispositivos');
  return { ...push, ...mocked, ...utils, section, devices };
}

describe('Profile › Notifications', () => {
  it('never asks for permission on load', async () => {
    const { requestPermission, section } = await renderProfile();
    expect(
      await within(section).findByRole('button', { name: 'Activar notificaciones' }),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50)); // let every effect run
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('Enable: asks from the click, subscribes with the VAPID key and registers the device', async () => {
    const user = userEvent.setup();
    const { requestPermission, subscribe, section, devices, calls, spy } = await renderProfile();
    const enable = within(section).getByRole('button', { name: 'Activar notificaciones' });
    expect(enable).toHaveClass('bg-coral-pop'); // the page's only primary action

    await user.click(enable);

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Notificaciones activadas en este dispositivo.')).toBeVisible();
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(TEST_VAPID_KEY),
    });
    expect(calls()).toContain('GET /api/v1/push/vapid-public-key');
    const posted = spy.mock.calls.find(
      ([url, init]) => url === '/api/v1/push/subscriptions' && init?.method === 'POST',
    );
    expect(JSON.parse(posted?.[1]?.body as string)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      user_agent: UA.chromeWindows,
    });

    expect(
      within(section).getByText('Las notificaciones están activadas en este dispositivo.'),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Activar notificaciones' })).toBeNull();
    const row = within(devices).getByRole('listitem');
    expect(row).toHaveTextContent('Chrome en Windows');
    expect(row).toHaveTextContent('Este dispositivo');
  });

  it('a denied answer shows how to unblock, and nothing is subscribed', async () => {
    const user = userEvent.setup();
    const { subscribe, section, calls } = await renderProfile({ answer: 'denied' });
    await user.click(within(section).getByRole('button', { name: 'Activar notificaciones' }));
    expect(
      await within(section).findByText('Las notificaciones están bloqueadas para este sitio.'),
    ).toHaveClass('text-error');
    expect(within(section).getByText(/abre la configuración del sitio/)).toBeInTheDocument();
    expect(within(section).queryByRole('button')).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
    expect(calls()).not.toContain('POST /api/v1/push/subscriptions');
  });

  it('dismissing the prompt leaves the button for later', async () => {
    const user = userEvent.setup();
    const { section, subscribe } = await renderProfile({ answer: 'default' });
    await user.click(within(section).getByRole('button', { name: 'Activar notificaciones' }));
    await waitFor(() => {
      expect(within(section).getByRole('button', { name: 'Activar notificaciones' })).toBeEnabled();
    });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('already blocked: instructions instead of the button', async () => {
    const { section } = await renderProfile({ permission: 'denied' });
    expect(
      within(section).getByText('Las notificaciones están bloqueadas para este sitio.'),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('a server without VAPID keys says so', async () => {
    const user = userEvent.setup();
    const { section } = await renderProfile({}, { vapidKey: null });
    await user.click(within(section).getByRole('button', { name: 'Activar notificaciones' }));
    expect(
      await screen.findByText('Las notificaciones no están configuradas en este servidor.'),
    ).toBeInTheDocument();
  });

  it('iPhone in Safari: the install guide instead of the enable button', async () => {
    const user = userEvent.setup();
    const { section, requestPermission } = await renderProfile({
      supported: false,
      userAgent: UA.safariIphone,
    });
    expect(within(section).queryByRole('button', { name: 'Activar notificaciones' })).toBeNull();
    expect(within(section).getByText(/solo funcionan con la app instalada/)).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Cómo instalar la app' }));
    const guide = screen.getByRole('dialog', { name: 'Agregar a la pantalla de inicio' });
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
    expect(within(guide).getByText(/Compartir/)).toBeInTheDocument();
    expect(await axe(guide)).toHaveNoViolations();
    await user.click(within(guide).getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('iPhone app installed on the Home Screen: the enable button', async () => {
    const { section } = await renderProfile({ userAgent: UA.safariIphone, standalone: true });
    expect(
      within(section).getByRole('button', { name: 'Activar notificaciones' }),
    ).toBeInTheDocument();
  });

  it('a browser without push says it plainly', async () => {
    const { section } = await renderProfile({ supported: false });
    expect(
      within(section).getByText('Este navegador no puede recibir notificaciones.'),
    ).toBeInTheDocument();
  });

  it('Send test notification (non-production builds, once a device exists)', async () => {
    const user = userEvent.setup();
    const { section, calls } = await renderProfile(
      { permission: 'granted' },
      { devices: [pushDevice()] },
    );
    await user.click(
      await within(section).findByRole('button', { name: 'Enviar notificación de prueba' }),
    );
    expect(await screen.findByText(/Notificación de prueba enviada/)).toBeInTheDocument();
    expect(calls()).toContain('POST /api/v1/push/test');
  });

  it('no devices: no test button', async () => {
    const { section, devices } = await renderProfile();
    await within(devices).findByText('Ningún dispositivo recibe notificaciones todavía.');
    expect(
      within(section).queryByRole('button', { name: 'Enviar notificación de prueba' }),
    ).toBeNull();
  });
});

describe('Profile › Devices', () => {
  const PHONE = pushDevice({
    id: 'phone',
    browser: 'Safari',
    os: 'iPhone',
    last_success_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  });
  const LAPTOP = pushDevice({ id: 'laptop', browser: 'Firefox', os: null });

  it('lists every device with when it was added and last notified', async () => {
    const { devices } = await renderProfile({}, { devices: [LAPTOP, PHONE] });
    const rows = await within(devices).findAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('p')?.textContent)).toEqual([
      'Safari en iPhone',
      'Firefox',
    ]);
    expect(rows[0]).toHaveTextContent(/Agregado el .*última notificación hace 2 h/);
    expect(rows[1]).not.toHaveTextContent('última notificación');
  });

  it('Remove takes the device off the list', async () => {
    const user = userEvent.setup();
    const { devices, calls } = await renderProfile({}, { devices: [LAPTOP, PHONE] });
    await user.click(
      await within(devices).findByRole('button', { name: 'Quitar Safari en iPhone' }),
    );
    expect(await screen.findByText('Dispositivo quitado.')).toBeInTheDocument();
    expect(calls()).toContain('DELETE /api/v1/push/subscriptions/phone');
    expect(within(devices).getAllByRole('listitem')).toHaveLength(1);
  });

  it('removing this browser unsubscribes it, and Enable comes back', async () => {
    const user = userEvent.setup();
    const { section, devices, unsubscribe } = await renderProfile();
    await user.click(within(section).getByRole('button', { name: 'Activar notificaciones' }));
    await within(section).findByText('Las notificaciones están activadas en este dispositivo.');

    await user.click(within(devices).getByRole('button', { name: 'Quitar Chrome en Windows' }));
    expect(
      await within(section).findByRole('button', { name: 'Activar notificaciones' }),
    ).toBeInTheDocument();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container, devices } = await renderProfile({}, { devices: [PHONE] });
    await within(devices).findAllByRole('listitem');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Profile › What to notify', () => {
  const group = (section: HTMLElement) =>
    within(section).getByRole('group', { name: 'Qué notificar' });

  it('the draw is always on: checked, disabled, and says why', async () => {
    const { section } = await renderProfile();
    const reveal = within(group(section)).getByRole('switch', { name: 'Sorteo' });
    expect(reveal).toBeChecked();
    expect(reveal).toBeDisabled();
    expect(reveal).toHaveAccessibleDescription(
      'Siempre activado: todos necesitan saber cuándo se hace el sorteo.',
    );
  });

  it('shows the three toggles from /me, even before push is enabled here', async () => {
    const { section } = await renderProfile({ supported: false });
    const toggles = within(group(section)).getAllByRole('switch');
    expect(toggles.map((s) => s.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(
      within(group(section)).getByRole('switch', { name: 'Cambios en la lista de deseos' }),
    ).toHaveAccessibleDescription('Cuando la persona a quien le regalas cambia su lista.');
  });

  it('a toggle is optimistic and PATCHes /me', async () => {
    const user = userEvent.setup();
    const { section, spy } = await renderProfile();
    const messages = within(group(section)).getByRole('switch', { name: 'Mensajes' });
    await user.click(messages);
    expect(messages).not.toBeChecked(); // at once, before the response
    await waitFor(() => {
      const patch = spy.mock.calls.find(
        ([url, init]) => url === '/api/v1/me' && init?.method === 'PATCH',
      );
      expect(JSON.parse(patch?.[1]?.body as string)).toEqual({ notify_message: false });
    });
    await user.click(messages);
    await waitFor(() => {
      expect(messages).toBeChecked();
    });
  });

  it('a failed save rolls the switch back and says so', async () => {
    const user = userEvent.setup();
    const { section } = await renderProfile({}, { patchError: 500 });
    const reminders = within(group(section)).getByRole('switch', { name: 'Recordatorios' });
    await user.click(reminders);
    expect(await screen.findByText(/Algo salió mal/)).toBeInTheDocument();
    await waitFor(() => {
      expect(reminders).toBeChecked();
    });
  });

  it('has no axe violations', async () => {
    const { section } = await renderProfile();
    expect(await axe(section)).toHaveNoViolations();
  });
});
