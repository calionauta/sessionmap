import { describe, expect, test } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const { syncService, SYNC_STORAGE_KEY } = await import('./sync');
const { createNewSession } = await import('./storage');

/**
 * The storage-event fallback is throttled for ephemeral traffic.
 *
 * Every keystroke used to rewrite localStorage AND fire a storage event in
 * every other tab. The fallback exists for browsers without BroadcastChannel,
 * not as a second real-time channel: heartbeats, drafts and selections ride
 * the channel instantly and hit storage at most ~1/s, while snapshots and
 * pause state always go out on both immediately.
 *
 * Time is frozen so the 800ms window is deterministic: wall-clock timing
 * would make this a coin flip on a fast machine.
 */

const draft = (text: string) => ({
  type: 'draft' as const,
  draft: { mode: 'add' as const, parentId: null, text, active: true },
});

describe('sync storage fallback throttle', () => {
  test('rapid drafts write once; later drafts and snapshots write', () => {
    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      const read = () =>
        JSON.parse(String(localStorage.getItem(SYNC_STORAGE_KEY)));

      syncService.send(draft('um'));
      expect(read().draft.text).toBe('um');

      t += 100;
      syncService.send(draft('dois'));
      // Skipped: the stored payload is still the first draft.
      expect(read().draft.text).toBe('um');
      expect(read()._t).toBe(1_000_000);

      t += 900;
      syncService.send(draft('três'));
      expect(read().draft.text).toBe('três');

      // Non-ephemeral traffic is never throttled, even in the same instant.
      syncService.send({ type: 'snapshot', map: createNewSession('c_1', 'Uno') });
      expect(read().type).toBe('snapshot');
    } finally {
      Date.now = realNow;
    }
  });
});
