import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSafari, useSafariViewportLock, type BrowserEnvironment } from './useSafariViewportLock';

const IPHONE_SAFARI: BrowserEnvironment = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
};
const MAC_SAFARI: BrowserEnvironment = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
};
const IPAD: BrowserEnvironment = { ...MAC_SAFARI, maxTouchPoints: 5 };
const ANDROID_CHROME: BrowserEnvironment = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
  maxTouchPoints: 5,
};
const DESKTOP_CHROME: BrowserEnvironment = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  platform: 'Win32',
  maxTouchPoints: 0,
};

describe('isSafari', () => {
  it('is Safari on iPhone, iPad and Mac', () => {
    expect(isSafari(IPHONE_SAFARI)).toBe(true);
    expect(isSafari(IPAD)).toBe(true);
    expect(isSafari(MAC_SAFARI)).toBe(true);
  });

  it('is not Safari for Chrome on Android or desktop', () => {
    expect(isSafari(ANDROID_CHROME)).toBe(false);
    expect(isSafari(DESKTOP_CHROME)).toBe(false);
  });
});

describe('useSafariViewportLock', () => {
  const root = document.documentElement;
  let viewport: EventTarget & { height: number; offsetTop: number };
  let frames: FrameRequestCallback[];

  /** Runs queued animation frames, letting `between` move the viewport before each one. */
  const runFrames = (count: number, between?: (frame: number) => void) => {
    for (let i = 0; i < count && frames.length > 0; i += 1) {
      between?.(i);
      const queued = frames;
      frames = [];
      for (const cb of queued) cb(0);
    }
  };

  beforeEach(() => {
    frames = [];
    viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins the shell to the visual viewport on Safari and cleans up', () => {
    const { unmount } = renderHook(() => {
      useSafariViewportLock(true, () => IPHONE_SAFARI);
    });
    expect(root.getAttribute('data-safari-viewport')).toBe('locked');
    expect(root.style.getPropertyValue('--safari-vv-height')).toBe('400px');
    expect(root.style.getPropertyValue('--safari-vv-top')).toBe('0px');

    // The keyboard opens and Safari pans the visual viewport.
    viewport.height = 300;
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event('resize'));
    runFrames(1);
    expect(root.style.getPropertyValue('--safari-vv-height')).toBe('300px');
    expect(root.style.getPropertyValue('--safari-vv-top')).toBe('120px');

    unmount();
    expect(root.hasAttribute('data-safari-viewport')).toBe(false);
    expect(root.style.getPropertyValue('--safari-vv-height')).toBe('');
    expect(root.style.getPropertyValue('--safari-vv-top')).toBe('');
  });

  it('keeps following the keyboard animation after focus, without viewport events', () => {
    renderHook(() => {
      useSafariViewportLock(true, () => IPHONE_SAFARI);
    });
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    // Safari shrinks and pans the viewport over several frames and fires nothing.
    runFrames(5, (frame) => {
      viewport.height = 400 - frame * 25;
      viewport.offsetTop = frame * 40;
    });
    expect(root.style.getPropertyValue('--safari-vv-height')).toBe('300px');
    expect(root.style.getPropertyValue('--safari-vv-top')).toBe('160px');

    // Once the values hold steady the loop stops.
    runFrames(50);
    expect(frames).toHaveLength(0);
    input.remove();
  });

  it('never scrolls the page back (that fights Safari on iOS)', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    renderHook(() => {
      useSafariViewportLock(true, () => IPHONE_SAFARI);
    });
    viewport.offsetTop = 200;
    window.dispatchEvent(new Event('scroll'));
    viewport.dispatchEvent(new Event('scroll'));
    runFrames(20);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue('--safari-vv-top')).toBe('200px');
  });

  it('does nothing on other browsers or while disabled', () => {
    renderHook(() => {
      useSafariViewportLock(true, () => ANDROID_CHROME);
    });
    expect(root.hasAttribute('data-safari-viewport')).toBe(false);

    renderHook(() => {
      useSafariViewportLock(false, () => IPHONE_SAFARI);
    });
    expect(root.hasAttribute('data-safari-viewport')).toBe(false);
  });
});
