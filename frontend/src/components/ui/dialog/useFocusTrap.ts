import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Open traps, innermost last; only the innermost one handles keys and focus. */
const trapStack: HTMLElement[] = [];

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * While mounted: move focus into `container` (or `initialFocus`), keep Tab/Shift+Tab
 * cycling inside it, and restore focus to the previously focused element on unmount.
 */
export function useFocusTrap(
  container: RefObject<HTMLElement | null>,
  initialFocus?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    trapStack.push(root);
    (initialFocus?.current ?? root).focus();
    const isTop = () => trapStack[trapStack.length - 1] === root;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !root || !isTop()) return;
      const items = focusableWithin(root);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        root.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    // If focus escapes (e.g. a click on the backdrop), pull it back in.
    function onFocusIn(event: FocusEvent) {
      if (root && isTop() && event.target instanceof Node && !root.contains(event.target)) {
        root.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      trapStack.splice(trapStack.indexOf(root), 1);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
    // The trap is set up once per open; refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
