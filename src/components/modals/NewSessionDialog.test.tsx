import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, screen, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { NewSessionDialog } = await import('./NewSessionDialog');
import type { SessionTemplate } from '../../types';

afterEach(() => cleanup());

/**
 * The kind + skeleton picker shown before a session exists.
 *
 * Pins: the template list follows the picked kind (own + general, never
 * another kind's), the choice is previewed, and confirm hands the record
 * builder exactly (modalityId, template|null) — a blank start is an
 * explicit null, not a missing argument.
 */

beforeEach(() => {
  localStorage.removeItem('sessionmap_modalities');
  localStorage.removeItem('sessionmap_templates');
});

function renderDialog(onConfirm: (m: string | null, t: SessionTemplate | null) => void) {
  return render(
    React.createElement(NewSessionDialog, {
      isOpen: true,
      onClose: () => {},
      clientName: 'Ana M.',
      defaultModalityId: null,
      onConfirm,
    })
  );
}

describe('NewSessionDialog', () => {
  test('offers the seeded kinds and starts blank', () => {
    renderDialog(() => {});
    const kind = screen.getByLabelText('Tipo de atendimento') as HTMLSelectElement;
    const names = Array.from(kind.options).map((o) => o.text);
    expect(names).toEqual(['Sem tipo', 'Mentoria', 'Consultoria', 'Reunião']);
    expect(kind.value).toBe('');
    // No general (modality-less) template is seeded, so the empty state for
    // "Sem tipo" says where to create one rather than offering nothing.
    expect(
      screen.getByText('Nenhum roteiro para este tipo ainda — crie um em Participantes & Sessões.')
    ).toBeTruthy();
  });

  test('templates follow the kind: own plus general, never another kind', () => {
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
});
