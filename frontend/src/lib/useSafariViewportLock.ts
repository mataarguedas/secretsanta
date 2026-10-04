import { useEffect } from 'react';

/** The bits of `navigator` the detection reads; tests pass their own. */
export interface BrowserEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/**
 * Safari's engine: any iPhone/iPad browser (on iOS they are all WebKit, with the same
 * keyboard behavior; iPadOS reports "MacIntel" but has touch), or desktop Safari.
 */
export function isSafari(env: BrowserEnvironment): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(env.userAgent) ||
    (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
  if (ios) return true;
  return (
    env.userAgent.includes('Safari/') &&
    !/Chrome|Chromium|Edg\/|OPR\/|Firefox|Android/.test(env.userAgent)
  );
}

function readEnvironment(): BrowserEnvironment {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

/** Marks <html> while locked; `styles/base.css` pins `[data-safari-shell]` to these vars. */
export const SAFARI_LOCK_ATTRIBUTE = 'data-safari-viewport';

/** Frames with unchanged viewport values before the follow loop stops. */
const STABLE_FRAMES = 10;
/** Hard cap on one follow loop (~2 s at 60 fps): the keyboard animation is well within it. */
const MAX_FRAMES = 120;

/**
 * Safari only, while `enabled`: pins the chat shell to the *visual* viewport.
 *
 * When the keyboard opens, iOS Safari shrinks the visual viewport and pans it down over the
 * layout viewport to reveal the focused input. A `position: fixed` shell stays on the layout
 * viewport, so that pan pushes the header and the messages off the top of the screen and
 * leaves the composer stuck there with a blank gap above the keyboard.
 *
 * The shell follows the pan instead (`top` = `visualViewport.offsetTop`, `height` =
 * `visualViewport.height`). It never scrolls the page back: on iOS scrolling is async, so a
 * `scrollTo` makes the next read stale and Safari pans again, and the two fight. Safari also
 * doesn't fire viewport events reliably through the keyboard animation, so every trigger
 * (focus in/out, viewport resize/scroll, page scroll) starts a per-frame loop that re-reads
 * the viewport until it has settled.
 */
export function useSafariViewportLock(
  enabled: boolean,
  environment: () => BrowserEnvironment = readEnvironment,
): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport || !isSafari(environment())) return undefined;
    const root = document.documentElement;
    let frame = 0;
    let remaining = 0;
    let stable = 0;
    let height = -1;
    let top = -1;

    /** Writes the current viewport box; false when nothing changed. */
    const apply = (): boolean => {
      const nextHeight = Math.round(viewport.height);
      const nextTop = Math.max(0, Math.round(viewport.offsetTop));
      if (nextHeight === height && nextTop === top) return false;
      height = nextHeight;
      top = nextTop;
      root.style.setProperty('--safari-vv-height', `${String(height)}px`);
      root.style.setProperty('--safari-vv-top', `${String(top)}px`);
      return true;
    };
    const tick = () => {
      frame = 0;
      stable = apply() ? 0 : stable + 1;
      remaining -= 1;
      if (stable < STABLE_FRAMES && remaining > 0) frame = window.requestAnimationFrame(tick);
    };
    const follow = () => {
      stable = 0;
      remaining = MAX_FRAMES;
      if (frame === 0) frame = window.requestAnimationFrame(tick);
    };

    root.setAttribute(SAFARI_LOCK_ATTRIBUTE, 'locked');
    apply();
    viewport.addEventListener('resize', follow);
    viewport.addEventListener('scroll', follow);
    window.addEventListener('scroll', follow, { passive: true });
    document.addEventListener('focusin', follow);
    document.addEventListener('focusout', follow);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', follow);
      viewport.removeEventListener('scroll', follow);
      window.removeEventListener('scroll', follow);
      document.removeEventListener('focusin', follow);
      document.removeEventListener('focusout', follow);
      root.removeAttribute(SAFARI_LOCK_ATTRIBUTE);
      root.style.removeProperty('--safari-vv-height');
      root.style.removeProperty('--safari-vv-top');
    };
  }, [enabled, environment]);
}
