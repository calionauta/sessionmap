import { describe, expect, test } from 'bun:test';
import {
  clientModalityIds,
  createNewSession,
  modalityName,
  templatesFor,
} from './storage';
import { MindMap, Modality, SessionTemplate } from '../types';

/**
 * Modalities live on the SESSION, never on the client.
 *
 * The same person is a therapy client on Tuesday and a mentoring client on
 * Thursday. Filing the person in one drawer (a hierarchy) would split their
 * history; tagging only the person would lose which session was which. So
 * each session carries one catalog id, and the client's badges are the union
 * of their sessions — derived, never stored.
 */

const mods: Modality[] = [
  { id: 'mod_terapia', name: 'Terapia', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'mod_mentoria', name: 'Mentoria', createdAt: '2026-01-01T00:00:00Z' },
];

const templates: SessionTemplate[] = [
  {
    id: 'tpl_t',
    modalityId: 'mod_terapia',
    title: 'Terapia',
    markdown: '- Como chega',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'tpl_g',
    modalityId: null,
    title: 'Geral',
    markdown: '- Ponto de partida',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function session(id: string, clientId: string, modalityId?: string | null): MindMap {
  return {
    ...createNewSession(clientId, 'Ana', { modalityId }),
    id,
  };
}

describe('the kind is one value per session', () => {
  test('a session defaults to unclassified, so old sessions stay valid', () => {
    expect(createNewSession('c_ana', 'Ana').modalityId).toBeNull();
  });

  test('the picker value lands on the record', () => {
    expect(
      createNewSession('c_ana', 'Ana', { modalityId: 'mod_terapia' }).modalityId
    ).toBe('mod_terapia');
  });

  test('a template body becomes the starting tree, not a second format', () => {
    const m = createNewSession('c_ana', 'Ana', {
      modalityId: 'mod_terapia',
      templateMarkdown: '- Como chega hoje\n  - O que pesa',
    });
    expect(m.root.children.map((c) => c.text)).toEqual(['Como chega hoje']);
    expect(m.root.children[0].children.map((c) => c.text)).toEqual(['O que pesa']);
  });

  test('no template means the same empty session as always', () => {
    const m = createNewSession('c_ana', 'Ana', { modalityId: 'mod_mentoria' });
    expect(m.root.children).toEqual([]);
  });
});

describe("the client's badges are the union of their sessions", () => {
  const maps = [
    session('m1', 'c_ana', 'mod_terapia'),
    session('m2', 'c_ana', 'mod_mentoria'),
    session('m3', 'c_ana', 'mod_terapia'),
    session('m4', 'c_ana', null),
    session('m5', 'c_bia', 'mod_terapia'),
  ];

  test('one badge per kind, no duplicates, other clients excluded', () => {
    expect(clientModalityIds(maps, 'c_ana').sort()).toEqual([
      'mod_mentoria',
      'mod_terapia',
    ]);
  });

  test('archived sessions do not badge the client', () => {
    const archived = {
      ...session('m6', 'c_ana', 'mod_mentoria'),
      archivedAt: '2026-10-01T00:00:00Z',
    };
    expect(clientModalityIds([...maps, archived], 'c_ana').sort()).toEqual([
      'mod_mentoria',
      'mod_terapia',
    ]);
    const onlyArchived = [archived];
    expect(clientModalityIds(onlyArchived, 'c_ana')).toEqual([]);
  });
});

describe('templates are offered per kind, plus the general ones', () => {
  test('therapy offers its own and the general skeleton', () => {
    expect(templatesFor(templates, 'mod_terapia').map((t) => t.id).sort()).toEqual([
      'tpl_g',
      'tpl_t',
    ]);
  });

  test('mentoring offers only the general one', () => {
    expect(templatesFor(templates, 'mod_mentoria').map((t) => t.id)).toEqual(['tpl_g']);
  });

  test('unclassified offers only the general one', () => {
    expect(templatesFor(templates, null).map((t) => t.id)).toEqual(['tpl_g']);
  });
});

describe('a deleted kind degrades to unclassified, never to corrupt', () => {
  test('unknown ids resolve to null, not to a crash', () => {
    expect(modalityName(mods, 'mod_extinta')).toBeNull();
    expect(modalityName(mods, null)).toBeNull();
    expect(modalityName(mods, undefined)).toBeNull();
  });

  test('known ids resolve', () => {
    expect(modalityName(mods, 'mod_terapia')).toBe('Terapia');
  });
});
