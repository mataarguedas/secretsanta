import { useEffect, useRef, useState } from 'react';

import { readViewportSnapshot } from '@/lib/viewportDebug';

/** A small read-only panel at the top of the shell, refreshed every frame. */
export function ViewportDebug() {
  const probe = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      setText(readViewportSnapshot(probe.current));
      frame = window.requestAnimationFrame(loop);
    };
    loop();
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div
        ref={probe}
        aria-hidden="true"
        className="pointer-events-none invisible absolute pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      />
      <pre
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 m-0 bg-ink-black/80 px-8 py-6 font-mono text-caption whitespace-pre-wrap text-pure-white"
      >
        {text}
      </pre>
    </>
  );
}
