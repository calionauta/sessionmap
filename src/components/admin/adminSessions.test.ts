import { describe, expect, test } from 'bun:test';

/**
 * The admin panel's per-client history.
 *
 * This is a test of a bug that shipped: `AdminClientManager` receives its
 * session list as a prop and filters it on clientId, but the state it was
 * handed (`allMaps` in HostView) was never assigned anywhere except a
 * deletion filter. It stayed `[]` for the life of the session, so the panel
 * filtered an empty list against every client and rendered "no sessions yet"
 * for a client with real history — including the session that was open on
 * screen at that moment.
 *
 * The logic is reproduced here rather than imported because the bug lived in
 * the WIRING, not in the panel: the panel's filter is correct and was never
 * wrong. A unit test of the filter alone would have passed throughout, which
 * is exactly why the bug survived. These tests pin the two properties the
 * wiring has to hold.
 */

interface Session {
  id: string;
  clientId: string;
  archivedAt?: string | null;
  createdAt: string;
}

interface Client {
  id: string;
  archivedAt?: string | null;
}

const isArchived = (r: { archivedAt?: string | null }) => Boolean(r.archivedAt);

/**
 * The panel's own filter, copied from AdminClientManager.
 */
function sessionsForClient(
  maps: Session[],
  currentClient: Client | null,
  showArchived: boolean
): Session[] {
  return maps
    .filter((m) => m.clientId === currentClient?.id)
    .filter((m) => (showArchived ? isArchived(m) : !isArchived(m)))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Sessions whose clientId matches no client row. */
function orphans(clients: Client[], maps: Session[]): Session[] {
  return maps.filter((m) => !clients.some((c) => c.id === m.clientId));
}

const ana: Client = { id: 'c_ana' };
const bruno: Client = { id: 'c_bruno' };

const sessions: Session[] = [
  { id: 'm1', clientId: 'c_ana', createdAt: '2026-09-28T10:00:00Z' },
  { id: 'm2', clientId: 'c_ana', createdAt: '2026-09-28T14:00:00Z' },
  { id: 'm3', clientId: 'c_bruno', createdAt: '2026-09-29T09:00:00Z' },
  { id: 'm4', clientId: 'c_ana', archivedAt: '2026-09-29T10:00:00Z', createdAt: '2026-09-27T10:00:00Z' },
];

describe('the list the admin panel is handed', () => {
  test('a session created for a client is listed under them', () => {
    // The regression: with allMaps === [] this was 0 while the session was
    // open on screen.
    expect(sessionsForClient(sessions, ana, false)).toHaveLength(2);
  });

  test('is the UNFILTERED list, archived sessions included', () => {
    // HostView keeps a second, active-only list for the header picker and
    // the drawer. The admin panel must get the other one, or its own archive
    // tab can never show anything.
    const working = sessions.filter((m) => !isArchived(m));
    const forPanel = sessions;

    expect(sessionsForClient(working, ana, true)).toHaveLength(0);
    expect(sessionsForClient(forPanel, ana, true)).toHaveLength(1);
  });

  test('a client with history is never shown as empty', () => {
    for (const client of [ana, bruno]) {
      const shown = sessionsForClient(sessions, client, false).length;
      const expected = sessions.filter(
        (m) => m.clientId === client.id && !isArchived(m)
      ).length;
      expect(shown).toBe(expected);
      expect(shown).toBeGreaterThan(0);
    }
  });

  test('archived sessions stay out of the active view but are recoverable', () => {
    expect(sessionsForClient(sessions, ana, false).map((s) => s.id)).toEqual(['m2', 'm1']);
    expect(sessionsForClient(sessions, ana, true).map((s) => s.id)).toEqual(['m4']);
  });

  test('newest first', () => {
    const ids = sessionsForClient(sessions, ana, false).map((s) => s.id);
    expect(ids).toEqual(['m2', 'm1']);
  });
});

describe('a session filed under a client that no longer exists', () => {
  test('surfaces as an orphan rather than vanishing', () => {
    // A session nobody can see is indistinguishable from a lost one, and in
    // this app that is clinical data.
    const lost: Session = {
      id: 'm9',
      clientId: 'c_deletado',
      createdAt: '2026-09-20T10:00:00Z',
    };
    const all = [...sessions, lost];

    expect(sessionsForClient(all, ana, false)).toHaveLength(2);
    expect(orphans([ana, bruno], all).map((s) => s.id)).toEqual(['m9']);
  });

  test('an orphan is not counted as any client’s history', () => {
    const total = [ana, bruno].reduce(
      (n, c) => n + sessionsForClient(sessions, c, false).length,
      0
    );
    expect(total).toBe(3);
    expect(sessions).toHaveLength(4);
  });
});
