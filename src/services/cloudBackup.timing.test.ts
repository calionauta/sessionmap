import { describe, expect, test } from 'bun:test';
import { AUTO_BACKUP_IDLE_MS, AUTO_BACKUP_MAX_WAIT_MS } from './cloudBackup';

/**
 * The auto-backup timing contract: trailing idle for the common case, hard
 * ceiling so a non-stop typing session still uploads. A blind fixed interval
 * is deliberately NOT the strategy — it would upload even with zero changes.
 */
describe('auto-backup timing', () => {
  test('idle is ~1 minute of quiet', () => {
    expect(AUTO_BACKUP_IDLE_MS).toBe(60_000);
  });

  test('the ceiling strictly bounds staleness above the idle', () => {
    expect(AUTO_BACKUP_MAX_WAIT_MS).toBeGreaterThan(AUTO_BACKUP_IDLE_MS);
  });

  test('the ceiling is minutes, not hours', () => {
    expect(AUTO_BACKUP_MAX_WAIT_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});
