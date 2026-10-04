import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEIGHT_VAR,
  SHIFT_VAR,
  THREAD_OPEN_ATTRIBUTE,
  usePinnedToVisibleArea,
} from './usePinnedToVisibleArea';

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);
const height = () => cssVar(HEIGHT_VAR);
const shift = () => cssVar(SHIFT_VAR);

/** A fake visual viewport: the keyboard and Safari's panning are just numbers here. */
class FakeViewport extends EventTarget {
  offsetTop = 0;
  height = 800;
}

function Box() {
  const ref = useRef<HTMLDivElement>(null);
  usePinnedToVisibleArea(ref);
  return <div ref={ref} data-testid="box" />;
}

let viewport: FakeViewport;
let mobile: boolean;
/** Where the box would sit without the hook's transform (Safari may have moved it). */
let naturalTop: number;

function renderBox() {
  const utils = render(<Box />);
  const box = utils.getByTestId('box');
  vi.spyOn(box, 'getBoundingClientRect').mockImplementation(() => {
    return { top: naturalTop + (Number.parseFloat(shift()) || 0) } as DOMRect;
  });
  return { ...utils, box };
}

beforeEach(() => {
  viewport = new FakeViewport();
  mobile = true;
  naturalTop = 0;
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return mobile;
    },
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  // Run follow loops synchronously enough to assert on: one frame per call.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePinnedToVisibleArea', () => {
  it('locks the document while mounted and sizes the box to the visible area', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const { unmount } = renderBox();
    expect(document.documentElement).toHaveAttribute(THREAD_OPEN_ATTRIBUTE);
    expect(height()).toBe('800px');
    expect(shift()).toBe('');

    unmount();
    expect(document.documentElement).not.toHaveAttribute(THREAD_OPEN_ATTRIBUTE);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('keyboard up: the box shrinks to end right above it', () => {
    renderBox();
    viewport.height = 420;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('420px');
  });

  it('Safari scrolled the page on focus (fixed box rode the scroll): moves it back on screen without scrolling', () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    renderBox();
    viewport.height = 420;
    naturalTop = -380;
    window.dispatchEvent(new Event('scroll'));
    expect(shift()).toBe('380px');
    // Measured again with the transform applied: stays put (no oscillation per keystroke).
    window.dispatchEvent(new Event('scroll'));
    expect(shift()).toBe('380px');
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('Safari panned the visual viewport instead: follows its top edge', () => {
    renderBox();
    viewport.offsetTop = 250;
    viewport.dispatchEvent(new Event('scroll'));
    expect(shift()).toBe('250px');
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    expect(shift()).toBe('0px');
  });

  it('desktop: leaves the box to the layout (no inline size or transform)', () => {
    mobile = false;
    renderBox();
    viewport.offsetTop = 100;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('');
    expect(shift()).toBe('');
  });
});
