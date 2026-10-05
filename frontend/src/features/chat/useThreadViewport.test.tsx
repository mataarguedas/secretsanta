import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HEIGHT_VAR, THREAD_OPEN_ATTRIBUTE, useThreadViewport } from './useThreadViewport';

/** A fake visual viewport: the keyboard and Safari's panning are just numbers here. */
class FakeViewport extends EventTarget {
  offsetTop = 0;
  height = 800;
}

const height = () => document.documentElement.style.getPropertyValue(HEIGHT_VAR);

let viewport: FakeViewport;
let mobile: boolean;
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  viewport = new FakeViewport();
  mobile = true;
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return mobile;
    },
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  scrollTo = vi.fn(() => {
    vi.stubGlobal('scrollY', 0);
    viewport.offsetTop = 0;
  });
  vi.stubGlobal('scrollTo', scrollTo);
});

describe('useThreadViewport', () => {
  it('locks the document while mounted and sizes the box to the visible area', () => {
    const { unmount } = renderHook(() => {
      useThreadViewport();
    });
    expect(document.documentElement).toHaveAttribute(THREAD_OPEN_ATTRIBUTE);
    expect(height()).toBe('800px');

    unmount();
    expect(document.documentElement).not.toHaveAttribute(THREAD_OPEN_ATTRIBUTE);
    expect(height()).toBe('');
  });

  it('keyboard up: the box shrinks to end right above it', () => {
    renderHook(() => {
      useThreadViewport();
    });
    viewport.height = 420;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('420px');
  });

  it("Safari's reveal-scroll on focus is undone; the box is never moved", () => {
    renderHook(() => {
      useThreadViewport();
    });
    scrollTo.mockClear();
    viewport.height = 420;
    vi.stubGlobal('scrollY', 380);
    document.dispatchEvent(new FocusEvent('focusin'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(height()).toBe('420px');
    expect(document.documentElement.getAttribute('style')).not.toMatch(/shift|translate/);
  });

  it('a panned visual viewport is reset too', () => {
    renderHook(() => {
      useThreadViewport();
    });
    scrollTo.mockClear();
    viewport.offsetTop = 250;
    viewport.dispatchEvent(new Event('scroll'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('stops resetting if Safari keeps scrolling (no fight)', () => {
    renderHook(() => {
      useThreadViewport();
    });
    scrollTo.mockImplementation(() => undefined);
    scrollTo.mockClear();
    vi.stubGlobal('scrollY', 100);
    for (let i = 0; i < 20; i += 1) window.dispatchEvent(new Event('scroll'));
    expect(scrollTo.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('desktop: leaves the box to the layout', () => {
    mobile = false;
    renderHook(() => {
      useThreadViewport();
    });
    viewport.height = 420;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('');
    expect(document.documentElement).toHaveAttribute(THREAD_OPEN_ATTRIBUTE);
  });
});
