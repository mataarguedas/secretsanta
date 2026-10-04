import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerAboveKeyboard } from './useComposerAboveKeyboard';

/**
 * A fake page: the composer's bottom (client coordinates) is `layoutBottom - scrollY`, and
 * the visible area ends at `offsetTop + height` (the keyboard is up: 400px visible).
 */
let scrollY: number;
let layoutBottom: number;
let pageScrolls: boolean;
let frames: FrameRequestCallback[];
let viewport: EventTarget & { height: number; offsetTop: number };
const scrollBy = vi.fn((_x: number, y: number) => {
  if (pageScrolls) scrollY += y;
});

function runFrames(count = 200) {
  for (let i = 0; i < count && frames.length > 0; i += 1) {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(0);
  }
}

function Harness() {
  const form = useRef<HTMLFormElement>(null);
  useComposerAboveKeyboard(form);
  return (
    <form ref={form} aria-label="composer">
      <textarea aria-label="message" />
    </form>
  );
}

function setup({ touch = true } = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: touch && query === '(pointer: coarse)' })),
  );
  const utils = render(<Harness />);
  const form = utils.getByRole('form', { name: 'composer' });
  form.getBoundingClientRect = () => ({ bottom: layoutBottom - scrollY }) as DOMRect;
  return { ...utils, form, textarea: utils.getByRole('textbox', { name: 'message' }) };
}

const offset = () => layoutBottom - scrollY - (viewport.offsetTop + viewport.height);

beforeEach(() => {
  scrollY = 0;
  layoutBottom = 0;
  pageScrolls = true;
  frames = [];
  scrollBy.mockClear();
  viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('scrollBy', scrollBy);
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

describe('useComposerAboveKeyboard', () => {
  it('on focus, brings a composer Safari scrolled off the top back onto the keyboard', () => {
    const { textarea } = setup();
    // What iOS 26 does: the composer ends up above the top of the screen.
    layoutBottom = -120;
    textarea.focus();
    runFrames();
    expect(offset()).toBe(0);
  });

  it('after typing, closes the gap Safari leaves above the keyboard', () => {
    const { textarea } = setup();
    layoutBottom = 400;
    textarea.focus();
    runFrames();
    expect(offset()).toBe(0);

    // Safari's caret reveal leaves the composer 100px above the keyboard.
    scrollY += 100;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    runFrames();
    expect(offset()).toBe(0);
  });

  it('follows the keyboard opening (viewport resize) and the visual viewport pan', () => {
    const { textarea } = setup();
    layoutBottom = 700;
    viewport.height = 700;
    textarea.focus();
    runFrames();

    viewport.height = 350;
    viewport.offsetTop = 80;
    viewport.dispatchEvent(new Event('resize'));
    runFrames();
    expect(offset()).toBe(0);
  });

  it('leaves the page alone while a finger is on the screen (reading older messages)', () => {
    const { textarea } = setup();
    layoutBottom = 400;
    textarea.focus();
    runFrames();
    scrollBy.mockClear();

    window.dispatchEvent(new Event('touchstart'));
    scrollY -= 300; // the reader scrolls up
    viewport.dispatchEvent(new Event('resize'));
    runFrames();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('gives up instead of oscillating when the page cannot scroll there', () => {
    const { textarea } = setup();
    pageScrolls = false;
    layoutBottom = 900;
    textarea.focus();
    runFrames();
    expect(scrollBy).toHaveBeenCalledTimes(4);
    expect(frames).toHaveLength(0);
  });

  it('does nothing without focus or on non-touch screens', () => {
    setup();
    layoutBottom = 900;
    viewport.dispatchEvent(new Event('resize'));
    runFrames();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does nothing on a desktop (fine pointer)', () => {
    const { textarea } = setup({ touch: false });
    layoutBottom = 900;
    textarea.focus();
    runFrames();
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
