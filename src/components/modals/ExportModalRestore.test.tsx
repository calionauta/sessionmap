import { describe, expect, test, afterEach, beforeEach, mock } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const testing = await import('@testing-library/react');
const { render, fireEvent, screen, cleanup } = testing;
const React = await import('react');
const { ExportModal } = await import('./ExportModal');
const { createNewSession } = await import('../../services/storage');

/**
 * Full-backup restore, through the UI.
 *
 * The file is only PARSED on pick: the confirm dialog names the counts
 * first, and only its confirm writes. Pins: legacy bare-array files still
 * restore (with implied clients), the status reports what landed, and the
 * parent refreshes so the new records appear without a reload.
 */

afterEach(() => cleanup());

beforeEach(() => {
  for (const k of [
    'sessionmap_maps',
    'sessionmap_clients',
    'sessionmap_modalities',
    'sessionmap_templates',
    'sessionmap_pending_root',
  ]) {
    localStorage.removeItem(k);
  }
  localStorage.setItem('sessionmap_clients_seeded', new Date().toISOString());
  localStorage.setItem('sessionmap_maps_seeded', new Date().toISOString());
});

const map = { ...createNewSession('c_ana', 'Ana M.'), id: 'm_current' };

function renderModal(onRestoreBackup?: () => void | Promise<void>) {
  return render(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      map,
      svgRef: { current: null },
      theme: 'papel' as const,
      onImportMap: () => {},
      onRestoreBackup,
    })
  );
}

function pickFile(container: HTMLElement, payload: unknown) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([JSON.stringify(payload)], 'backup.json', {
    type: 'application/json',
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ExportModal backup restore', () => {
  test('picking a file only parses: the dialog confirms before anything writes', async () => {
    const onRestoreBackup = mock(() => {});
    const { container } = renderModal(onRestoreBackup);

    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    const restored = { ...createNewSession('c_bia', 'Bia'), id: 'm_new' };
    pickFile(container, {
      app: 'sessionmap',
      format: 1,
      exportedAt: new Date().toISOString(),
      clients: [{ id: 'c_bia', name: 'Bia', createdAt: new Date().toISOString() }],
      maps: [restored],
      modalities: [],
      templates: [],
    });

    // The confirm names what will change; nothing landed yet.
    await screen.findByText('Restaurar este backup?');
    expect(onRestoreBackup).not.toHaveBeenCalled();
    expect(JSON.parse(String(localStorage.getItem('sessionmap_maps') ?? '[]'))).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    await screen.findByText(/Restaurado: 1 sessão, 1 cliente\./);
    expect(onRestoreBackup).toHaveBeenCalled();
    const stored = JSON.parse(String(localStorage.getItem('sessionmap_maps')));
    expect(stored.find((m: { id: string }) => m.id === 'm_new')?.clientName).toBe('Bia');
  });

  test('a legacy bare-array backup restores with implied clients', async () => {
    const { container } = renderModal();
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    pickFile(container, [{ ...createNewSession('c_ana', 'Ana M.'), id: 'm_leg' }]);

    await screen.findByText('Restaurar este backup?');
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    await screen.findByText(/Restaurado: 1 sessão, 1 cliente\./);
  });

  test('garbage is reported, not applied', async () => {
    const { container } = renderModal();
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    pickFile(container, { nada: true });
    await screen.findByText('Esse arquivo não é um backup do SessionMap.');
  });
});
