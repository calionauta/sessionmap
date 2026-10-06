import { describe, expect, test, beforeEach } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const storage = await import('./storage');
const {
  buildFullBackup,
  restoreFullBackup,
  writePendingRoot,
  readPendingRoot,
  clearPendingRoot,
  reconcilePendingRoot,
  saveMap,
  getMap,
  createNewSession,
} = storage;

/**
 * Backup envelope + pending-root (the beforeunload gap).
 *
 * The test DOM has no IndexedDB, so every path here runs through the
 * localStorage fallback — which is exactly the fallback the gap fixes
 * depend on. Seeded flags are set up front so the sample records do not
 * pollute the counts; the map fallback still reports its sample, so maps
 * are asserted by id, never by length.
 */

const KEYS = [
  'sessionmap_maps',
  'sessionmap_clients',
  'sessionmap_modalities',
  'sessionmap_templates',
  'sessionmap_pending_root',
];

beforeEach(() => {
  for (const k of KEYS) localStorage.removeItem(k);
  localStorage.setItem('sessionmap_clients_seeded', new Date().toISOString());
  localStorage.setItem('sessionmap_maps_seeded', new Date().toISOString());
});

describe('pending root (refresh/close mid-keystroke)', () => {
  test('round-trips through localStorage synchronously', () => {
    const root = createNewSession('c_ana', 'Ana').root;
    writePendingRoot('m_1', root);
    const back = readPendingRoot();
    expect(back?.mapId).toBe('m_1');
    expect(back?.root).toEqual(root);
    expect(typeof back?.savedAt).toBe('string');
  });

  test('clear removes it and garbage reads as null', () => {
    writePendingRoot('m_1', createNewSession('c_ana', 'Ana').root);
    clearPendingRoot();
    expect(readPendingRoot()).toBeNull();
    localStorage.setItem('sessionmap_pending_root', 'not-json{{{');
    expect(readPendingRoot()).toBeNull();
    localStorage.setItem('sessionmap_pending_root', JSON.stringify({ nope: true }));
    expect(readPendingRoot()).toBeNull();
  });

  test('reconcile applies a newer pending root, then clears it', async () => {
    const base = { ...createNewSession('c_ana', 'Ana'), id: 'm_pending' };
    await saveMap(base);
    const edited = {
      ...base.root,
      children: [...base.root.children, { id: 'n_x', text: 'última tecla', children: [] }],
    };
    writePendingRoot('m_pending', edited);
    expect(await reconcilePendingRoot()).toBe(true);
    expect((await getMap('m_pending'))?.root).toEqual(edited);
    expect(readPendingRoot()).toBeNull();
  });

  test('reconcile skips when storage is already newer (other tab saved)', async () => {
    const base = { ...createNewSession('c_ana', 'Ana'), id: 'm_race' };
    await saveMap(base);
    // Pending entry written first, storage saved after: storage wins. The
    // sleep separates the two ISO-millisecond stamps; without it both land
    // in the same millisecond and the ordering is a coin flip.
    writePendingRoot('m_race', {
      ...base.root,
      children: [...base.root.children, { id: 'n_old', text: 'stale', children: [] }],
    });
    await new Promise((r) => setTimeout(r, 5));
    await saveMap({ ...base, root: base.root });
    expect(await reconcilePendingRoot()).toBe(false);
    expect((await getMap('m_race'))?.root).toEqual(base.root);
  });
});

describe('full backup envelope', () => {
  test('carries all four collections with a format version', async () => {
    const env = await buildFullBackup();
    expect(env.app).toBe('sessionmap');
    expect(env.format).toBe(1);
    expect(typeof env.exportedAt).toBe('string');
    expect(Array.isArray(env.clients)).toBe(true);
    expect(Array.isArray(env.maps)).toBe(true);
    expect(Array.isArray(env.modalities)).toBe(true);
    expect(Array.isArray(env.templates)).toBe(true);
    // Seeded on first read, so a fresh machine backs up its own catalog.
    expect(env.modalities.length).toBeGreaterThan(0);
    expect(env.templates.length).toBeGreaterThan(0);
  });

  test('restores a legacy bare-array file and implies its clients', async () => {
    const legacy = [
      { ...createNewSession('c_ana', 'Ana'), id: 'm_leg_1' },
      { ...createNewSession('c_bia', 'Bia'), id: 'm_leg_2' },
    ];
    const counts = await restoreFullBackup(legacy);
    expect(counts.maps).toBe(2);
    expect(counts.clients).toBe(2);
    expect((await getMap('m_leg_1'))?.clientName).toBe('Ana');
  });

  test('catalog restore is additive: renames are kept, new ids land', async () => {
    const env = await buildFullBackup();
    // Rename locally AFTER the backup was taken.
    const local = JSON.parse(localStorage.getItem('sessionmap_modalities') as string);
    local[0].name = 'Renomeado aqui';
    localStorage.setItem('sessionmap_modalities', JSON.stringify(local));

    const counts = await restoreFullBackup(env);
    const after = JSON.parse(localStorage.getItem('sessionmap_modalities') as string);
    // Same ids, nothing new in this file: zero additions, rename kept.
    expect(counts.modalities).toBe(0);
    expect(after[0].name).toBe('Renomeado aqui');

    // A file carrying an unknown kind adds it.
    const withNew = {
      ...env,
      modalities: [
        ...env.modalities,
        { id: 'mod_novo', name: 'Supervisão', createdAt: new Date().toISOString() },
      ],
    };
    const counts2 = await restoreFullBackup(withNew);
    expect(counts2.modalities).toBe(1);
  });

  test('garbage is rejected before anything is written', async () => {
    await expect(restoreFullBackup({ nada: true })).rejects.toThrow();
    await expect(restoreFullBackup('texto')).rejects.toThrow();
    await expect(restoreFullBackup({ app: 'sessionmap', maps: 'x' })).rejects.toThrow();
    expect(await getMap('m_never_existed')).toBeNull();
  });
});

describe('saveMap stamp opt-out (maintenance writes)', () => {
  test('reclassifying a kind keeps the recency order', async () => {
    const base = { ...createNewSession('c_ana', 'Ana'), id: 'm_nostamp' };
    await saveMap(base);
    const stored = (await getMap('m_nostamp'))!;
    await saveMap({ ...stored, modalityId: 'mod_x' }, { stamp: false });
    expect((await getMap('m_nostamp'))?.updatedAt).toBe(stored.updatedAt);
  });

  test('a restore does not re-stamp or hijack the active session', async () => {
    const base = { ...createNewSession('c_ana', 'Ana'), id: 'm_restore_stamp' };
    await saveMap(base);
    const stored = (await getMap('m_restore_stamp'))!;
    // A restore landing the same record must keep its updatedAt AND leave
    // the active session alone: saveMap's default stamp would rewrite both.
    await restoreFullBackup([{ ...stored }]);
    const after = await getMap('m_restore_stamp');
    expect(after?.updatedAt).toBe(stored.updatedAt);
    expect(localStorage.getItem('sessionmap_active_map_id')).toBe('m_restore_stamp');
  });
});
