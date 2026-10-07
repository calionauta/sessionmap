import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, screen, cleanup, waitFor } = await import('@testing-library/react');
const React = await import('react');
const { UndoToast } = await import('./UndoToast');

afterEach(() => cleanup());

/**
 * The shared delete-undo notice.
 *
 * Pins the contract every destructive surface relies on: message + undo
 * action, an explicit dismiss (the complaint was "too long and no way to
 * close it"), and self-dismissal after the window — so no caller keeps
 * its own timer.
 */

function renderToast(over?: { onUndo?: () => void; onDismiss?: () => void; durationMs?: number }) {
  return render(
    React.createElement(UndoToast, {
      message: 'Participante Ana excluída.',
      undoLabel: 'Desfazer',
      onUndo: over?.onUndo ?? (() => {}),
      dismissLabel: 'Dispensar aviso',
      onDismiss: over?.onDismiss ?? (() => {}),
      durationMs: over?.durationMs ?? 8000,
    })
  );
}

describe('UndoToast', () => {
  test('undo hands back to the caller', () => {
    let undone = 0;
    renderToast({ onUndo: () => { undone += 1; } });
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(undone).toBe(1);
  });

  test('the close button dismisses early', () => {
    let dismissed = 0;
    renderToast({ onDismiss: () => { dismissed += 1; } });
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(dismissed).toBe(1);
  });

  test('Escape dismisses', () => {
    let dismissed = 0;
    const { container } = renderToast({ onDismiss: () => { dismissed += 1; } });
    const status = container.querySelector('[role="status"]')!;
    fireEvent.keyDown(status, { key: 'Escape' });
    expect(dismissed).toBe(1);
  });

  test('it dismisses itself after the window', async () => {
    let dismissed = 0;
    renderToast({ durationMs: 30, onDismiss: () => { dismissed += 1; } });
    await waitFor(() => expect(dismissed).toBe(1));
  });
});
