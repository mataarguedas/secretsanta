import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ToastProvider } from './toast/ToastProvider';
import { useToast, type ToastApi } from './toast/toastContext';

let api: ToastApi;
function Capture({ onApi }: { onApi: (api: ToastApi) => void }) {
  const toast = useToast();
  useEffect(() => {
    onApi(toast);
  }, [toast, onApi]);
  return null;
}
const keepApi = (value: ToastApi) => {
  api = value;
};

function setup() {
  return render(
    <ToastProvider>
      <Capture onApi={keepApi} />
    </ToastProvider>,
  );
}

function region(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[aria-live="polite"]');
  if (!el) throw new Error('live region missing');
  return el;
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('useToast throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Capture onApi={keepApi} />)).toThrow(/ToastProvider/);
  });

  it('renders into an always-present polite live region', () => {
    setup();
    expect(region()).toBeInTheDocument();
    act(() => {
      api.info('Enlace copiado.');
    });
    expect(region()).toHaveTextContent('Enlace copiado.');
  });

  it('uses green/red only for the icon and text, never a colored background', () => {
    setup();
    act(() => {
      api.success('Guardado.');
      api.error('No se pudo guardar.');
    });
    const ok = screen.getByText('Guardado.').parentElement;
    const bad = screen.getByText('No se pudo guardar.').parentElement;
    expect(ok).toHaveClass('text-success');
    expect(bad).toHaveClass('text-error');
    for (const li of region().querySelectorAll('li')) {
      expect(li).toHaveClass('bg-pure-white', 'border-ink-black');
      expect(li.className).not.toMatch(/bg-(success|error)|shadow/);
    }
  });

  it('auto-dismisses (5 s by default, 8 s for errors)', () => {
    setup();
    act(() => {
      api.success('Guardado.');
      api.error('Falló.');
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Guardado.')).toBeNull();
    expect(screen.getByText('Falló.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('Falló.')).toBeNull();
  });

  it('pauses while hovered', () => {
    setup();
    act(() => {
      api.show({ kind: 'info', message: 'Hola', duration: 1000 });
    });
    const item = screen.getByText('Hola').closest('li') ?? document.body;
    fireEvent.mouseEnter(item);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Hola')).toBeInTheDocument();
    fireEvent.mouseLeave(item);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Hola')).toBeNull();
  });

  it('can be dismissed with its translated button', () => {
    setup();
    act(() => {
      api.info('Hola');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar notificación' }));
    expect(screen.queryByText('Hola')).toBeNull();
  });

  it('keeps at most three on screen', () => {
    setup();
    act(() => {
      ['1', '2', '3', '4'].forEach((m) => api.info(m));
    });
    expect(region().querySelectorAll('li')).toHaveLength(3);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('has no axe violations', async () => {
    vi.useRealTimers();
    const { container } = setup();
    act(() => {
      api.success('Guardado.');
      api.error('Falló.');
    });
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
  });
});
