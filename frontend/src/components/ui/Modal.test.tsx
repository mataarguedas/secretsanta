import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { Button } from './Button';
import { Modal } from './Modal';
import { Sheet } from './Sheet';

function Harness({ as: Dialog = Modal }: { as?: typeof Modal }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="nav"
        onClick={() => {
          setOpen(true);
        }}
      >
        Abrir
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="¿Todos adentro?"
        description="Nadie podrá salir."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button variant="secondary">Revelar</Button>
          </>
        }
      />
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Abrir' });
  await user.click(trigger);
  return { user, trigger, dialog: screen.getByRole('dialog') };
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('portals an aria-modal dialog labelled by its title and described by its text', async () => {
    const { dialog } = await openDialog();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('¿Todos adentro?');
    expect(dialog).toHaveAccessibleDescription('Nadie podrá salir.');
    expect(dialog).toHaveClass('bg-pure-white', 'border-ink-black');
    expect(dialog.className).not.toMatch(/shadow/);
  });

  it('moves focus in and traps Tab / Shift+Tab inside', async () => {
    const { user, dialog } = await openDialog();
    expect(dialog).toHaveFocus();

    const close = screen.getByRole('button', { name: 'Cerrar' });
    const reveal = screen.getByRole('button', { name: 'Revelar' });
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(reveal).toHaveFocus();
    await user.tab(); // wraps
    expect(close).toHaveFocus();
    await user.tab({ shift: true }); // wraps backwards
    expect(reveal).toHaveFocus();
  });

  it('closes on Esc and restores focus to the trigger', async () => {
    const { user, trigger } = await openDialog();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on backdrop click but not on clicks inside', async () => {
    const { user, dialog } = await openDialog();
    await user.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('dialog-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from the close button', async () => {
    const { user } = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('locks body scroll while open', async () => {
    const { user } = await openDialog();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('has no axe violations', async () => {
    await openDialog();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('Sheet', () => {
  it('is a bottom sheet on mobile and a centered panel from md up', async () => {
    const user = userEvent.setup();
    render(<Harness as={Sheet} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveClass('animate-sheet-in', 'md:animate-dialog-in', 'md:max-w-[560px]');
    expect(sheet.className).toContain('pb-[calc(20px+env(safe-area-inset-bottom))]');
    expect(screen.getByTestId('dialog-backdrop')).toHaveClass('items-end', 'md:items-center');
  });

  it('shares the Modal a11y behavior', async () => {
    const user = userEvent.setup();
    render(<Harness as={Sheet} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
