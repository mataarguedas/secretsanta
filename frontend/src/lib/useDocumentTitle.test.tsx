import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDocumentTitle } from './useDocumentTitle';

describe('useDocumentTitle', () => {
  it('prefixes the page with the app name', () => {
    const { rerender } = renderHook(
      ({ page }: { page?: string }) => {
        useDocumentTitle(page);
      },
      {
        initialProps: { page: 'Perfil' },
      },
    );
    expect(document.title).toBe('Secret Santa · Perfil');
    rerender({ page: 'Profile' });
    expect(document.title).toBe('Secret Santa · Profile');
  });

  it('is just the app name without a page', () => {
    renderHook(() => {
      useDocumentTitle();
    });
    expect(document.title).toBe('Secret Santa');
  });
});
