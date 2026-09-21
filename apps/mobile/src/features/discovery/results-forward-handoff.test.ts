import { describe, expect, it } from 'vitest';
import {
  clampUnit,
  eligibleForwardRemainder,
  eligibleReverseRemainder,
  forwardSyntheticTarget,
  measuredMaxListOffset,
  normalizedDownwardTravel,
  normalizedUpwardTravel,
  reverseCollapseProgress,
} from './results-forward-handoff';

describe('Task 12A forward Results handoff', () => {
  it('normalizes upward travel and collapse progress', () => {
    expect(normalizedUpwardTravel(12)).toBe(0);
    expect(normalizedUpwardTravel(-80)).toBe(80);
    expect(clampUnit(-1)).toBe(0);
    expect(clampUnit(0.4)).toBe(0.4);
    expect(clampUnit(2)).toBe(1);
  });

  it('keeps reverse restoration native-first and uses only post-top travel', () => {
    expect(normalizedDownwardTravel(-20)).toBe(0);
    expect(normalizedDownwardTravel(190)).toBe(190);
    expect(eligibleReverseRemainder(190, -1)).toBe(0);
    expect(eligibleReverseRemainder(190, 150)).toBe(40);
    expect(eligibleReverseRemainder(210, 150)).toBe(60);
    expect(eligibleReverseRemainder(180, 150)).toBe(30);
    expect(reverseCollapseProgress(0, 200)).toBe(1);
    expect(reverseCollapseProgress(40, 200)).toBe(0.8);
    expect(reverseCollapseProgress(200, 200)).toBe(0);
    expect(reverseCollapseProgress(260, 200)).toBe(0);
  });

  it('applies only travel beyond the stable handoff boundary', () => {
    expect(eligibleForwardRemainder(190, 200)).toBe(0);
    expect(eligibleForwardRemainder(200, 200)).toBe(0);
    expect(eligibleForwardRemainder(260, 200)).toBe(60);
    expect(eligibleForwardRemainder(230, 200)).toBe(30);
    expect(eligibleForwardRemainder(200, 200)).toBe(0);
  });

  it('uses measured geometry and clamps targets without drift', () => {
    expect(measuredMaxListOffset(0, 600)).toBe(0);
    expect(measuredMaxListOffset(500, 600)).toBe(0);
    expect(measuredMaxListOffset(900, 600)).toBe(300);
    expect(forwardSyntheticTarget(0, 0, 220)).toBe(0);
    expect(forwardSyntheticTarget(0, 90, 220)).toBe(90);
    expect(forwardSyntheticTarget(0, 300, 220)).toBe(220);
    expect(forwardSyntheticTarget(0, 100, 0)).toBe(0);
    expect([10, 20, 30, 20, 10].map((value) => forwardSyntheticTarget(0, value, 100))).toEqual([
      10, 20, 30, 20, 10,
    ]);
  });
});
