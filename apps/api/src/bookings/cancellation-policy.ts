import {
  CancellationActorType,
  CancellationPaymentDisposition,
  CancellationPolicyCode,
  CancellationResponsibility,
} from '@carrental/database';

export const CANCELLATION_POLICY_VERSION = 'CARSHARE_CONFIRMED_CANCELLATION_V1';
const HOUR_MS = 60 * 60 * 1000;

export interface ConfirmedCancellationTimingInput {
  confirmedAt: Date;
  evaluatedAt: Date;
  scheduledPickupAt: Date;
}

export interface ConfirmedCancellationTimingResult {
  advance: boolean;
  applicableDeadlineAt: Date;
  policyCode: CancellationPolicyCode;
  refundable: boolean;
}

/** Shared timing authority for cancellation and pre-trip amendment shortening. */
export function evaluateConfirmedCancellationTiming(
  input: ConfirmedCancellationTimingInput,
): ConfirmedCancellationTimingResult {
  if (input.evaluatedAt >= input.scheduledPickupAt)
    throw new Error('Ordinary cancellation is unavailable after pickup.');
  if (input.confirmedAt >= input.scheduledPickupAt)
    throw new Error('Confirmation must precede scheduled pickup.');

  const advance = input.scheduledPickupAt.getTime() - input.confirmedAt.getTime() >= 72 * HOUR_MS;
  const applicableDeadlineAt = advance
    ? new Date(input.scheduledPickupAt.getTime() - 72 * HOUR_MS)
    : new Date(
        Math.min(input.confirmedAt.getTime() + 6 * HOUR_MS, input.scheduledPickupAt.getTime()),
      );
  const refundable = advance
    ? input.evaluatedAt < applicableDeadlineAt
    : input.evaluatedAt <= applicableDeadlineAt && input.evaluatedAt < input.scheduledPickupAt;
  const policyCode = advance
    ? refundable
      ? CancellationPolicyCode.ADVANCE_REFUNDABLE
      : CancellationPolicyCode.ADVANCE_FINAL_72H_NON_REFUNDABLE
    : refundable
      ? CancellationPolicyCode.LAST_MINUTE_GRACE_REFUNDABLE
      : CancellationPolicyCode.LAST_MINUTE_GRACE_EXPIRED_NON_REFUNDABLE;

  return { advance, applicableDeadlineAt, policyCode, refundable };
}

export interface ConfirmedCancellationPolicyInput {
  actor: Exclude<CancellationActorType, 'LEGACY_UNSPECIFIED'>;
  capturedAmountMinor: bigint;
  collectionFeeMinor: bigint;
  commissionMinor: bigint;
  confirmedAt: Date;
  custodyStarted: boolean;
  deliveryFeeMinor: bigint;
  deliveryPerformed: boolean;
  evaluatedAt: Date;
  rentalComponentMinor: bigint;
  scheduledPickupAt: Date;
}

export interface ConfirmedCancellationPolicyResult {
  actor: ConfirmedCancellationPolicyInput['actor'];
  applicableDeadlineAt: Date;
  cancellationFeeMinor: bigint;
  collectionRefundedMinor: bigint;
  commissionRetainedMinor: bigint;
  deliveryRefundedMinor: bigint;
  deliveryRetainedMinor: bigint;
  eligible: boolean;
  nonRefundableRentalMinor: bigint;
  ownerEarningForfeitedMinor: bigint;
  ownerPenaltyMinor: bigint;
  paymentDisposition: CancellationPaymentDisposition;
  policyCode: CancellationPolicyCode;
  policyVersion: typeof CANCELLATION_POLICY_VERSION;
  refundableRentalMinor: bigint;
  responsibility: CancellationResponsibility;
  totalRefundMinor: bigint;
}

export function evaluateConfirmedCancellation(
  input: ConfirmedCancellationPolicyInput,
): ConfirmedCancellationPolicyResult {
  if (input.evaluatedAt >= input.scheduledPickupAt || input.custodyStarted)
    throw new Error('Ordinary cancellation is unavailable after pickup or custody.');
  if (input.confirmedAt >= input.scheduledPickupAt)
    throw new Error('Confirmation must precede scheduled pickup.');
  if (input.commissionMinor < 0n || input.commissionMinor > input.rentalComponentMinor)
    throw new Error('Commission snapshot does not reconcile to the rental component.');
  const componentTotal =
    input.rentalComponentMinor + input.deliveryFeeMinor + input.collectionFeeMinor;
  if (componentTotal !== input.capturedAmountMinor)
    throw new Error('Captured amount does not reconcile to booking components.');

  const {
    applicableDeadlineAt: deadline,
    policyCode,
    refundable,
  } = evaluateConfirmedCancellationTiming(input);

  const ownerCancellation = input.actor === CancellationActorType.OWNER;
  const neutralCancellation =
    input.actor === CancellationActorType.ADMIN || input.actor === CancellationActorType.PLATFORM;
  const refundRental = ownerCancellation || neutralCancellation || refundable;
  const refundableRentalMinor = refundRental
    ? input.rentalComponentMinor -
      (input.actor === CancellationActorType.RENTER ? input.commissionMinor : 0n)
    : 0n;
  const cancellationFeeMinor =
    input.actor === CancellationActorType.RENTER && refundable ? input.commissionMinor : 0n;
  const nonRefundableRentalMinor = refundRental ? 0n : input.rentalComponentMinor;
  const deliveryRetainedMinor = input.deliveryPerformed ? input.deliveryFeeMinor : 0n;
  const deliveryRefundedMinor = input.deliveryFeeMinor - deliveryRetainedMinor;
  const collectionRefundedMinor = input.collectionFeeMinor;
  const totalRefundMinor = refundableRentalMinor + deliveryRefundedMinor + collectionRefundedMinor;
  const ownerEarningForfeitedMinor = refundRental
    ? input.rentalComponentMinor - input.commissionMinor
    : 0n;

  return {
    actor: input.actor,
    applicableDeadlineAt: deadline,
    cancellationFeeMinor,
    collectionRefundedMinor,
    commissionRetainedMinor:
      input.actor === CancellationActorType.RENTER ? input.commissionMinor : 0n,
    deliveryRefundedMinor,
    deliveryRetainedMinor,
    eligible: true,
    nonRefundableRentalMinor,
    ownerEarningForfeitedMinor,
    ownerPenaltyMinor: ownerCancellation ? input.commissionMinor : 0n,
    paymentDisposition:
      totalRefundMinor === 0n
        ? CancellationPaymentDisposition.NO_REFUND
        : totalRefundMinor === input.capturedAmountMinor
          ? CancellationPaymentDisposition.FULL_REFUND
          : CancellationPaymentDisposition.PARTIAL_REFUND,
    policyCode,
    policyVersion: CANCELLATION_POLICY_VERSION,
    refundableRentalMinor,
    responsibility: ownerCancellation
      ? CancellationResponsibility.OWNER
      : input.actor === CancellationActorType.RENTER
        ? CancellationResponsibility.RENTER
        : CancellationResponsibility.PLATFORM,
    totalRefundMinor,
  };
}
