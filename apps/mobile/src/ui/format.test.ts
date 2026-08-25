import { describe, expect, it } from 'vitest';
import {
  bookingStatusLabel,
  channelLabel,
  dateLabel,
  domainLabel,
  earningStatusLabel,
  money,
  payoutEligibilityLabel,
  titleCase,
  vehicleStatusLabel,
} from './format';

describe('mobile presentation formatting', () => {
  it('maps domain booking states to renter-friendly copy without changing state values', () => {
    expect(bookingStatusLabel('AWAITING_OWNER')).toBe('Waiting for owner');
    expect(bookingStatusLabel('CAPTURE_PENDING')).toBe('Confirming payment');
    expect(bookingStatusLabel('RETURN_PENDING')).toBe('Return being confirmed');
  });

  it('formats PHP minor units and Philippine dates for display', () => {
    expect(money(250_000)).toContain('2,500');
    expect(dateLabel('2026-08-24T01:00:00.000Z')).toContain('2026');
  });

  it('turns internal enum-like values into readable labels', () => {
    expect(titleCase('BATTERY_ELECTRIC')).toBe('Battery Electric');
    expect(domainLabel('BATTERY_ELECTRIC')).toBe('Electric');
    expect(vehicleStatusLabel('CHANGES_REQUIRED')).toBe('Changes requested');
    expect(vehicleStatusLabel('AVAILABLE')).toBe('Available for booking');
    expect(earningStatusLabel('AVAILABLE')).toBe('Available for payout');
    expect(payoutEligibilityLabel('NOT_READY')).toBe('Setup required');
    expect(channelLabel('PH_GCASH')).toBe('GCash');
  });
});
