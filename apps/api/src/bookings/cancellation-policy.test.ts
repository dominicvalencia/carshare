import { describe, expect, it } from 'vitest';
import { CancellationActorType, CancellationPolicyCode } from '@carrental/database';
import { evaluateConfirmedCancellation } from './cancellation-policy';

const hour = 60 * 60 * 1000;
const pickup = new Date('2026-10-10T12:00:00.000Z');

function policy(confirmedHoursBefore: number, cancelHoursBefore: number) {
  return evaluateConfirmedCancellation({
    actor: CancellationActorType.RENTER,
    capturedAmountMinor: 12_000n,
    collectionFeeMinor: 500n,
    commissionMinor: 1_000n,
    confirmedAt: new Date(pickup.getTime() - confirmedHoursBefore * hour),
    custodyStarted: false,
    deliveryFeeMinor: 1_500n,
    deliveryPerformed: false,
    evaluatedAt: new Date(pickup.getTime() - cancelHoursBefore * hour),
    rentalComponentMinor: 10_000n,
    scheduledPickupAt: pickup,
  });
}

describe('confirmed cancellation policy', () => {
  it.each([
    [96, 90, CancellationPolicyCode.ADVANCE_REFUNDABLE],
    [96, 73, CancellationPolicyCode.ADVANCE_REFUNDABLE],
    [96, 72, CancellationPolicyCode.ADVANCE_FINAL_72H_NON_REFUNDABLE],
    [96, 71, CancellationPolicyCode.ADVANCE_FINAL_72H_NON_REFUNDABLE],
  ])('classifies advance booking boundaries', (confirmed, cancelled, expected) => {
    expect(policy(confirmed, cancelled).policyCode).toBe(expected);
  });

  it('keeps exactly six hours in last-minute grace and expires it after seven', () => {
    expect(policy(48, 42).policyCode).toBe(CancellationPolicyCode.LAST_MINUTE_GRACE_REFUNDABLE);
    expect(policy(48, 41).policyCode).toBe(
      CancellationPolicyCode.LAST_MINUTE_GRACE_EXPIRED_NON_REFUNDABLE,
    );
  });

  it('uses the immutable commission and refunds unperformed fulfillment', () => {
    const result = policy(96, 90);
    expect(result.cancellationFeeMinor).toBe(1_000n);
    expect(result.refundableRentalMinor).toBe(9_000n);
    expect(result.deliveryRefundedMinor).toBe(1_500n);
    expect(result.collectionRefundedMinor).toBe(500n);
    expect(result.totalRefundMinor).toBe(11_000n);
    expect(
      result.refundableRentalMinor + result.nonRefundableRentalMinor + result.cancellationFeeMinor,
    ).toBe(10_000n);
  });

  it('allows a zero-rental-refund cancellation and still refunds unperformed fulfillment', () => {
    const result = policy(96, 72);
    expect(result.refundableRentalMinor).toBe(0n);
    expect(result.nonRefundableRentalMinor).toBe(10_000n);
    expect(result.totalRefundMinor).toBe(2_000n);
    expect(
      result.refundableRentalMinor + result.nonRefundableRentalMinor + result.cancellationFeeMinor,
    ).toBe(10_000n);
  });

  it('fully refunds an Owner cancellation and creates the snapshot-sized penalty result', () => {
    const result = evaluateConfirmedCancellation({
      actor: CancellationActorType.OWNER,
      capturedAmountMinor: 12_000n,
      collectionFeeMinor: 500n,
      commissionMinor: 1_000n,
      confirmedAt: new Date(pickup.getTime() - 96 * hour),
      custodyStarted: false,
      deliveryFeeMinor: 1_500n,
      deliveryPerformed: false,
      evaluatedAt: new Date(pickup.getTime() - 71 * hour),
      rentalComponentMinor: 10_000n,
      scheduledPickupAt: pickup,
    });
    expect(result.totalRefundMinor).toBe(12_000n);
    expect(result.ownerPenaltyMinor).toBe(1_000n);
    expect(result.commissionRetainedMinor).toBe(0n);
  });

  it('retains only authoritative completed delivery service', () => {
    const result = evaluateConfirmedCancellation({
      actor: CancellationActorType.RENTER,
      capturedAmountMinor: 12_000n,
      collectionFeeMinor: 500n,
      commissionMinor: 1_000n,
      confirmedAt: new Date(pickup.getTime() - 96 * hour),
      custodyStarted: false,
      deliveryFeeMinor: 1_500n,
      deliveryPerformed: true,
      evaluatedAt: new Date(pickup.getTime() - 90 * hour),
      rentalComponentMinor: 10_000n,
      scheduledPickupAt: pickup,
    });
    expect(result.deliveryRetainedMinor).toBe(1_500n);
    expect(result.deliveryRefundedMinor).toBe(0n);
    expect(result.collectionRefundedMinor).toBe(500n);
  });

  it('does not invent an Owner penalty for an Admin cancellation', () => {
    const result = evaluateConfirmedCancellation({
      actor: CancellationActorType.ADMIN,
      capturedAmountMinor: 12_000n,
      collectionFeeMinor: 500n,
      commissionMinor: 1_000n,
      confirmedAt: new Date(pickup.getTime() - 96 * hour),
      custodyStarted: false,
      deliveryFeeMinor: 1_500n,
      deliveryPerformed: false,
      evaluatedAt: new Date(pickup.getTime() - 71 * hour),
      rentalComponentMinor: 10_000n,
      scheduledPickupAt: pickup,
    });
    expect(result.ownerPenaltyMinor).toBe(0n);
    expect(result.totalRefundMinor).toBe(12_000n);
  });

  it('blocks cancellation at pickup and after custody', () => {
    expect(() => policy(48, 0)).toThrow(/after pickup or custody/u);
  });
});
