import { useEffect, type RefObject } from 'react';

/** Frames with the composer in place before a settle loop stops. */
const STABLE_FRAMES = 6;
/** Hard cap on one settle loop (~1.5 s at 60 fps): covers the keyboard animation. */
const MAX_FRAMES = 90;
/** Frames to wait after a correction: iOS scrolls asynchronously, let it land first. */
const WAIT_AFTER_SCROLL = 3;
/** Corrections per loop: if the page can't get there, stop instead of oscillating. */
const MAX_CORRECTIONS = 4;
/** Off by less than this is "in place". */
const TOLERANCE = 2;

/** How far the composer's bottom is below (+) or above (−) the visible area's bottom. */
export function composerOffset(form: HTMLElement, viewport: VisualViewport): number {
  return form.getBoundingClientRect().bottom - (viewport.offsetTop + viewport.height);
}

/**
 * Touch screens, while the composer has focus: keeps its bottom edge on the bottom of the
 * visible area (right above the keyboard).
 *
 * iOS Safari scrolls the page by itself when the composer is focused and on every keystroke,
 * and on iOS 26 it overshoots: on focus the composer ends up at the top or off screen (the
 * messages above it scroll away), and after typing it stops well above the keyboard. Nothing
 * here predicts that; after Safari has scrolled, this *measures* where the composer is and
 * scrolls the page by the difference, re-measuring until it holds.
 *
 * It runs only right after focus, typing and viewport resizes, and never while a finger is
 * on the screen, so reading older messages with the keyboard up isn't pulled back down.
 */
export function useComposerAboveKeyboard(form: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const el = form.current;
    const touch =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (!viewport || !el || !touch) return undefined;

    let frame = 0;
    let remaining = 0;
    let stable = 0;
    let wait = 0;
    let corrections = 0;
    let touching = false;

    const tick = () => {
      frame = 0;
      remaining -= 1;
      if (touching || !el.contains(document.activeElement)) return;
      if (wait > 0) {
        wait -= 1;
      } else {
        const offset = composerOffset(el, viewport);
        if (Math.abs(offset) > TOLERANCE && corrections < MAX_CORRECTIONS) {
          window.scrollBy(0, offset);
          corrections += 1;
          stable = 0;
          wait = WAIT_AFTER_SCROLL;
        } else {
          stable += 1;
        }
      }
      if (stable < STABLE_FRAMES && remaining > 0) frame = window.requestAnimationFrame(tick);
    };
    const settle = () => {
      if (touching) return;
      remaining = MAX_FRAMES;
      stable = 0;
      corrections = 0;
      if (frame === 0) frame = window.requestAnimationFrame(tick);
    };
    const touchStart = () => {
      touching = true;
    };
    const touchEnd = () => {
      touching = false;
    };

    el.addEventListener('focusin', settle);
    el.addEventListener('input', settle);
    viewport.addEventListener('resize', settle);
    window.addEventListener('touchstart', touchStart, { passive: true });
    window.addEventListener('touchend', touchEnd, { passive: true });
    window.addEventListener('touchcancel', touchEnd, { passive: true });
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      el.removeEventListener('focusin', settle);
      el.removeEventListener('input', settle);
      viewport.removeEventListener('resize', settle);
      window.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', touchEnd);
    };
  }, [form]);
}
