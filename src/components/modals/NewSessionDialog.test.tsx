import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, screen, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { NewSessionDialog } = await import('./NewSessionDialog');
const { persistModalities, persistTemplates } = await import('../../services/storage');
import type { SessionTemplate } from '../../types';

afterEach(() => cleanup());

/**
 * The kind + skeleton picker shown before a session exists.
 *
 * Pins: the template list follows the picked kind (own + general, never
 * another kind's), the choice is previewed, and confirm hands the record
 * builder exactly (modalityId, template|null) — a blank start is an
 * explicit null, not a missing argument.
 *
 * The catalog starts EMPTY (no seeds): tests plant their own rows, and the
 * empty states guide to the catalog room instead of reading as fixed.
 */

const NOW = '2026-01-01T00:00:00.000Z';

function seedCatalog() {
  persistModalities([
    { id: 'mod_mentoria', name: 'Mentoria', color: '#2f9e6e', createdAt: NOW },
    { id: 'mod_consultoria', name: 'Consultoria', color: '#c47b1e', createdAt: NOW },
    { id: 'mod_reuniao', name: 'Reunião', color: '#7c6cf0', createdAt: NOW },
  ]);
  persistTemplates([
    {
      id: 'tpl_seed_0',
      modalityId: 'mod_mentoria',
      title: 'Sessão de mentoria',
      markdown: '- Objetivo da sessão\n- Onde está travando',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'tpl_seed_1',
      modalityId: 'mod_consultoria',
      title: 'Sessão de consultoria',
      markdown: '- Contexto e meta\n- Diagnóstico',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: 'tpl_seed_2',
      modalityId: 'mod_reuniao',
      title: 'Reunião',
      markdown: '- Objetivo da reunião\n- Decisões',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
}

beforeEach(() => {
  localStorage.removeItem('sessionmap_modalities');
  localStorage.removeItem('sessionmap_templates');
});

function renderDialog(
  onConfirm: (m: string | null, t: SessionTemplate | null) => void,
  onOpenCatalog?: () => void
) {
  return render(
    React.createElement(NewSessionDialog, {
      isOpen: true,
      onClose: () => {},
      clientName: 'Ana M.',
      defaultModalityId: null,
      onConfirm,
      onOpenCatalog,
    })
  );
}

describe('NewSessionDialog', () => {
  test('offers the planted kinds and starts blank', () => {
    seedCatalog();
    renderDialog(() => {});
    const kind = screen.getByLabelText('Tipo de atendimento') as HTMLSelectElement;
    const names = Array.from(kind.options).map((o) => o.text);
    expect(names).toEqual(['Sem tipo', 'Mentoria', 'Consultoria', 'Reunião']);
    expect(kind.value).toBe('');
    // No general (modality-less) template is planted, so the empty state for
    // "Sem tipo" says where to create one rather than offering nothing.
    expect(
      screen.getByText('Nenhum roteiro para este tipo ainda.')
    ).toBeTruthy();
  });

  test('templates follow the kind: own plus general, never another kind', () => {
    seedCatalog();
    renderDialog(() => {});
    const kind = screen.getByLabelText('Tipo de atendimento') as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: 'mod_reuniao' } });

    const tpl = screen.getByLabelText('Roteiro inicial') as HTMLSelectElement;
    const names = Array.from(tpl.options).map((o) => o.text);
    expect(names).toContain('Reunião');
    expect(names).not.toContain('Sessão de mentoria');
    expect(names).not.toContain('Sessão de consultoria');
  });

  test('confirm hands over kind + template, with preview', () => {
    seedCatalog();
    let kind: string | null | undefined;
    let tpl: SessionTemplate | null | undefined;
    renderDialog((m, t) => {
      kind = m;
      tpl = t;
    });

    fireEvent.change(screen.getByLabelText('Tipo de atendimento'), {
      target: { value: 'mod_mentoria' },
    });
    fireEvent.change(screen.getByLabelText('Roteiro inicial'), {
      target: { value: 'tpl_seed_0' },
    });
    // The skeleton is previewed before committing to it.
    expect(screen.getByText(/Onde está travando/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /iniciar sessão/i }));
    expect(kind).toBe('mod_mentoria');
    expect(tpl?.title).toBe('Sessão de mentoria');
    expect(tpl?.markdown).toContain('Onde está travando');
  });

  test('blank start is an explicit null template', () => {
    seedCatalog();
    let kind: string | null | undefined;
    let tpl: SessionTemplate | null | undefined;
    renderDialog((m, t) => {
      kind = m;
      tpl = t;
    });
    fireEvent.change(screen.getByLabelText('Tipo de atendimento'), {
      target: { value: 'mod_consultoria' },
    });
    fireEvent.click(screen.getByRole('button', { name: /iniciar sessão/i }));
    expect(kind).toBe('mod_consultoria');
    expect(tpl).toBeNull();
  });

  test('an empty catalog says blank and leads to the catalog room', () => {
    let opened = 0;
    renderDialog(
      () => {},
      () => {
        opened += 1;
      }
    );
    const kind = screen.getByLabelText('Tipo de atendimento') as HTMLSelectElement;
    expect(Array.from(kind.options).map((o) => o.text)).toEqual(['Sem tipo']);
    // Friendly, not broken: blank is the plan, and the next ones can be
    // structured by creating types and scripts.
    expect(screen.getByText(/Nenhum tipo cadastrado ainda/)).toBeTruthy();
    expect(screen.getByText(/Vai começar em branco mesmo assim/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar tipos e roteiros' }));
    expect(opened).toBe(1);
  });

  test('a kind with no scripts offers the catalog link, not a dead end', () => {
    persistModalities([
      { id: 'mod_solo', name: 'Solo', color: null, createdAt: NOW },
    ]);
    persistTemplates([]);
    let opened = 0;
    renderDialog(
      () => {},
      () => {
        opened += 1;
      }
    );
    fireEvent.change(screen.getByLabelText('Tipo de atendimento'), {
      target: { value: 'mod_solo' },
    });
    expect(screen.getByText('Nenhum roteiro para este tipo ainda.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar tipos e roteiros' }));
    expect(opened).toBe(1);
  });
});
