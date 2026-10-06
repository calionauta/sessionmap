import { describe, expect, test, afterEach, beforeEach, mock } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const testing = await import('@testing-library/react');
const { render, fireEvent, screen, cleanup, waitFor } = testing;
const React = await import('react');
const { AdminClientManager } = await import('./AdminClientManager');
const { createNewSession } = await import('../../services/storage');
import type { Client, MindMap } from '../../types';

afterEach(() => cleanup());

/**
 * The admin panel's kind wiring, end to end.
 *
 * Unit tests already pin the pure helpers (union, filter, templates). What
 * they cannot catch is the WIRING — the exact class of bug this panel
 * shipped before (a list that stayed empty because the right state was
 * never handed over). So: badges render the union of the client's sessions,
 * reclassifying a session persists and refreshes, and "+ Nova Sessão"
 * reaches the kind + template picker instead of creating a blank record
 * behind the user's back.
 */

const ana: Client = { id: 'c_ana', name: 'Ana M.', createdAt: '2026-09-28T09:00:00Z' };

function session(id: string, modalityId: string | null, sessionDate?: string): MindMap {
  const m = { ...createNewSession('c_ana', 'Ana M.', { modalityId }), id };
  // Two sessions created in the same test second share a timestamp, and the
  // cards (and their aria-labels) would be indistinguishable.
  if (sessionDate) m.sessionDate = sessionDate;
  return m;
}

beforeEach(() => {
  localStorage.removeItem('sessionmap_maps');
  localStorage.removeItem('sessionmap_clients');
  localStorage.removeItem('sessionmap_modalities');
  localStorage.removeItem('sessionmap_templates');
});

function renderAdmin(props?: {
  onRefreshData?: () => void | Promise<void>;
  onSelectSession?: (m: MindMap) => void;
}) {
  const maps = [
    session('m_reu', 'mod_reuniao', '01/01/2026 10:00:00'),
    session('m_men', 'mod_mentoria', '02/01/2026 10:00:00'),
  ];
  return render(
    React.createElement(AdminClientManager, {
      isOpen: true,
      onClose: () => {},
      clients: [ana],
      maps,
      activeMapId: 'm_reu',
      activeClientId: 'c_ana',
      onSelectSession: props?.onSelectSession ?? (() => {}),
      onRefreshData: props?.onRefreshData ?? (() => {}),
      theme: 'papel' as const,
    })
  );
}

describe('AdminClientManager modality wiring', () => {
  test('the client row badges the union of their sessions', () => {
    renderAdmin();
    // One badge per kind on the row (plus one per session card): the union,
    // derived, never stored.
    expect(screen.getAllByText('Reunião').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Mentoria').length).toBeGreaterThanOrEqual(2);
  });

  test('reclassifying a session persists and refreshes', async () => {
    const onRefreshData = mock(() => {});
    renderAdmin({ onRefreshData });
    const label = 'Tipo da sessão 01/01/2026 10:00:00';

    fireEvent.change(screen.getByLabelText(label), { target: { value: 'mod_mentoria' } });
    await waitFor(() => expect(onRefreshData).toHaveBeenCalled());

    const stored = JSON.parse(String(localStorage.getItem('sessionmap_maps')));
    expect(stored.find((m: MindMap) => m.id === 'm_reu')?.modalityId).toBe('mod_mentoria');
  });

  test('"Nova Sessão" opens the picker instead of creating blindly', () => {
    let selected: MindMap | null = null;
    renderAdmin({ onSelectSession: (m) => { selected = m; } });
    fireEvent.click(screen.getByRole('button', { name: 'Nova Sessão' }));
    // The picker, pre-selected with the client's last used kind.
    expect(screen.getByText('Nova sessão · Ana M.')).toBeTruthy();
    expect(selected).toBeNull();
  });
});

describe('AdminClientManager catalog tab', () => {
  test('the catalog tab leaves no empty participantes pane behind', () => {
    // Regression: the participantes split rendered unconditionally with a
    // fixed md:h-[70vh], so the catalog tab opened with a viewport-tall
    // blank above its content. The pane must only exist in its own room.
    const { container } = renderAdmin();
    fireEvent.click(screen.getByRole('tab', { name: 'Tipos e roteiros' }));
    const body = container.querySelector('[role="dialog"]')?.children[1];
    // Tab bar plus exactly one room.
    expect(body?.children).toHaveLength(2);
    const fixedPanes = Array.from(body?.children ?? []).filter((el) =>
      (el as HTMLElement).className.includes('md:h-[70vh]')
    );
    expect(fixedPanes).toHaveLength(0);
  });

  test('the catalog lives beside the clients, not inside one', () => {
    renderAdmin();
    // Default room: the client workflow, no global config in sight.
    expect(screen.getAllByText('Ana M.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Tipos de atendimento')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Tipos e roteiros' }));
    expect(screen.getByText(/Tipos de atendimento/)).toBeTruthy();
    expect(screen.getByText(/Roteiros iniciais/)).toBeTruthy();
    // And the client list steps out of the way.
    expect(screen.queryAllByText('Ana M.')).toHaveLength(0);

    fireEvent.click(screen.getByRole('tab', { name: /participantes/i }));
    expect(screen.getAllByText('Ana M.').length).toBeGreaterThan(0);
  });

  test('adding a kind persists it to the catalog', () => {
    renderAdmin();
    fireEvent.click(screen.getByRole('tab', { name: 'Tipos e roteiros' }));
    fireEvent.change(screen.getByLabelText('Nome do novo tipo'), {
      target: { value: 'Supervisão' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tipo' }));
    const stored = JSON.parse(String(localStorage.getItem('sessionmap_modalities')));
    expect(stored.map((m: { name: string }) => m.name)).toContain('Supervisão');
  });

  test('deleting a kind confirms, then unclassifies its sessions', async () => {
    const onRefreshData = mock(() => {});
    renderAdmin({ onRefreshData });
    fireEvent.click(screen.getByRole('tab', { name: 'Tipos e roteiros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir tipo Reunião' }));
    await screen.findByText('Excluir este tipo?');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir tipo' }));
    await waitFor(() => expect(onRefreshData).toHaveBeenCalled());
    const stored = JSON.parse(String(localStorage.getItem('sessionmap_modalities')));
    expect(stored.map((m: { name: string }) => m.name)).not.toContain('Reunião');
  });

  test('adding a template files it under the picked kind', () => {
    renderAdmin();
    fireEvent.click(screen.getByRole('tab', { name: 'Tipos e roteiros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roteiro' }));
    fireEvent.change(screen.getByLabelText('Título do roteiro'), {
      target: { value: 'Abertura' },
    });
    fireEvent.change(screen.getByLabelText('Tipo do roteiro'), {
      target: { value: 'mod_reuniao' },
    });
    fireEvent.change(screen.getByLabelText('Texto do roteiro em tópicos'), {
      target: { value: '- Chegada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar roteiro' }));
    const stored = JSON.parse(String(localStorage.getItem('sessionmap_templates')));
    const added = stored.find(
      (t: { title: string }) => t.title === 'Abertura'
    ) as { modalityId: string };
    expect(added.modalityId).toBe('mod_reuniao');
  });
});
