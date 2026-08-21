import { describe, expect, it, vi } from 'vitest';
import { PRICING_ENGINE_VERSION, RentalDurationService } from '../src/discovery/duration.service';

describe('RentalDurationService', () => {
  const service = new RentalDurationService();

  it('uses the versioned 24-hour ceiling pricing rule', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(
      service.calculate('2030-01-02T10:00:00+08:00', '2030-01-03T09:00:00+08:00').chargeableDays,
    ).toBe(1);
    expect(
      service.calculate('2030-01-02T10:00:00+08:00', '2030-01-03T11:00:00+08:00').chargeableDays,
    ).toBe(2);
    expect(PRICING_ENGINE_VERSION).toBe('PHP_DAILY_24H_CEILING_V1');
    vi.useRealTimers();
  });

  it('rejects timestamps without an explicit timezone', () => {
    expect(() => service.calculate('2030-01-02T10:00:00', '2030-01-03T10:00:00')).toThrow(
      'timezone-qualified',
    );
  });
});
