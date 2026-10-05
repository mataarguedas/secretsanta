import { useEffect } from 'react';

/** Below `md`: the thread is a fixed box sized to the visible area (see ThreadPage). */
const MOBILE_QUERY = '(max-width: 767.98px)';
/** Frames with nothing to change before a follow loop stops. */
const STABLE_FRAMES = 10;
/** Hard cap on one follow loop (~2 s at 60 fps): covers the keyboard animation. */
const MAX_FRAMES = 120;
/** Scroll resets per loop: if Safari keeps scrolling, stop instead of fighting it. */
const MAX_RESETS = 6;

/** Set on <html> while a thread is open: the document itself never scrolls (`base.css`). */
export const THREAD_OPEN_ATTRIBUTE = 'data-chat-thread';
/** On <html>: the thread box's height on mobile, read by its classes. */
export const HEIGHT_VAR = '--chat-box-height';

/** The visible height: shorter than the screen while the on-screen keyboard is up. */
export function visibleHeight(): number {
  return Math.round(window.visualViewport?.height ?? window.innerHeight);
}

/** Whether Safari has scrolled the page or panned the visual viewport away from the top. */
function scrolled(): boolean {
  return window.scrollY !== 0 || (window.visualViewport?.offsetTop ?? 0) !== 0;
}

/**
 * While a chat thread is open: the document is locked (it never scrolls; the messages scroll
 * inside the thread box), and on mobile the box, `position: fixed; top: 0`, is exactly as tall
 * as the visible area, so with the keyboard up the composer ends right above it.
 *
 * When the composer gets focus, iOS Safari scrolls the page to reveal it anyway, sized for
 * where the composer was *before* the keyboard opened. With the box resized it's already
 * visible, so that scroll is only harmful: this puts the page back at the top. It never moves
 * the box itself: on iOS 26 the reported scroll/viewport offsets don't match where fixed
 * elements are drawn, and moving the box by them pushed the thread under the keyboard. Once
 * the page is back at the top the caret is on screen, so Safari doesn't scroll again while
 * typing.
 *
 * Safari doesn't fire viewport events reliably through the keyboard animation, so each
 * trigger also starts a short per-frame loop that follows until things settle.
 */
export function useThreadViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    const mobile = typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null;
    let height = Number.NaN;
    let frame = 0;
    let remaining = 0;
    let stable = 0;
    let resets = 0;

    /** One pass; false when there was nothing to change. */
    const apply = (): boolean => {
      if (!mobile?.matches) {
        if (!Number.isNaN(height)) {
          height = Number.NaN;
          root.style.removeProperty(HEIGHT_VAR);
        }
        return false;
      }
      let changed = false;
      const next = visibleHeight();
      if (next !== height) {
        height = next;
        root.style.setProperty(HEIGHT_VAR, `${String(next)}px`);
        changed = true;
      }
      if (scrolled() && resets < MAX_RESETS) {
        resets += 1;
        window.scrollTo(0, 0);
        changed = true;
      }
      return changed;
    };

    const tick = () => {
      frame = 0;
      stable = apply() ? 0 : stable + 1;
      remaining -= 1;
      if (stable < STABLE_FRAMES && remaining > 0) frame = window.requestAnimationFrame(tick);
    };
    const follow = () => {
      apply();
      stable = 0;
      remaining = MAX_FRAMES;
      if (frame === 0) frame = window.requestAnimationFrame(tick);
    };
    /** A new focus or keyboard change starts a fresh budget of resets. */
    const restart = () => {
      resets = 0;
      follow();
    };

    root.setAttribute(THREAD_OPEN_ATTRIBUTE, '');
    apply();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', restart);
    viewport?.addEventListener('scroll', follow);
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', restart);
    document.addEventListener('focusin', restart);
    document.addEventListener('focusout', restart);
    mobile?.addEventListener('change', restart);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', restart);
      viewport?.removeEventListener('scroll', follow);
      window.removeEventListener('scroll', follow);
      window.removeEventListener('resize', restart);
      document.removeEventListener('focusin', restart);
      document.removeEventListener('focusout', restart);
      mobile?.removeEventListener('change', restart);
      root.removeAttribute(THREAD_OPEN_ATTRIBUTE);
      root.style.removeProperty(HEIGHT_VAR);
      // Other screens start at the top.
      window.scrollTo(0, 0);
    };
  }, []);
}
