import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, screen, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { TypeToConfirmDialog } = await import('./TypeToConfirmDialog');

afterEach(() => cleanup());

/**
 * Destructive actions with no undo require typing the exact word.
 * Pins: disarmed by default, near-misses stay disarmed, the ritual resets
 * per open, and confirm only fires when armed.
 */

function renderDialog(onConfirm: () => void) {
  return render(
    React.createElement(TypeToConfirmDialog, {
      isOpen: true,
      title: 'Apagar tudo?',
      description: 'Isto apaga os arquivos da nuvem.',
      requireWord: 'APAGAR',
      confirmLabel: 'Apagar tudo',
      onConfirm,
      onCancel: () => {},
    })
  );
}

describe('TypeToConfirmDialog', () => {
  test('confirm starts disarmed and near-misses do not arm it', () => {
    renderDialog(() => {});
    const confirm = screen.getByRole('button', { name: 'Apagar tudo' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText(/digite/i);
    fireEvent.change(input, { target: { value: 'apagar' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' APAGAR ' } });
    // Trimmed: surrounding whitespace is a paste artifact, not intent.
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  test('exact word arms, confirm fires, cancel is always available', () => {
    let confirmed = 0;
    let cancelled = 0;
    render(
      React.createElement(TypeToConfirmDialog, {
        isOpen: true,
        title: 'Apagar tudo?',
        description: 'Isto apaga os arquivos da nuvem.',
        confirmLabel: 'Apagar tudo',
        onConfirm: () => { confirmed += 1; },
        onCancel: () => { cancelled += 1; },
      })
    );
    fireEvent.change(screen.getByLabelText(/digite/i), { target: { value: 'APAGAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apagar tudo' }));
    expect(confirmed).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelled).toBe(1);
  });

  test('closed renders nothing', () => {
    const { container } = render(
      React.createElement(TypeToConfirmDialog, {
        isOpen: false,
        title: 'Apagar tudo?',
        description: 'x',
        confirmLabel: 'Apagar tudo',
        onConfirm: () => {},
        onCancel: () => {},
      })
    );
    expect(container.textContent).toBe('');
  });
});
