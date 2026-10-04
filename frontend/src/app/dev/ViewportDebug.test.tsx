import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { readViewportSnapshot, viewportDebugEnabled } from '@/lib/viewportDebug';

import { ViewportDebug } from './ViewportDebug';

describe('viewportDebugEnabled', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('is off by default, on with ?vvdebug=1 for the tab, off again with ?vvdebug=0', () => {
    expect(viewportDebugEnabled('')).toBe(false);
    expect(viewportDebugEnabled('?vvdebug=1')).toBe(true);
    expect(viewportDebugEnabled('')).toBe(true);
    expect(viewportDebugEnabled('?vvdebug=0')).toBe(false);
    expect(viewportDebugEnabled('')).toBe(false);
  });
});

describe('ViewportDebug', () => {
  it('shows the viewport numbers', () => {
    expect(readViewportSnapshot(null)).toContain('scrollY 0');
    render(<ViewportDebug />);
    expect(screen.getByText(/vv\.pageTop/)).toBeInTheDocument();
  });
});
