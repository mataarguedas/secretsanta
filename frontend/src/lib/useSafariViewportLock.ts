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

/**
 * Safari only, while `enabled`: pins the chat shell to the *visual* viewport.
 *
 * When the keyboard opens, iOS Safari shrinks only the visual viewport and then scrolls the
 * whole page to reveal the focused input. A shell sized to the visual viewport is pushed up
 * off screen by that scroll: the header and the messages disappear and the composer sticks
 * to the top with a blank gap above the keyboard. Here the page itself can't scroll, the
 * shell is `position: fixed` at the visual viewport's offset and height, and any page scroll
 * Safari still makes is undone.
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

    const update = () => {
      frame = 0;
      // Undo the page scroll Safari makes to "reveal" the input; the shell handles it.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      root.style.setProperty('--safari-vv-height', `${String(Math.round(viewport.height))}px`);
      root.style.setProperty(
        '--safari-vv-top',
        `${String(Math.max(0, Math.round(viewport.offsetTop)))}px`,
      );
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    root.setAttribute(SAFARI_LOCK_ATTRIBUTE, 'locked');
    update();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      root.removeAttribute(SAFARI_LOCK_ATTRIBUTE);
      root.style.removeProperty('--safari-vv-height');
      root.style.removeProperty('--safari-vv-top');
    };
  }, [enabled, environment]);
}
