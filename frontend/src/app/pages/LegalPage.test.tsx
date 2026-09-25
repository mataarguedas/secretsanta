import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import i18n from '@/i18n';
import { mockSession, renderApp } from '@/test/render';

/** Prompt 28: `/privacy` and `/terms` (FR-ACC-4), public and localized. */

afterEach(async () => {
  await act(() => i18n.changeLanguage('es'));
});

describe.each([
  ['/privacy', 'Política de privacidad', 'Privacy Policy', 6],
  ['/terms', 'Términos del servicio', 'Terms of Service', 5],
])('%s', (path, titleEs, titleEn, sections) => {
  it('is reachable signed out, with a placeholder notice and its sections', async () => {
    mockSession({ me: null });
    const { container } = renderApp(path);
    const title = await screen.findByRole('heading', { level: 1, name: titleEs });
    expect(title).toHaveClass('font-serif');
    expect(document.title).toBe(`Secret Santa · ${titleEs}`);
    expect(within(screen.getByRole('note')).getByText(/Texto provisional/)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getAllByRole('heading', { level: 2 })).toHaveLength(
      sections,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is translated', async () => {
    mockSession({ me: null });
    renderApp(path);
    await screen.findByRole('heading', { level: 1, name: titleEs });
    await act(() => i18n.changeLanguage('en'));
    expect(screen.getByRole('heading', { level: 1, name: titleEn })).toBeInTheDocument();
    expect(screen.getByText(/final text pending/)).toBeInTheDocument();
  });
});
