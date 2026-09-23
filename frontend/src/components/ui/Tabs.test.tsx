import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { Tab, TabList, TabPanel, Tabs, type TabsProps } from './Tabs';

function Example(props: Partial<TabsProps>) {
  const tabsProps = (
    props.value !== undefined ? props : { defaultValue: 'overview', ...props }
  ) as TabsProps;
  return (
    <Tabs {...tabsProps}>
      <TabList aria-label="Secciones">
        <Tab value="overview">Resumen</Tab>
        <Tab value="participants">Participantes</Tab>
        <Tab value="archived" disabled>
          Archivo
        </Tab>
        <Tab value="chat">Chat</Tab>
      </TabList>
      <TabPanel value="overview">Panel resumen</TabPanel>
      <TabPanel value="participants">Panel participantes</TabPanel>
      <TabPanel value="chat">Panel chat</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('wires tablist, tabs and the selected panel', () => {
    render(<Example />);
    expect(screen.getByRole('tablist', { name: 'Secciones' })).toBeInTheDocument();
    const selected = screen.getByRole('tab', { name: 'Resumen' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAccessibleName('Resumen');
    expect(panel).toHaveTextContent('Panel resumen');
    expect(selected).toHaveAttribute('aria-controls', panel.id);
  });

  it('tabs are pills; the selected one is filled', () => {
    render(<Example />);
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveClass(
      'rounded-full-2',
      'min-h-11',
      'bg-ink-black',
    );
    expect(screen.getByRole('tab', { name: 'Chat' })).not.toHaveClass('bg-ink-black');
  });

  it('roving focus with ←/→ (wrapping, skipping disabled), Home and End', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Participantes' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel participantes');

    await user.keyboard('{ArrowRight}'); // skips the disabled tab
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveFocus();

    await user.keyboard('{ArrowRight}'); // wraps
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}'); // wraps backwards
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveFocus();

    // Only one tab stop: Tab leaves the list for the panel.
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('controlled (URL-driven) mode reports changes and follows the prop', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(<Example value="overview" onValueChange={onValueChange} />);
    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(onValueChange).toHaveBeenCalledWith('chat');
    // Nothing changes until the owner (e.g. the router) updates the value.
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    rerender(<Example value="chat" onValueChange={onValueChange} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel chat');
  });

  it('throws when parts are used outside <Tabs>', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Tab value="x">x</Tab>)).toThrow(/inside <Tabs>/);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Example />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
