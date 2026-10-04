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

/** Marks <html> while locked; `styles/base.css` places `[data-safari-shell]` with these vars. */
export const SAFARI_LOCK_ATTRIBUTE = 'data-safari-viewport';
/** Set on <html> while the on-screen keyboard is up (drops the home-indicator padding). */
export const SAFARI_KEYBOARD_ATTRIBUTE = 'data-safari-keyboard';

/** Frames with unchanged viewport values before the follow loop stops. */
const STABLE_FRAMES = 10;
/** Hard cap on one follow loop (~2 s at 60 fps): the keyboard animation is well within it. */
const MAX_FRAMES = 120;
/** A visual viewport this much shorter than the tallest one seen means the keyboard is up. */
const KEYBOARD_MIN_HEIGHT = 120;

/**
 * The visual viewport's top edge in *document* coordinates. iOS reveals a focused input by
 * scrolling the page (`scrollY`), and may also pan the visual viewport (`offsetTop`); the
 * sum is where the visible area starts either way.
 */
function visibleTop(viewport: VisualViewport): number {
  return window.scrollY + viewport.offsetTop;
}

/**
 * Safari only, while `enabled`: keeps the chat shell exactly on the visible area.
 *
 * When the keyboard opens, iOS Safari scrolls the page to reveal the focused composer, and
 * while the keyboard is up it lets `position: fixed` elements ride that scroll. A fixed shell
 * then slides off the top of the screen (header and messages gone, composer stuck at the top),
 * and `visualViewport.offsetTop` stays ~0, so correcting by it does nothing. Scrolling the page
 * back doesn't stick either: iOS scrolls asynchronously and re-reveals the input.
 *
 * So the shell isn't fixed: it's `position: absolute` (document coordinates) at the visible
 * area's document top with the visual viewport's height, and it follows Safari instead of
 * fighting it. Safari doesn't fire viewport events reliably through the keyboard animation,
 * so every trigger starts a per-frame loop that re-reads the viewport until it settles.
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
    let width = -1;
    let tallest = 0;

    /** Writes the current visible box; false when nothing changed. */
    const apply = (): boolean => {
      const nextHeight = Math.round(viewport.height);
      const nextTop = Math.max(0, Math.round(visibleTop(viewport)));
      const nextWidth = Math.round(viewport.width);
      // Rotation changes the full height: start over.
      if (nextWidth !== width) {
        width = nextWidth;
        tallest = 0;
      }
      tallest = Math.max(tallest, nextHeight);
      if (nextHeight === height && nextTop === top) return false;
      height = nextHeight;
      top = nextTop;
      root.style.setProperty('--safari-vv-height', `${String(height)}px`);
      root.style.setProperty('--safari-vv-top', `${String(top)}px`);
      if (tallest - height >= KEYBOARD_MIN_HEIGHT) {
        root.setAttribute(SAFARI_KEYBOARD_ATTRIBUTE, 'open');
      } else {
        root.removeAttribute(SAFARI_KEYBOARD_ATTRIBUTE);
      }
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
      root.removeAttribute(SAFARI_KEYBOARD_ATTRIBUTE);
      root.style.removeProperty('--safari-vv-height');
      root.style.removeProperty('--safari-vv-top');
    };
  }, [enabled, environment]);
}
