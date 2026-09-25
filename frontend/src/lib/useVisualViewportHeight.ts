import { useEffect } from 'react';

/**
 * While `enabled`, keeps `--app-height` on <html> equal to the *visual* viewport height.
 * On iOS the on-screen keyboard shrinks only the visual viewport, so a layout sized with it
 * keeps a bottom composer above the keyboard (CLAUDE.md §8). Falls back to `100dvh`.
 */
export function useVisualViewportHeight(enabled: boolean): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!enabled || !viewport) return undefined;
    const update = () => {
      root.style.setProperty('--app-height', `${String(Math.round(viewport.height))}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      root.style.removeProperty('--app-height');
    };
  }, [enabled]);
}
