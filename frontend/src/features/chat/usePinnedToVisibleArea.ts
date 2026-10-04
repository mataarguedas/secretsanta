import { useEffect, type RefObject } from 'react';

/** Below `md`: the thread is a fixed box on the visible area (see ThreadPage). */
const MOBILE_QUERY = '(max-width: 767.98px)';
/** Frames with an unchanged box before a follow loop stops. */
const STABLE_FRAMES = 10;
/** Hard cap on one follow loop (~2 s at 60 fps): covers the keyboard animation. */
const MAX_FRAMES = 120;

/** Set on <html> while a thread is open: the document itself never scrolls (`base.css`). */
export const THREAD_OPEN_ATTRIBUTE = 'data-chat-thread';
/** On <html>: the box's height and vertical shift, read by the thread's classes. */
export const HEIGHT_VAR = '--chat-box-height';
export const SHIFT_VAR = '--chat-box-shift';

/** The visible area in client (layout-viewport) coordinates. */
export function visibleArea(): { top: number; height: number } {
  const viewport = window.visualViewport;
  return viewport
    ? { top: viewport.offsetTop, height: viewport.height }
    : { top: 0, height: window.innerHeight };
}

/**
 * Keeps the chat thread box (sized and moved by `HEIGHT_VAR` / `SHIFT_VAR`) exactly on the part of the screen the user can see: the visual
 * viewport's height (shorter while the on-screen keyboard is up) and its top edge.
 *
 * The document has nothing to scroll while a thread is open; the messages scroll inside the
 * box. On iOS, Safari still moves things when the composer gets focus (it scrolls the page or
 * pans the visual viewport, and on iOS 26 fixed elements may ride that scroll). Instead of
 * predicting or undoing that scroll, which fights Safari and makes the screen jump on every
 * keystroke, this *measures* where the box landed and moves it onto the visible area with a
 * transform. It never scrolls anything, so there is nothing for Safari to fight back against;
 * once the box sits on the visible area the caret is visible and Safari stops scrolling.
 *
 * Safari doesn't fire viewport events reliably through the keyboard animation, so each
 * trigger also starts a short per-frame loop that follows the box until it settles.
 */
export function usePinnedToVisibleArea(box: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const mobile = typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null;
    let translate = 0;
    let lastTop = Number.NaN;
    let lastHeight = Number.NaN;
    let frame = 0;
    let remaining = 0;
    let stable = 0;

    const clear = () => {
      translate = 0;
      lastTop = Number.NaN;
      lastHeight = Number.NaN;
      root.style.removeProperty(HEIGHT_VAR);
      root.style.removeProperty(SHIFT_VAR);
    };

    /** Places the box; false when it was already in place. */
    const apply = (): boolean => {
      if (!mobile?.matches) {
        if (!Number.isNaN(lastHeight)) clear();
        return false;
      }
      const area = visibleArea();
      const height = Math.round(area.height);
      if (height !== lastHeight) root.style.setProperty(HEIGHT_VAR, `${String(height)}px`);
      // Where the box sits without our transform: 0 normally, elsewhere if Safari moved it.
      const natural = el.getBoundingClientRect().top - translate;
      const next = Math.round(area.top - natural);
      const changed = height !== lastHeight || next !== translate || area.top !== lastTop;
      if (next !== translate) {
        translate = next;
        root.style.setProperty(SHIFT_VAR, `${String(next)}px`);
      }
      lastHeight = height;
      lastTop = area.top;
      return changed;
    };

    const tick = () => {
      frame = 0;
      stable = apply() ? 0 : stable + 1;
      remaining -= 1;
      if (stable < STABLE_FRAMES && remaining > 0) frame = window.requestAnimationFrame(tick);
    };
    /** Place it now (same frame as the event, so no visible jump), then follow for a while. */
    const follow = () => {
      apply();
      stable = 0;
      remaining = MAX_FRAMES;
      if (frame === 0) frame = window.requestAnimationFrame(tick);
    };

    root.setAttribute(THREAD_OPEN_ATTRIBUTE, '');
    apply();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', follow);
    viewport?.addEventListener('scroll', follow);
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    document.addEventListener('focusin', follow);
    document.addEventListener('focusout', follow);
    mobile?.addEventListener('change', follow);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', follow);
      viewport?.removeEventListener('scroll', follow);
      window.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
      document.removeEventListener('focusin', follow);
      document.removeEventListener('focusout', follow);
      mobile?.removeEventListener('change', follow);
      root.removeAttribute(THREAD_OPEN_ATTRIBUTE);
      clear();
      // Other screens start at the top (Safari may have left the page scrolled).
      window.scrollTo(0, 0);
    };
  }, [box]);
}
