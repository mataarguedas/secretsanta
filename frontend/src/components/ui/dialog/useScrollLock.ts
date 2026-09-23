import { useEffect } from 'react';

let locks = 0;
let previousOverflow = '';

/** Lock body scroll while mounted. Reference-counted so nested dialogs work. */
export function useScrollLock(): void {
  useEffect(() => {
    if (locks === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, []);
}
