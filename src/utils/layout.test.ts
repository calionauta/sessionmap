import { describe, expect, test } from 'bun:test';
import {
  OUTLINE_MIN_PERCENT,
  OUTLINE_MAX_PERCENT,
  clampOutlineWidth,
} from './layout';

describe('the outline pane width', () => {
  test('opens at the minimum, which is also the floor', () => {
    // The requirement was "keep the current width as the minimum", so the two
    // being the same number is the whole point: the pane can be widened and
    // never comes back narrower than it started.
    expect(OUTLINE_MIN_PERCENT).toBe(38);
  });

  test('a drag past the left edge stops at the floor', () => {
    expect(clampOutlineWidth(0)).toBe(OUTLINE_MIN_PERCENT);
    expect(clampOutlineWidth(10)).toBe(OUTLINE_MIN_PERCENT);
    expect(clampOutlineWidth(37.9)).toBe(OUTLINE_MIN_PERCENT);
  });

  test('a drag past the right edge stops at the ceiling', () => {
    // Not 100: at full width the client screen mirrors an empty canvas, which
    // is the outcome the map pane exists to prevent.
    expect(clampOutlineWidth(100)).toBe(OUTLINE_MAX_PERCENT);
    expect(clampOutlineWidth(400)).toBe(OUTLINE_MAX_PERCENT);
  });

  test('a width inside the range is left alone', () => {
    expect(clampOutlineWidth(38)).toBe(38);
    expect(clampOutlineWidth(55)).toBe(55);
    expect(clampOutlineWidth(75)).toBe(75);
  });

  test('a value that is not a width cannot poison the state', () => {
    // A pane measured at zero makes the drag compute Infinity or NaN. NaN is
    // the dangerous one: Math.max with NaN is NaN, so it survives every
    // comparison and lands in the style attribute as "NaN%", taking the pane off
    // screen for the rest of the session. Infinity is treated the same way on
    // purpose — a value that is not a real width is read as no width, which is
    // one rule instead of two.
    expect(clampOutlineWidth(NaN)).toBe(OUTLINE_MIN_PERCENT);
    expect(clampOutlineWidth(Infinity)).toBe(OUTLINE_MIN_PERCENT);
    expect(clampOutlineWidth(-Infinity)).toBe(OUTLINE_MIN_PERCENT);
  });
});
