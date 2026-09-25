import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakePush, UA, type FakePushOptions } from '@/test/push';
import { eventSummary, mockSession, renderApp, TEST_USER } from '@/test/render';

import { listenForInstallPrompt, resetInstallPrompt } from './installPrompt';

const EVENT = eventSummary();

let cleanups: (() => void)[] = [];
beforeEach(() => {
  resetInstallPrompt();
  cleanups.push(listenForInstallPrompt());
});
afterEach(() => {
  cleanups.forEach((fn) => {
    fn();
  });
  cleanups = [];
});

async function renderDashboard(env: FakePushOptions = {}) {
  cleanups.push(fakePush(env).restore);
  mockSession({ me: TEST_USER, events: { hosting: [EVENT] } });
  renderApp('/');
  await screen.findByRole('heading', { level: 1, name: 'Tus eventos' });
}

function offerInstall() {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { prompt, event };
}

const banner = () => screen.queryByRole('region', { name: 'Instala Secret Santa' });

describe('Dashboard install banner', () => {
  it('appears once the browser offers installing, as a plain card', async () => {
    await renderDashboard();
    expect(banner()).toBeNull();
    const { event } = offerInstall();
    expect(event.defaultPrevented).toBe(true); // our banner instead of the mini-infobar
    const card = await screen.findByRole('region', { name: 'Instala Secret Santa' });
    expect(card).toHaveClass('bg-pure-white');
    expect(card.querySelector('.bg-coral-pop')).toBeNull(); // the page's coral is Create event
  });

  it('an event that fired before the dashboard mounted still counts', async () => {
    offerInstall();
    await renderDashboard();
    expect(banner()).toBeInTheDocument();
  });

  it('Install opens the browser dialog; accepted → the banner goes away', async () => {
    const user = userEvent.setup();
    await renderDashboard();
    const { prompt } = offerInstall();
    await user.click(await screen.findByRole('button', { name: 'Instalar' }));
    expect(prompt).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(banner()).toBeNull();
    });
  });

  it('dismiss is remembered on this device', async () => {
    const user = userEvent.setup();
    await renderDashboard();
    offerInstall();
    await user.click(
      await screen.findByRole('button', { name: 'Ocultar sugerencia de instalación' }),
    );
    expect(banner()).toBeNull();
    expect(localStorage.getItem('santa:install-banner-dismissed')).toBe('1');
  });

  it('a remembered dismiss keeps it hidden', async () => {
    localStorage.setItem('santa:install-banner-dismissed', '1');
    offerInstall();
    await renderDashboard();
    expect(banner()).toBeNull();
  });

  it('blocked storage: the banner still works', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    offerInstall();
    await renderDashboard();
    expect(banner()).toBeInTheDocument();
  });

  it('not shown inside the installed app', async () => {
    offerInstall();
    await renderDashboard({ standalone: true });
    expect(banner()).toBeNull();
  });

  it('not shown when the browser can’t install', async () => {
    await renderDashboard();
    expect(banner()).toBeNull();
  });

  it('iPhone Safari: the Add to Home Screen guide', async () => {
    const user = userEvent.setup();
    await renderDashboard({ supported: false, userAgent: UA.safariIphone });
    const card = banner();
    if (!card) throw new Error('no banner');
    expect(card).toHaveTextContent('Agrégala a tu pantalla de inicio');
    await user.click(within(card).getByRole('button', { name: 'Cómo instalar' }));
    expect(
      screen.getByRole('dialog', { name: 'Agregar a la pantalla de inicio' }),
    ).toBeInTheDocument();
  });
});
