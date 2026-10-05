/** Helpers for the `?vvdebug=1` overlay (`app/dev/ViewportDebug.tsx`). */

const STORAGE_KEY = 'vvdebug';

/**
 * `?vvdebug=1` turns the overlay on for this tab (it survives navigation), `?vvdebug=0` off.
 * Developer tooling for the iOS keyboard layout; never shown otherwise.
 */
export function viewportDebugEnabled(search: string = window.location.search): boolean {
  const flag = new URLSearchParams(search).get(STORAGE_KEY);
  try {
    if (flag === '1') sessionStorage.setItem(STORAGE_KEY, '1');
    if (flag === '0') sessionStorage.removeItem(STORAGE_KEY);
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return flag === '1';
  }
}

const px = (value: number | undefined) => (value === undefined ? '-' : String(Math.round(value)));

/** One snapshot of every number that decides where the chat shell lands on iOS. */
export function readViewportSnapshot(probe: HTMLElement | null): string {
  const vv = window.visualViewport;
  const root = document.documentElement;
  // The chat thread box when one is open (it's fixed; #main is empty then), else #main.
  const shell = (
    document.querySelector('#main > section') ?? document.querySelector('#main')
  )?.getBoundingClientRect();
  const composer = document.querySelector('#main form')?.getBoundingClientRect();
  const probeStyle = probe ? getComputedStyle(probe) : null;
  const active = document.activeElement;
  return [
    `scrollY ${px(window.scrollY)}  innerH ${px(window.innerHeight)}  clientH ${px(root.clientHeight)}`,
    `vv.h ${px(vv?.height)}  vv.offTop ${px(vv?.offsetTop)}  vv.pageTop ${px(vv?.pageTop)}  vv.scale ${vv ? vv.scale.toFixed(2) : '-'}`,
    `box top ${px(shell?.top)} h ${px(shell?.height)}  composer bottom ${px(composer?.bottom)}`,
    `gap (composer bottom - visible bottom) ${composer && vv ? px(composer.bottom - (vv.offsetTop + vv.height)) : '-'}`,
    `docH ${px(root.scrollHeight)}  focus ${active ? active.tagName.toLowerCase() : '-'}`,
    `safe top ${probeStyle?.paddingTop ?? '-'} bottom ${probeStyle?.paddingBottom ?? '-'}`,
  ].join('\n');
}
