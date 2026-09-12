import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimErrorCode } from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import {
  AdditionalChargeLineCategory,
  AdditionalChargeStatus,
  BookingStatus,
  ClaimAdjudicationOutcome,
  ClaimCalculationMethod,
  ClaimEvidenceType,
  ClaimResponseDecision,
  DisputeOriginType,
  DisputeStatus,
  EarningHoldMode,
  EarningHoldReason,
  EarningHoldStatus,
  EvidenceParticipantRole,
  FileAssetStatus,
  FileClassification,
  FinancialAccountType,
  LedgerTransactionType,
  OwnerEarningStatus,
  PaymentFailureCategory,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentProviderCode,
  PaymentPurpose,
  PaymentStatus,
  PostReturnClaimCategory,
  PostReturnClaimStatus,
  Prisma,
  RefundStatus,
} from '@carrental/database';
import type { PaymentProvider, ProviderOperationResult } from '@carrental/payments';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { PAYMENT_PROVIDER } from '../payments/payment-provider.factory';
import type { RequestMetadata } from '../security/security-context';
import type {
  AddClaimEvidenceDto,
  AdminAdjudicateClaimDto,
  ClaimEvidenceInputDto,
  ClaimListQueryDto,
  ClaimResponseDto,
  CreateEarningHoldDto,
  CreatePostReturnClaimDto,
  RefundAdditionalChargeDto,
  ResolveDisputeDto,
} from './claims.dto';

const formulaCategories = new Set<PostReturnClaimCategory>([
  PostReturnClaimCategory.EXCESS_MILEAGE,
  PostReturnClaimCategory.FUEL_DEFICIENCY,
  PostReturnClaimCategory.EV_BATTERY_DEFICIENCY,
  PostReturnClaimCategory.LATE_RETURN,
]);
const fullExposureCategories = new Set<PostReturnClaimCategory>([
  PostReturnClaimCategory.DAMAGE,
  PostReturnClaimCategory.CLEANING,
  PostReturnClaimCategory.OTHER,
  PostReturnClaimCategory.FUEL_DEFICIENCY,
  PostReturnClaimCategory.EV_BATTERY_DEFICIENCY,
]);
const mediumSeverityCategories = new Set<PostReturnClaimCategory>([
  PostReturnClaimCategory.FUEL_DEFICIENCY,
  PostReturnClaimCategory.EV_BATTERY_DEFICIENCY,
  PostReturnClaimCategory.LATE_RETURN,
  PostReturnClaimCategory.OTHER,
]);

const claimInclude = {
  additionalCharge: {
    include: {
      lines: true,
      payment: { include: { operations: true, refunds: true } },
    },
  },
  adjudications: { include: { calculation: true }, orderBy: { version: 'asc' as const } },
  booking: {
    include: {
      inspections: { include: { media: true }, orderBy: { createdAt: 'asc' as const } },
      ownerEarning: { include: { holds: true } },
      payments: { include: { refunds: true } },
      policySnapshot: true,
      pricingSnapshot: true,
      rentalIncidents: true,
      usageSummary: true,
      vehicle: { select: { make: true, model: true, powertrain: true } },
    },
  },
  calculations: { include: { policy: true }, orderBy: { version: 'asc' as const } },
  disputes: { include: { evidence: true }, orderBy: { openedAt: 'asc' as const } },
  evidence: { include: { fileAsset: true }, orderBy: { createdAt: 'asc' as const } },
  response: true,
} satisfies Prisma.PostReturnClaimInclude;

@Injectable()
export class ClaimsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async createOwnerClaim(
    ownerUserId: string,
    reference: string,
    input: CreatePostReturnClaimDto,
    request: RequestMetadata,
  ) {
    const claimId = await this.database.client.$transaction(async (transaction) => {
      const booking = await transaction.booking.findFirst({
        include: {
          inspections: true,
          ownerEarning: true,
          policySnapshot: true,
          pricingSnapshot: true,
          usageSummary: true,
        },
        where: { ownerUserId, ...this.bookingIdentity(reference) },
      });
      if (!booking) this.notFound();
      await this.lockBooking(transaction, booking.id);
      if (
        booking.status !== BookingStatus.RETURNED ||
        !booking.claimDeadlineAt ||
        booking.claimDeadlineAt < new Date()
      ) {
        this.fail(
          ClaimErrorCode.CLAIM_DEADLINE_PASSED,
          'The stored post-return claim deadline has passed.',
          HttpStatus.CONFLICT,
        );
      }
      if (!booking.policySnapshot || !booking.pricingSnapshot || !booking.usageSummary) {
        this.invalid('Authoritative booking policy, pricing, and usage snapshots are required.');
      }
      const evidence = input.evidence ?? [];
      if (
        (input.category === PostReturnClaimCategory.CLEANING ||
          input.category === PostReturnClaimCategory.DAMAGE) &&
        (evidence.length === 0 ||
          booking.inspections.filter((item) => item.status === 'FINALIZED').length < 2)
      ) {
        this.fail(
          ClaimErrorCode.CLAIM_EVIDENCE_REQUIRED,
          'Damage and cleaning claims require pickup/return inspections and claim evidence.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      await this.validateEvidence(transaction, ownerUserId, evidence);
      const policy = await transaction.claimPolicy.findFirst({
        orderBy: { version: 'desc' },
        where: {
          category: input.category,
          effectiveFrom: { lte: new Date() },
          OR: [{ disabledAt: null }, { disabledAt: { gt: new Date() } }],
        },
      });
      if (!policy) this.invalid('No active platform claim policy is configured.');
      const calculation = this.calculateClaim(input.category, booking, policy);
      const responseDeadlineAt = new Date(
        Date.now() +
          this.configuration.getOrThrow('CLAIM_RESPONSE_WINDOW_HOURS', { infer: true }) * 3_600_000,
      );
      const created = await transaction.postReturnClaim.create({
        data: {
          blocking: true,
          bookingId: booking.id,
          calculations: {
            create: {
              amountMinor: calculation.amountMinor,
              bookingPolicyRef: booking.policySnapshot.policyVersionId,
              claimPolicyId: policy.id,
              currency: policy.currency,
              formulaVersion: policy.formulaVersion,
              inputs: calculation.inputs,
              method: policy.calculationMethod,
              quantity: calculation.quantity,
              roundingRule: calculation.roundingRule,
              unit: calculation.unit,
              unitRateMinor: calculation.unitRateMinor,
              version: 1,
            },
          },
          category: input.category,
          description: input.description,
          id: randomUUID(),
          responseDeadlineAt,
          status: PostReturnClaimStatus.RENTER_REVIEW,
          submittedByUserId: ownerUserId,
        },
      });
      if (evidence.length) {
        await transaction.postReturnClaimEvidence.createMany({
          data: evidence.map((item) => ({
            claimId: created.id,
            evidenceType: item.evidenceType ?? ClaimEvidenceType.PHOTO,
            fileAssetId: item.fileAssetId,
            note: item.note ?? null,
            participantRole: EvidenceParticipantRole.OWNER,
            submittedByUserId: ownerUserId,
          })),
        });
      }
      if (booking.ownerEarning) {
        const exposure =
          booking.ownerEarning.netEarningAmountMinor +
          booking.ownerEarning.deliveryEarningMinor +
          booking.ownerEarning.collectionEarningMinor +
          booking.ownerEarning.additionalCompensationMinor +
          booking.ownerEarning.adjustmentAmountMinor;
        if (exposure > 0n) {
          const full = fullExposureCategories.has(input.category) || calculation.amountMinor === 0n;
          const amount = full
            ? exposure
            : this.minimum(exposure, (calculation.amountMinor * 110n + 99n) / 100n);
          if (amount > 0n) {
            await transaction.earningHold.create({
              data: {
                amountMinor: amount,
                claimId: created.id,
                currency: booking.ownerEarning.currency,
                mode: full ? EarningHoldMode.FULL : EarningHoldMode.PARTIAL,
                ownerEarningId: booking.ownerEarning.id,
                rationale: full
                  ? 'Unknown or evidence-based claim exposure requires a full MVP hold.'
                  : 'Known formula exposure plus a ten-percent safety margin.',
                reason: EarningHoldReason.CLAIM_EXPOSURE,
              },
            });
            await this.event(transaction, booking.id, created.id, 'EARNING_HOLD_CREATED');
            await this.analytics(transaction, booking.id, 'EARNING_HELD', request);
          }
        }
      }
      await this.event(transaction, booking.id, created.id, 'CLAIM_SUBMITTED');
      await this.event(transaction, booking.id, created.id, 'CLAIM_RESPONSE_REQUIRED');
      await this.analytics(transaction, booking.id, 'CLAIM_CREATED', request);
      return created.id;
    });
    return this.ownerClaim(ownerUserId, claimId);
  }

  async ownerClaims(ownerUserId: string, query: ClaimListQueryDto) {
    return this.list({
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      booking: { ownerUserId },
    });
  }

  async renterClaims(renterUserId: string, query: ClaimListQueryDto) {
    return this.list({
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      booking: { renterUserId },
    });
  }

  async ownerClaim(ownerUserId: string, claimId: string) {
    return this.findParticipant(claimId, { ownerUserId });
  }

  async renterClaim(renterUserId: string, claimId: string) {
    return this.findParticipant(claimId, { renterUserId });
  }

  async addOwnerEvidence(ownerUserId: string, claimId: string, input: AddClaimEvidenceDto) {
    await this.addEvidence(ownerUserId, claimId, input, EvidenceParticipantRole.OWNER, {
      ownerUserId,
    });
    return this.ownerClaim(ownerUserId, claimId);
  }

  async addRenterEvidence(renterUserId: string, claimId: string, input: AddClaimEvidenceDto) {
    await this.addEvidence(renterUserId, claimId, input, EvidenceParticipantRole.RENTER, {
      renterUserId,
    });
    return this.renterClaim(renterUserId, claimId);
  }

  async withdraw(ownerUserId: string, claimId: string, reason: string, request: RequestMetadata) {
    await this.database.client.$transaction(async (transaction) => {
      const claim = await this.lockClaim(transaction, claimId);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: claim.bookingId },
      });
      if (booking.ownerUserId !== ownerUserId) this.notFound();
      if (
        claim.status !== PostReturnClaimStatus.SUBMITTED &&
        claim.status !== PostReturnClaimStatus.RENTER_REVIEW
      ) {
        this.invalid('Only a non-adjudicated claim may be withdrawn.');
      }
      const now = new Date();
      await transaction.postReturnClaim.update({
        data: { resolvedAt: now, status: PostReturnClaimStatus.WITHDRAWN },
        where: { id: claim.id },
      });
      await this.releaseClaimHolds(transaction, claim.id, `Owner withdrew claim: ${reason}`);
      await this.event(transaction, booking.id, claim.id, 'CLAIM_WITHDRAWN');
      await this.analytics(transaction, booking.id, 'CLAIM_REJECTED', request);
    });
    return this.ownerClaim(ownerUserId, claimId);
  }

  async respond(
    renterUserId: string,
    claimId: string,
    input: ClaimResponseDto,
    request: RequestMetadata,
  ) {
    if (input.decision === ClaimResponseDecision.NO_RESPONSE) {
      this.invalid('NO_RESPONSE is assigned only by the platform deadline worker.');
    }
    await this.database.client.$transaction(async (transaction) => {
      const claim = await this.lockClaim(transaction, claimId);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: claim.bookingId },
      });
      if (booking.renterUserId !== renterUserId) this.notFound();
      if (claim.status !== PostReturnClaimStatus.RENTER_REVIEW)
        this.invalid('Claim is not awaiting renter review.');
      if (claim.responseDeadlineAt && claim.responseDeadlineAt < new Date()) {
        this.fail(
          ClaimErrorCode.CLAIM_RESPONSE_DEADLINE_PASSED,
          'The renter response window has closed.',
          HttpStatus.CONFLICT,
        );
      }
      const evidence = input.evidence ?? [];
      await this.validateEvidence(transaction, renterUserId, evidence);
      await transaction.claimResponse.create({
        data: {
          claimId,
          decision: input.decision,
          explanation: input.explanation ?? null,
          renterUserId,
        },
      });
      if (evidence.length) {
        await transaction.postReturnClaimEvidence.createMany({
          data: evidence.map((item) => ({
            claimId,
            evidenceType: item.evidenceType ?? ClaimEvidenceType.PHOTO,
            fileAssetId: item.fileAssetId,
            note: item.note ?? null,
            participantRole: EvidenceParticipantRole.RENTER,
            submittedByUserId: renterUserId,
          })),
        });
      }
      if (input.decision === ClaimResponseDecision.DISPUTED) {
        await transaction.dispute.create({
          data: {
            blocksCompletion: true,
            bookingId: booking.id,
            claimId,
            openedByUserId: renterUserId,
            originType: DisputeOriginType.CLAIM,
            reason: input.explanation ?? 'Renter disputes responsibility for this claim.',
            status: DisputeStatus.OPEN,
          },
        });
        await this.event(transaction, booking.id, claim.id, 'CLAIM_DISPUTED');
        await this.analytics(transaction, booking.id, 'DISPUTE_OPENED', request);
      }
      await transaction.postReturnClaim.update({
        data: { status: PostReturnClaimStatus.UNDER_ADMIN_REVIEW },
        where: { id: claim.id },
      });
      await this.event(transaction, booking.id, claim.id, 'CLAIM_RESPONDED');
      await this.analytics(transaction, booking.id, 'CLAIM_RESPONDED', request);
    });
    return this.renterClaim(renterUserId, claimId);
  }

  async adminClaims(query: ClaimListQueryDto) {
    return this.list({
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.minimumAgeHours !== undefined
        ? { submittedAt: { lte: new Date(Date.now() - query.minimumAgeHours * 3_600_000) } }
        : {}),
      ...this.claimSeverityWhere(query.severity),
    });
  }

  async adminClaim(claimId: string) {
    const claim = await this.database.client.postReturnClaim.findUnique({
      include: claimInclude,
      where: { id: claimId },
    });
    if (!claim) this.notFound();
    const ledgerSourceIds = [
      ...claim.booking.payments.map((item) => item.id),
      ...(claim.additionalCharge?.payment ? [claim.additionalCharge.payment.id] : []),
    ];
    const ledger = await this.database.client.ledgerTransaction.findMany({
      include: { entries: { include: { account: true } } },
      orderBy: { postedAt: 'asc' },
      where: { sourceId: { in: ledgerSourceIds } },
    });
    return this.serialize({
      claim: { ...claim, severity: this.claimSeverity(claim) },
      ledger,
    });
  }

  async adjudicate(
    adminUserId: string,
    claimId: string,
    input: AdminAdjudicateClaimDto,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const claim = await transaction.postReturnClaim.findUnique({
        include: {
          booking: {
            include: {
              ownerEarning: true,
              policySnapshot: true,
              pricingSnapshot: true,
              usageSummary: true,
            },
          },
          calculations: { include: { policy: true }, orderBy: { version: 'desc' } },
          disputes: true,
          evidence: true,
        },
        where: { id: claimId },
      });
      if (!claim) this.notFound();
      const lockedClaim = await this.lockClaim(transaction, claim.id);
      await this.lockBooking(transaction, claim.bookingId);
      if (lockedClaim.status !== PostReturnClaimStatus.UNDER_ADMIN_REVIEW) {
        this.invalid('Claim is not under administrative review.');
      }
      const latest = claim.calculations[0];
      if (!latest || !claim.booking.ownerEarning)
        this.invalid('Claim financial snapshots are incomplete.');
      const version = (await transaction.claimAdjudication.count({ where: { claimId } })) + 1;

      if (input.outcome === ClaimAdjudicationOutcome.REQUEST_MORE_EVIDENCE) {
        await transaction.claimAdjudication.create({
          data: {
            approvedAmountMinor: 0,
            claimId,
            currency: latest.currency,
            decidedByUserId: adminUserId,
            outcome: input.outcome,
            reason: input.reason,
            version,
          },
        });
        await transaction.postReturnClaim.update({
          data: {
            responseDeadlineAt: new Date(
              Date.now() +
                this.configuration.getOrThrow('CLAIM_RESPONSE_WINDOW_HOURS', { infer: true }) *
                  3_600_000,
            ),
            status: PostReturnClaimStatus.RENTER_REVIEW,
          },
          where: { id: claimId },
        });
        await this.audit(
          transaction,
          adminUserId,
          'CLAIM_MORE_EVIDENCE_REQUESTED',
          claimId,
          input.reason,
          request,
        );
        return;
      }

      if (input.outcome === ClaimAdjudicationOutcome.ESCALATED_TO_DISPUTE) {
        await transaction.claimAdjudication.create({
          data: {
            approvedAmountMinor: 0,
            claimId,
            currency: latest.currency,
            decidedByUserId: adminUserId,
            outcome: input.outcome,
            reason: input.reason,
            version,
          },
        });
        if (!claim.disputes.some((item) => this.disputeOpen(item.status))) {
          await transaction.dispute.create({
            data: {
              bookingId: claim.bookingId,
              claimId,
              openedByUserId: adminUserId,
              originType: DisputeOriginType.CLAIM,
              reason: input.reason,
              status: DisputeStatus.EVIDENCE_COLLECTION,
            },
          });
        }
        await this.event(transaction, claim.bookingId, claim.id, 'CLAIM_DISPUTED');
        await this.analytics(transaction, claim.bookingId, 'DISPUTE_OPENED', request);
        await this.audit(
          transaction,
          adminUserId,
          'CLAIM_ESCALATED_TO_DISPUTE',
          claimId,
          input.reason,
          request,
        );
        return;
      }

      const approved = await this.resolveApprovedAmount(transaction, claim, latest, input);
      const adjudication = await transaction.claimAdjudication.create({
        data: {
          approvedAmountMinor: approved.amount,
          calculationId: approved.calculationId,
          claimId,
          currency: latest.currency,
          decidedByUserId: adminUserId,
          outcome: input.outcome,
          reason: input.reason,
          version,
        },
      });
      const now = new Date();
      const openDisputes = claim.disputes.filter((item) => this.disputeOpen(item.status));
      if (openDisputes.length) {
        const status =
          input.outcome === ClaimAdjudicationOutcome.REJECTED
            ? DisputeStatus.RESOLVED_FOR_RENTER
            : input.outcome === ClaimAdjudicationOutcome.PARTIALLY_APPROVED
              ? DisputeStatus.PARTIALLY_RESOLVED
              : DisputeStatus.RESOLVED_FOR_OWNER;
        await transaction.dispute.updateMany({
          data: {
            resolvedAt: now,
            resolvedByUserId: adminUserId,
            resolutionReason: input.reason,
            status,
          },
          where: { id: { in: openDisputes.map((item) => item.id) } },
        });
        await this.analytics(transaction, claim.bookingId, 'DISPUTE_RESOLVED', request);
      }
      await this.releaseClaimHolds(transaction, claimId, `Superseded by adjudication v${version}`);

      if (approved.amount === 0n || input.outcome === ClaimAdjudicationOutcome.REJECTED) {
        await transaction.postReturnClaim.update({
          data: { resolvedAt: now, status: PostReturnClaimStatus.RESOLVED },
          where: { id: claimId },
        });
        await transaction.ownerEarning.update({
          data: {
            lastFinancialResolutionAt: now,
            status: await this.earningStatusAfterRelease(
              transaction,
              claim.booking.ownerEarning.id,
            ),
          },
          where: { id: claim.booking.ownerEarning.id },
        });
        await this.event(transaction, claim.bookingId, claim.id, 'CLAIM_REJECTED');
        await this.analytics(transaction, claim.bookingId, 'CLAIM_REJECTED', request);
      } else {
        const policy = latest.policy;
        const platformShare = (approved.amount * BigInt(policy.platformShareBasisPoints)) / 10_000n;
        const ownerCompensation = approved.amount - platformShare;
        const charge = await transaction.additionalCharge.create({
          data: {
            adjudicationId: adjudication.id,
            approvedAmountMinor: approved.amount,
            approvedAt: now,
            bookingId: claim.bookingId,
            claimId,
            collectionStrategy: 'RENTER_AUTHORIZATION',
            currency: latest.currency,
            lines: {
              create: {
                amountMinor: approved.amount,
                calculationSource: latest.method,
                category: this.lineCategory(claim.category),
                claimCalculationId: approved.calculationId ?? latest.id,
                currency: latest.currency,
                evidenceReferences: claim.evidence.map((item) => item.id),
                formulaVersion: approved.formulaVersion,
                quantity: approved.quantity,
                unit: approved.unit,
                unitRateMinor: approved.unitRateMinor,
              },
            },
            ownerCompensationMinor: ownerCompensation,
            ownerEarningId: claim.booking.ownerEarning.id,
            platformShareMinor: platformShare,
            providerIdempotencyKey: `claim:${claimId}:additional-charge:v1`,
            status: AdditionalChargeStatus.PAYMENT_PENDING,
          },
        });
        const exposure =
          claim.booking.ownerEarning.netEarningAmountMinor +
          claim.booking.ownerEarning.deliveryEarningMinor +
          claim.booking.ownerEarning.collectionEarningMinor +
          claim.booking.ownerEarning.additionalCompensationMinor +
          claim.booking.ownerEarning.adjustmentAmountMinor;
        const holdAmount = this.minimum(exposure, approved.amount);
        if (holdAmount > 0n) {
          await transaction.earningHold.create({
            data: {
              amountMinor: holdAmount,
              claimId,
              createdByUserId: adminUserId,
              currency: latest.currency,
              mode: holdAmount === exposure ? EarningHoldMode.FULL : EarningHoldMode.PARTIAL,
              ownerEarningId: claim.booking.ownerEarning.id,
              rationale:
                'Approved charge remains financially unresolved until provider collection.',
              reason: EarningHoldReason.PAYMENT_RECONCILIATION,
            },
          });
        }
        await transaction.postReturnClaim.update({
          data: { status: PostReturnClaimStatus.PAYMENT_PENDING },
          where: { id: claimId },
        });
        await this.event(transaction, claim.bookingId, claim.id, 'CLAIM_APPROVED');
        await this.event(
          transaction,
          claim.bookingId,
          charge.id,
          'ADDITIONAL_CHARGE_PAYMENT_REQUIRED',
        );
        await this.analytics(transaction, claim.bookingId, 'CLAIM_APPROVED', request);
        await this.analytics(transaction, claim.bookingId, 'ADDITIONAL_CHARGE_CREATED', request);
      }
      await this.audit(
        transaction,
        adminUserId,
        'CLAIM_ADJUDICATED',
        claimId,
        input.reason,
        request,
      );
    });
    return this.adminClaim(claimId);
  }

  async payAdditionalCharge(renterUserId: string, chargeId: string, request: RequestMetadata) {
    if (!this.provider.capabilities.supportsAdditionalPaymentAuthorization) {
      this.invalid('The configured payment provider cannot authorize additional payments.');
    }
    const prepared = await this.database.client.$transaction(async (transaction) => {
      let charge = await transaction.additionalCharge.findFirst({
        include: {
          booking: { include: { renter: { select: { email: true } } } },
          payment: { include: { operations: true } },
        },
        where: { id: chargeId, booking: { renterUserId } },
      });
      if (!charge)
        this.fail(
          ClaimErrorCode.ADDITIONAL_CHARGE_NOT_FOUND,
          'Additional charge not found.',
          HttpStatus.NOT_FOUND,
        );
      await this.lockCharge(transaction, charge.id);
      charge = await transaction.additionalCharge.findFirstOrThrow({
        include: {
          booking: { include: { renter: { select: { email: true } } } },
          payment: { include: { operations: true } },
        },
        where: { id: chargeId, booking: { renterUserId } },
      });
      if (
        charge.status === AdditionalChargeStatus.PAID ||
        charge.payment?.status === PaymentStatus.CAPTURED
      ) {
        return { charge, operation: null, payment: charge.payment };
      }
      if (
        charge.payment?.status === PaymentStatus.FAILED &&
        charge.status === AdditionalChargeStatus.PAYMENT_FAILED
      ) {
        const attempt =
          charge.payment.operations.filter(
            (operation) => operation.type === PaymentOperationType.AUTHORIZE,
          ).length + 1;
        const requestReference = randomUUID();
        const operation = await transaction.paymentOperation.create({
          data: {
            amountMinor: charge.payment.amountMinor,
            attemptCount: 1,
            currency: charge.payment.currency,
            idempotencyKey: `${charge.providerIdempotencyKey}:authorize:v${attempt}`,
            paymentId: charge.payment.id,
            providerRequestReference: requestReference,
            startedAt: new Date(),
            status: PaymentOperationStatus.PROCESSING,
            type: PaymentOperationType.AUTHORIZE,
          },
        });
        const payment = await transaction.payment.update({
          data: {
            customerActionUrl: null,
            externalPaymentId: null,
            providerRequestReference: requestReference,
            providerState: null,
            reconcileAfter: null,
            reconciliationRequired: false,
            status: PaymentStatus.AUTHORIZING,
            unknownExpiresAt: null,
          },
          where: { id: charge.payment.id },
        });
        await transaction.additionalCharge.update({
          data: { status: AdditionalChargeStatus.PROCESSING },
          where: { id: charge.id },
        });
        return { charge, operation, payment };
      }
      // A provider call is deliberately made after the database transaction commits.
      // Concurrent requests therefore observe the durable in-flight payment and join it
      // instead of starting another authorization or failing with an invalid-state error.
      if (charge.payment) return { charge, operation: null, payment: charge.payment };
      if (
        charge.status !== AdditionalChargeStatus.PAYMENT_PENDING &&
        charge.status !== AdditionalChargeStatus.PAYMENT_FAILED
      ) {
        this.fail(
          ClaimErrorCode.ADDITIONAL_CHARGE_INVALID_STATE,
          'Charge is not awaiting renter payment.',
          HttpStatus.CONFLICT,
        );
      }
      const requestReference = randomUUID();
      const payment = await transaction.payment.create({
        data: {
          additionalChargeId: charge.id,
          amountMinor: charge.approvedAmountMinor,
          bookingId: charge.bookingId,
          currency: charge.currency,
          provider: this.provider.code as PaymentProviderCode,
          providerRequestReference: requestReference,
          purpose: PaymentPurpose.ADDITIONAL_CHARGE,
          status: PaymentStatus.AUTHORIZING,
        },
      });
      const operation = await transaction.paymentOperation.create({
        data: {
          amountMinor: payment.amountMinor,
          attemptCount: 1,
          currency: payment.currency,
          idempotencyKey: `${charge.providerIdempotencyKey}:authorize:v1`,
          paymentId: payment.id,
          providerRequestReference: requestReference,
          startedAt: new Date(),
          status: PaymentOperationStatus.PROCESSING,
          type: PaymentOperationType.AUTHORIZE,
        },
      });
      await transaction.additionalCharge.update({
        data: { status: AdditionalChargeStatus.PROCESSING },
        where: { id: charge.id },
      });
      return { charge, operation, payment };
    });
    if (!prepared.operation || !prepared.payment)
      return this.additionalCharge(renterUserId, chargeId);

    let authorization: ProviderOperationResult;
    try {
      authorization = await this.provider.authorize({
        amountMinor: prepared.payment.amountMinor,
        ...(prepared.charge.booking.renter.email
          ? { customerEmail: prepared.charge.booking.renter.email }
          : {}),
        currency: prepared.payment.currency,
        description: `Approved post-return charge ${prepared.charge.id}`,
        idempotencyKey: prepared.operation.idempotencyKey,
        requestReference: prepared.operation.providerRequestReference,
      });
    } catch (error) {
      await this.markPaymentUnknown(prepared.payment.id, prepared.operation.id, error);
      return this.additionalCharge(renterUserId, chargeId);
    }
    if (authorization.kind === 'ACTION_REQUIRED') {
      await this.database.client.$transaction(async (transaction) => {
        await transaction.payment.update({
          data: {
            customerActionUrl: authorization.customerActionUrl ?? null,
            externalPaymentId: authorization.externalPaymentId ?? null,
            providerState: authorization.providerState ?? null,
            reconciliationRequired: true,
            reconcileAfter: new Date(Date.now() + 15_000),
          },
          where: { id: prepared.payment.id },
        });
        await transaction.paymentOperation.update({
          data: { completedAt: new Date(), status: PaymentOperationStatus.SUCCEEDED },
          where: { id: prepared.operation.id },
        });
      });
      return this.additionalCharge(renterUserId, chargeId);
    }
    if (authorization.kind !== 'SUCCEEDED' || !authorization.externalPaymentId) {
      await this.failAdditionalPayment(prepared.payment.id, prepared.operation.id, authorization);
      return this.additionalCharge(renterUserId, chargeId);
    }
    const capture = await this.prepareCapture(
      prepared.payment.id,
      prepared.operation.id,
      authorization,
    );
    let captured: ProviderOperationResult;
    try {
      captured = await this.provider.capture({
        amountMinor: prepared.payment.amountMinor,
        currency: prepared.payment.currency,
        externalPaymentId: authorization.externalPaymentId,
        idempotencyKey: capture.idempotencyKey,
        requestReference: capture.providerRequestReference,
      });
    } catch (error) {
      await this.markPaymentUnknown(prepared.payment.id, capture.id, error);
      return this.additionalCharge(renterUserId, chargeId);
    }
    if (captured.kind === 'SUCCEEDED') {
      await this.database.client.$executeRaw(
        Prisma.sql`SELECT "finalize_additional_charge_payment"(${prepared.payment.id}::uuid, ${capture.id}::uuid, ${captured.providerState ?? 'CAPTURED'}, ${captured.externalOperationId ?? null}, ${request.correlationId ?? null})`,
      );
    } else if (captured.kind === 'DECLINED') {
      await this.failAdditionalPayment(prepared.payment.id, capture.id, captured);
    } else {
      await this.markPaymentUnknown(prepared.payment.id, capture.id, undefined, captured);
    }
    return this.additionalCharge(renterUserId, chargeId);
  }

  async additionalCharge(renterUserId: string, chargeId: string) {
    const charge = await this.database.client.additionalCharge.findFirst({
      include: {
        claim: true,
        lines: true,
        payment: { include: { operations: true, refunds: true } },
      },
      where: { id: chargeId, booking: { renterUserId } },
    });
    if (!charge)
      this.fail(
        ClaimErrorCode.ADDITIONAL_CHARGE_NOT_FOUND,
        'Additional charge not found.',
        HttpStatus.NOT_FOUND,
      );
    return this.serialize({
      ...charge,
      securityDepositAppliedMinor: 0,
      securityDepositStatus: 'DISABLED_PENDING_PROVIDER_DECISION',
    });
  }

  async refundAdditionalCharge(
    adminUserId: string,
    chargeId: string,
    input: RefundAdditionalChargeDto,
    request: RequestMetadata,
  ) {
    if (!this.provider.capabilities.supportsRefund)
      this.invalid('Provider refunds are not enabled.');
    const prepared = await this.database.client.$transaction(async (transaction) => {
      let charge = await transaction.additionalCharge.findUnique({
        include: { payment: true },
        where: { id: chargeId },
      });
      if (!charge?.payment || charge.status !== AdditionalChargeStatus.PAID)
        this.fail(
          ClaimErrorCode.REFUND_INVALID_STATE,
          'Only a paid additional charge may be refunded.',
          HttpStatus.CONFLICT,
        );
      await this.lockCharge(transaction, charge.id);
      charge = await transaction.additionalCharge.findUniqueOrThrow({
        include: { payment: true },
        where: { id: chargeId },
      });
      if (!charge.payment || charge.status !== AdditionalChargeStatus.PAID) {
        this.fail(
          ClaimErrorCode.REFUND_INVALID_STATE,
          'Only a paid additional charge may be refunded.',
          HttpStatus.CONFLICT,
        );
      }
      const payment = charge.payment;
      if (BigInt(input.amountMinor) > charge.collectedAmountMinor - charge.refundedAmountMinor)
        this.invalid('Refund exceeds the remaining collected amount.');
      const idempotencyKey = `additional-charge:${charge.id}:refund:v1`;
      const existing = await transaction.paymentOperation.findUnique({
        include: { refund: true },
        where: { idempotencyKey },
      });
      if (existing) return { charge, operation: existing, refund: existing.refund };
      const operation = await transaction.paymentOperation.create({
        data: {
          amountMinor: BigInt(input.amountMinor),
          currency: charge.currency,
          idempotencyKey,
          paymentId: payment.id,
          providerRequestReference: randomUUID(),
          startedAt: new Date(),
          status: PaymentOperationStatus.PROCESSING,
          type: PaymentOperationType.REFUND,
          attemptCount: 1,
        },
      });
      const refund = await transaction.refund.create({
        data: {
          amountMinor: BigInt(input.amountMinor),
          currency: charge.currency,
          operationId: operation.id,
          paymentId: payment.id,
          reason: input.reason,
          status: RefundStatus.PROCESSING,
        },
      });
      return { charge, operation, refund };
    });
    if (!prepared.refund || !prepared.charge.payment?.externalPaymentId)
      return this.adminClaim(prepared.charge.claimId);
    let result: ProviderOperationResult;
    try {
      result = await this.provider.refund({
        amountMinor: prepared.refund.amountMinor,
        currency: prepared.refund.currency,
        externalPaymentId: prepared.charge.payment.externalPaymentId,
        idempotencyKey: prepared.operation.idempotencyKey,
        reason: input.reason,
        requestReference: prepared.operation.providerRequestReference,
      });
    } catch (error) {
      await this.markRefundUnknown(prepared.refund.id, prepared.operation.id, error);
      return this.adminClaim(prepared.charge.claimId);
    }
    if (result.kind === 'SUCCEEDED') {
      await this.finalizeAdditionalRefund(
        prepared.charge.id,
        prepared.refund.id,
        prepared.operation.id,
        result,
        request,
      );
      await this.database.client.auditLog.create({
        data: {
          action: 'ADDITIONAL_CHARGE_REFUNDED',
          actorUserId: adminUserId,
          correlationId: request.correlationId ?? null,
          ipAddress: request.ipAddress ?? null,
          reason: input.reason,
          targetId: chargeId,
          targetType: 'AdditionalCharge',
        },
      });
    } else {
      await this.markRefundUnknown(prepared.refund.id, prepared.operation.id, undefined, result);
    }
    return this.adminClaim(prepared.charge.claimId);
  }

  async resolveDispute(
    adminUserId: string,
    disputeId: string,
    input: ResolveDisputeDto,
    request: RequestMetadata,
  ) {
    const terminal = [
      DisputeStatus.RESOLVED_FOR_RENTER,
      DisputeStatus.RESOLVED_FOR_OWNER,
      DisputeStatus.PARTIALLY_RESOLVED,
      DisputeStatus.CLOSED,
    ];
    if (!terminal.some((status) => status === input.status))
      this.fail(
        ClaimErrorCode.DISPUTE_INVALID_STATE,
        'Resolution command requires a terminal dispute status.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const dispute = await this.database.client.$transaction(async (transaction) => {
      const current = await transaction.dispute.findUnique({ where: { id: disputeId } });
      if (!current)
        this.fail(ClaimErrorCode.DISPUTE_NOT_FOUND, 'Dispute not found.', HttpStatus.NOT_FOUND);
      if (!this.disputeOpen(current.status))
        this.fail(
          ClaimErrorCode.DISPUTE_INVALID_STATE,
          'Dispute is already resolved.',
          HttpStatus.CONFLICT,
        );
      const resolved = await transaction.dispute.update({
        data: {
          resolvedAt: new Date(),
          resolvedByUserId: adminUserId,
          resolutionReason: input.reason,
          status: input.status,
        },
        where: { id: disputeId },
      });
      const holds = await transaction.earningHold.findMany({
        select: { id: true, ownerEarningId: true },
        where: { disputeId, status: EarningHoldStatus.ACTIVE },
      });
      if (holds.length) {
        await transaction.earningHold.updateMany({
          data: {
            releasedAt: new Date(),
            releasedByUserId: adminUserId,
            resolution: input.reason,
            status: EarningHoldStatus.RELEASED,
          },
          where: { id: { in: holds.map((hold) => hold.id) } },
        });
        for (const earningId of new Set(holds.map((hold) => hold.ownerEarningId))) {
          await transaction.ownerEarning.update({
            data: { status: await this.earningStatusAfterRelease(transaction, earningId) },
            where: { id: earningId },
          });
        }
      }
      await this.audit(
        transaction,
        adminUserId,
        'DISPUTE_RESOLVED',
        disputeId,
        input.reason,
        request,
      );
      await this.analytics(transaction, current.bookingId, 'DISPUTE_RESOLVED', request);
      return resolved;
    });
    return this.serialize(dispute);
  }

  async createManualHold(
    adminUserId: string,
    earningId: string,
    input: CreateEarningHoldDto,
    request: RequestMetadata,
  ) {
    const hold = await this.database.client.$transaction(async (transaction) => {
      const earning = await transaction.ownerEarning.findUnique({ where: { id: earningId } });
      if (!earning) this.notFound();
      const created = await transaction.earningHold.create({
        data: {
          amountMinor: BigInt(input.amountMinor),
          createdByUserId: adminUserId,
          currency: earning.currency,
          mode: input.mode,
          ownerEarningId: earning.id,
          rationale: input.reason,
          reason: input.holdReason,
        },
      });
      await this.audit(
        transaction,
        adminUserId,
        'EARNING_HOLD_CREATED',
        created.id,
        input.reason,
        request,
      );
      await this.event(transaction, earning.bookingId, created.id, 'EARNING_HOLD_CREATED');
      return created;
    });
    return this.serialize(hold);
  }

  async releaseManualHold(
    adminUserId: string,
    holdId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    const hold = await this.database.client.$transaction(async (transaction) => {
      const current = await transaction.earningHold.findUnique({
        include: { ownerEarning: true },
        where: { id: holdId },
      });
      if (!current) this.notFound();
      if (current.status === EarningHoldStatus.RELEASED) return current;
      const released = await transaction.earningHold.update({
        data: {
          releasedAt: new Date(),
          releasedByUserId: adminUserId,
          resolution: reason,
          status: EarningHoldStatus.RELEASED,
        },
        where: { id: holdId },
      });
      const nextStatus = await this.earningStatusAfterRelease(transaction, current.ownerEarningId);
      await transaction.ownerEarning.update({
        data: { status: nextStatus },
        where: { id: current.ownerEarningId },
      });
      await this.audit(transaction, adminUserId, 'EARNING_HOLD_RELEASED', holdId, reason, request);
      await this.event(
        transaction,
        current.ownerEarning.bookingId,
        holdId,
        'EARNING_HOLD_RELEASED',
      );
      return released;
    });
    return this.serialize(hold);
  }

  private async list(where: Prisma.PostReturnClaimWhereInput) {
    const claims = await this.database.client.postReturnClaim.findMany({
      include: claimInclude,
      orderBy: { submittedAt: 'desc' },
      where,
    });
    return this.serialize({
      items: claims.map((claim) => ({ ...claim, severity: this.claimSeverity(claim) })),
    });
  }

  private async findParticipant(
    claimId: string,
    participant: { ownerUserId?: string; renterUserId?: string },
  ) {
    const claim = await this.database.client.postReturnClaim.findFirst({
      include: claimInclude,
      where: { id: claimId, booking: participant },
    });
    if (!claim) this.notFound();
    return this.serialize(claim);
  }

  private calculateClaim(
    category: PostReturnClaimCategory,
    booking: {
      policySnapshot: { policyVersionId: string } | null;
      pricingSnapshot: {
        chargeableDays: number;
        subtotalMinor: number;
        excessKilometerRateMinor: number | null;
        unlimitedMileage: boolean;
      } | null;
      usageSummary: {
        excessDistanceKm: number;
        fuelDeficiencyBasisPoints: number | null;
        socDeficiencyBasisPoints: number | null;
        lateDurationSeconds: number;
      } | null;
    },
    policy: {
      calculationMethod: ClaimCalculationMethod;
      formulaVersion: string;
      lateGraceMinutes: number | null;
    },
  ) {
    const usage = booking.usageSummary!;
    const pricing = booking.pricingSnapshot!;
    if (category === PostReturnClaimCategory.EXCESS_MILEAGE) {
      if (pricing.unlimitedMileage)
        this.formulaNotApplicable('This booking has an immutable unlimited-mileage policy.');
      const rate = BigInt(pricing.excessKilometerRateMinor ?? 0);
      if (usage.excessDistanceKm <= 0 || rate <= 0n)
        this.formulaNotApplicable('No billable excess mileage was measured.');
      return {
        amountMinor: BigInt(usage.excessDistanceKm) * rate,
        inputs: {
          excessDistanceKm: usage.excessDistanceKm,
          rateMinor: Number(rate),
          usageVersion: 'usage-v1',
        } as Prisma.InputJsonValue,
        quantity: usage.excessDistanceKm,
        roundingRule: 'WHOLE_KILOMETERS_FLOOR_FROM_RAW_METERS',
        unit: 'kilometer',
        unitRateMinor: rate,
      };
    }
    if (category === PostReturnClaimCategory.LATE_RETURN) {
      const graceSeconds = (policy.lateGraceMinutes ?? 30) * 60;
      const billableSeconds = Math.max(0, usage.lateDurationSeconds - graceSeconds);
      if (!billableSeconds)
        this.formulaNotApplicable('The measured late return is within the platform grace period.');
      const hours = Math.ceil(billableSeconds / 3600);
      const dailyRate = BigInt(Math.ceil(pricing.subtotalMinor / pricing.chargeableDays));
      const hourlyRate = (dailyRate + 23n) / 24n;
      const cap = BigInt(Math.ceil(hours / 24)) * dailyRate;
      const amount = this.minimum(BigInt(hours) * hourlyRate, cap);
      return {
        amountMinor: amount,
        inputs: {
          billableSeconds,
          dailyRateMinor: Number(dailyRate),
          graceSeconds,
          lateDurationSeconds: usage.lateDurationSeconds,
        } as Prisma.InputJsonValue,
        quantity: hours,
        roundingRule: 'CEIL_TO_HOUR_DAILY_RATE_CAP',
        unit: 'hour',
        unitRateMinor: hourlyRate,
      };
    }
    const deficiency =
      category === PostReturnClaimCategory.FUEL_DEFICIENCY
        ? usage.fuelDeficiencyBasisPoints
        : category === PostReturnClaimCategory.EV_BATTERY_DEFICIENCY
          ? usage.socDeficiencyBasisPoints
          : null;
    if (formulaCategories.has(category)) {
      if (!deficiency) this.formulaNotApplicable('No billable return deficiency was measured.');
      return {
        amountMinor: 0n,
        inputs: {
          measuredDeficiencyBasisPoints: deficiency,
          monetaryValuation: 'ADMIN_REQUIRED',
        } as Prisma.InputJsonValue,
        quantity: deficiency,
        roundingRule: 'ADMIN_PLATFORM_VALUATION_WITH_POLICY_CAP',
        unit: 'basis_point',
        unitRateMinor: 0n,
      };
    }
    return {
      amountMinor: 0n,
      inputs: { evidenceBased: true, monetaryValuation: 'ADMIN_REQUIRED' } as Prisma.InputJsonValue,
      quantity: 1,
      roundingRule: 'ADMIN_PLATFORM_VALUATION_WITH_POLICY_CAP',
      unit: 'claim',
      unitRateMinor: 0n,
    };
  }

  private claimSeverity(claim: {
    category: PostReturnClaimCategory;
    booking: { rentalIncidents: readonly { severity: string; status: string }[] };
  }) {
    if (
      claim.booking.rentalIncidents.some(
        (incident) =>
          incident.severity === 'CRITICAL' && ['OPEN', 'ACKNOWLEDGED'].includes(incident.status),
      )
    )
      return 'CRITICAL';
    if (claim.category === PostReturnClaimCategory.DAMAGE) return 'HIGH';
    if (mediumSeverityCategories.has(claim.category)) return 'MEDIUM';
    return 'LOW';
  }

  private claimSeverityWhere(severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') {
    if (!severity) return {};
    if (severity === 'CRITICAL')
      return {
        booking: {
          rentalIncidents: {
            some: {
              severity: 'CRITICAL' as const,
              status: { in: ['OPEN', 'ACKNOWLEDGED'] as const },
            },
          },
        },
      } satisfies Prisma.PostReturnClaimWhereInput;
    const categories =
      severity === 'HIGH'
        ? [PostReturnClaimCategory.DAMAGE]
        : severity === 'MEDIUM'
          ? [
              PostReturnClaimCategory.FUEL_DEFICIENCY,
              PostReturnClaimCategory.EV_BATTERY_DEFICIENCY,
              PostReturnClaimCategory.LATE_RETURN,
              PostReturnClaimCategory.OTHER,
            ]
          : [PostReturnClaimCategory.EXCESS_MILEAGE, PostReturnClaimCategory.CLEANING];
    return { category: { in: categories } } satisfies Prisma.PostReturnClaimWhereInput;
  }

  private async resolveApprovedAmount(
    transaction: Prisma.TransactionClient,
    claim: Prisma.PostReturnClaimGetPayload<{
      include: {
        booking: {
          include: {
            ownerEarning: true;
            policySnapshot: true;
            pricingSnapshot: true;
            usageSummary: true;
          };
        };
        calculations: { include: { policy: true } };
        disputes: true;
        evidence: true;
      };
    }>,
    latest: (typeof claim.calculations)[number],
    input: AdminAdjudicateClaimDto,
  ) {
    if (input.outcome === ClaimAdjudicationOutcome.REJECTED)
      return {
        amount: 0n,
        calculationId: latest.id,
        formulaVersion: latest.formulaVersion,
        quantity: latest.quantity,
        unit: latest.unit,
        unitRateMinor: latest.unitRateMinor,
      };
    if (
      input.outcome !== ClaimAdjudicationOutcome.APPROVED &&
      input.outcome !== ClaimAdjudicationOutcome.PARTIALLY_APPROVED
    )
      this.invalid('Unsupported financial adjudication outcome.');
    const serverFormula =
      latest.method === ClaimCalculationMethod.EXCESS_MILEAGE_V1 ||
      latest.method === ClaimCalculationMethod.LATE_RETURN_V1;
    let amount = serverFormula ? latest.amountMinor : BigInt(input.approvedAmountMinor ?? -1);
    if (serverFormula && input.outcome === ClaimAdjudicationOutcome.PARTIALLY_APPROVED)
      amount = BigInt(input.approvedAmountMinor ?? -1);
    if (
      amount < 0n ||
      amount > latest.policy.maximumAmountMinor ||
      (serverFormula && amount > latest.amountMinor)
    ) {
      this.fail(
        ClaimErrorCode.CLAIM_AMOUNT_EXCEEDS_POLICY,
        'Approved amount exceeds the immutable formula or platform policy maximum.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      input.outcome === ClaimAdjudicationOutcome.APPROVED &&
      serverFormula &&
      amount !== latest.amountMinor
    )
      this.invalid('Full approval must use the server-calculated amount.');
    if (!serverFormula) {
      const version = latest.version + 1;
      const calculated = await transaction.claimCalculation.create({
        data: {
          amountMinor: amount,
          bookingPolicyRef: latest.bookingPolicyRef,
          claimId: claim.id,
          claimPolicyId: latest.claimPolicyId,
          currency: latest.currency,
          formulaVersion: latest.formulaVersion,
          inputs: {
            ...((latest.inputs as Record<string, unknown>) ?? {}),
            adminPlatformValuationMinor: Number(amount),
          } as Prisma.InputJsonValue,
          method: ClaimCalculationMethod.ADMIN_PLATFORM_VALUATION_V1,
          quantity: latest.quantity,
          roundingRule: 'ADMIN_PLATFORM_VALUATION_WITH_POLICY_CAP',
          unit: latest.unit,
          unitRateMinor: latest.quantity > 0 ? amount / BigInt(latest.quantity) : amount,
          version,
        },
      });
      return {
        amount,
        calculationId: calculated.id,
        formulaVersion: calculated.formulaVersion,
        quantity: calculated.quantity,
        unit: calculated.unit,
        unitRateMinor: calculated.unitRateMinor,
      };
    }
    return {
      amount,
      calculationId: latest.id,
      formulaVersion: latest.formulaVersion,
      quantity: latest.quantity,
      unit: latest.unit,
      unitRateMinor: latest.unitRateMinor,
    };
  }

  private async addEvidence(
    userId: string,
    claimId: string,
    input: AddClaimEvidenceDto,
    role: EvidenceParticipantRole,
    participant: { ownerUserId?: string; renterUserId?: string },
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const claim = await transaction.postReturnClaim.findFirst({
        where: { id: claimId, booking: participant },
      });
      if (!claim) this.notFound();
      if (
        claim.status === PostReturnClaimStatus.WITHDRAWN ||
        claim.status === PostReturnClaimStatus.RESOLVED
      )
        this.invalid('Evidence cannot be added to a closed claim.');
      await this.validateEvidence(transaction, userId, input.evidence);
      await transaction.postReturnClaimEvidence.createMany({
        data: input.evidence.map((item) => ({
          claimId,
          evidenceType: item.evidenceType ?? ClaimEvidenceType.PHOTO,
          fileAssetId: item.fileAssetId,
          note: item.note ?? null,
          participantRole: role,
          submittedByUserId: userId,
        })),
      });
    });
  }

  private async validateEvidence(
    transaction: Prisma.TransactionClient,
    userId: string,
    evidence: readonly ClaimEvidenceInputDto[],
  ) {
    const ids = evidence.map((item) => item.fileAssetId);
    if (new Set(ids).size !== ids.length) this.invalid('Evidence files must be unique.');
    if (!ids.length) return;
    const files = await transaction.fileAsset.findMany({ where: { id: { in: ids } } });
    if (
      files.length !== ids.length ||
      files.some(
        (file) =>
          file.uploadedById !== userId ||
          file.status !== FileAssetStatus.READY ||
          file.classification === FileClassification.PUBLIC ||
          file.size > 20_000_000n ||
          !(file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf'),
      )
    ) {
      this.invalid(
        'Evidence must be a ready private image or PDF uploaded by the submitting participant.',
      );
    }
  }

  private async prepareCapture(
    paymentId: string,
    authorizationOperationId: string,
    result: ProviderOperationResult,
  ) {
    return this.database.client.$transaction(async (transaction) => {
      const payment = await transaction.payment.findUniqueOrThrow({
        include: { operations: true },
        where: { id: paymentId },
      });
      await transaction.paymentOperation.update({
        data: { completedAt: new Date(), status: PaymentOperationStatus.SUCCEEDED },
        where: { id: authorizationOperationId },
      });
      await transaction.payment.update({
        data: {
          authorizedAmountMinor: payment.amountMinor,
          authorizedAt: new Date(),
          externalPaymentId: result.externalPaymentId ?? null,
          providerState: result.providerState ?? null,
          status: PaymentStatus.CAPTURING,
        },
        where: { id: paymentId },
      });
      const attempt =
        payment.operations.filter((operation) => operation.type === PaymentOperationType.CAPTURE)
          .length + 1;
      return transaction.paymentOperation.create({
        data: {
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          idempotencyKey: `additional-charge:${payment.additionalChargeId}:capture:v${attempt}`,
          paymentId,
          providerRequestReference: randomUUID(),
          status: PaymentOperationStatus.PROCESSING,
          startedAt: new Date(),
          attemptCount: 1,
          type: PaymentOperationType.CAPTURE,
        },
      });
    });
  }

  private async failAdditionalPayment(
    paymentId: string,
    operationId: string,
    result: ProviderOperationResult,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const payment = await transaction.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await transaction.paymentOperation.update({
        data: {
          completedAt: new Date(),
          failureCategory: PaymentFailureCategory.DEFINITIVE,
          failureCode: result.failureCode ?? null,
          failureMessage: result.failureMessage ?? null,
          status: PaymentOperationStatus.FAILED,
        },
        where: { id: operationId },
      });
      await transaction.payment.update({
        data: { providerState: result.providerState ?? null, status: PaymentStatus.FAILED },
        where: { id: paymentId },
      });
      if (payment.additionalChargeId)
        await transaction.additionalCharge.update({
          data: { status: AdditionalChargeStatus.PAYMENT_FAILED },
          where: { id: payment.additionalChargeId },
        });
    });
  }

  private async markPaymentUnknown(
    paymentId: string,
    operationId: string,
    error?: unknown,
    result?: ProviderOperationResult,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.paymentOperation.update({
        data: {
          failureCategory: PaymentFailureCategory.UNKNOWN,
          failureMessage:
            error instanceof Error ? error.message.slice(0, 500) : (result?.failureMessage ?? null),
          nextAttemptAt: new Date(Date.now() + 15_000),
          status: PaymentOperationStatus.UNKNOWN,
        },
        where: { id: operationId },
      });
      await transaction.payment.update({
        data: {
          externalPaymentId: result?.externalPaymentId ?? null,
          providerState: result?.providerState ?? 'UNKNOWN',
          reconcileAfter: new Date(Date.now() + 15_000),
          reconciliationRequired: true,
        },
        where: { id: paymentId },
      });
    });
  }

  private async finalizeAdditionalRefund(
    chargeId: string,
    refundId: string,
    operationId: string,
    result: ProviderOperationResult,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockCharge(transaction, chargeId);
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "refunds" WHERE "id" = ${refundId}::uuid FOR UPDATE`,
      );
      const charge = await transaction.additionalCharge.findUniqueOrThrow({
        include: { ownerEarning: true, payment: true },
        where: { id: chargeId },
      });
      if (!charge.payment) this.invalid('Charge payment is missing.');
      const refund = await transaction.refund.findUniqueOrThrow({ where: { id: refundId } });
      if (refund.status === RefundStatus.COMPLETED) return;
      const ownerReduction =
        (refund.amountMinor * charge.ownerCompensationMinor) / charge.approvedAmountMinor;
      const platformReduction = refund.amountMinor - ownerReduction;
      const accounts = await transaction.financialAccount.findMany({
        where: { active: true, currency: charge.currency },
      });
      const account = (type: FinancialAccountType) => {
        const found = accounts.find((item) => item.type === type);
        if (!found) throw new Error(`Financial account ${type} is missing.`);
        return found.id;
      };
      await transaction.paymentOperation.update({
        data: {
          completedAt: new Date(),
          externalOperationId: result.externalOperationId ?? null,
          status: PaymentOperationStatus.SUCCEEDED,
        },
        where: { id: operationId },
      });
      await transaction.refund.update({
        data: {
          completedAt: new Date(),
          externalRefundId: result.externalOperationId ?? null,
          status: RefundStatus.COMPLETED,
        },
        where: { id: refundId },
      });
      const refundedTotal = charge.refundedAmountMinor + refund.amountMinor;
      await transaction.payment.update({
        data: {
          refundedAmountMinor: { increment: refund.amountMinor },
          status:
            refundedTotal === charge.collectedAmountMinor
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
        },
        where: { id: charge.payment.id },
      });
      await transaction.additionalCharge.update({
        data: {
          refundedAmountMinor: refundedTotal,
          status:
            refundedTotal === charge.collectedAmountMinor
              ? AdditionalChargeStatus.REFUNDED
              : AdditionalChargeStatus.PARTIALLY_REFUNDED,
        },
        where: { id: charge.id },
      });
      await transaction.ownerEarning.update({
        data: {
          adjustmentAmountMinor: { decrement: ownerReduction },
          availableAt: new Date(Date.now() + 24 * 3_600_000),
          lastFinancialResolutionAt: new Date(),
          status: OwnerEarningStatus.PENDING,
        },
        where: { id: charge.ownerEarningId },
      });
      const entries = [
        ownerReduction > 0
          ? {
              accountId: account(FinancialAccountType.OWNER_PAYABLE),
              amountMinor: ownerReduction,
              currency: charge.currency,
              memo: 'Reverse owner additional compensation',
            }
          : null,
        platformReduction > 0
          ? {
              accountId: account(FinancialAccountType.PLATFORM_COMMISSION_REVENUE),
              amountMinor: platformReduction,
              currency: charge.currency,
              memo: 'Reverse configured platform share',
            }
          : null,
        {
          accountId: account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
          amountMinor: -refund.amountMinor,
          currency: charge.currency,
          memo: 'Provider refund',
        },
      ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: charge.currency,
          description: 'Additional charge refund adjustment',
          entries: { create: entries },
          sourceId: refund.id,
          sourceType: 'ADDITIONAL_CHARGE_REFUND',
          type: LedgerTransactionType.REFUND,
        },
      });
      await this.event(transaction, charge.bookingId, charge.id, 'ADDITIONAL_CHARGE_REFUNDED');
    });
  }

  private async markRefundUnknown(
    refundId: string,
    operationId: string,
    error?: unknown,
    result?: ProviderOperationResult,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.paymentOperation.update({
        data: {
          failureCategory: PaymentFailureCategory.UNKNOWN,
          failureMessage:
            error instanceof Error ? error.message.slice(0, 500) : (result?.failureMessage ?? null),
          nextAttemptAt: new Date(Date.now() + 15_000),
          status: PaymentOperationStatus.UNKNOWN,
        },
        where: { id: operationId },
      });
      await transaction.refund.update({
        data: { status: RefundStatus.FAILED },
        where: { id: refundId },
      });
    });
  }

  private async releaseClaimHolds(
    transaction: Prisma.TransactionClient,
    claimId: string,
    resolution: string,
  ) {
    await transaction.earningHold.updateMany({
      data: { releasedAt: new Date(), resolution, status: EarningHoldStatus.RELEASED },
      where: { claimId, status: EarningHoldStatus.ACTIVE },
    });
  }

  private async earningStatusAfterRelease(
    transaction: Prisma.TransactionClient,
    earningId: string,
  ) {
    const active = await transaction.earningHold.count({
      where: { ownerEarningId: earningId, status: EarningHoldStatus.ACTIVE },
    });
    return active ? OwnerEarningStatus.HELD : OwnerEarningStatus.PENDING;
  }

  private async lockBooking(transaction: Prisma.TransactionClient, bookingId: string) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId}::uuid FOR UPDATE`,
    );
  }

  private async lockClaim(transaction: Prisma.TransactionClient, claimId: string) {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        bookingId: string;
        status: PostReturnClaimStatus;
        responseDeadlineAt: Date | null;
      }>
    >(
      Prisma.sql`SELECT "id", "booking_id" AS "bookingId", "status", "response_deadline_at" AS "responseDeadlineAt" FROM "post_return_claims" WHERE "id" = ${claimId}::uuid FOR UPDATE`,
    );
    if (!rows[0]) this.notFound();
    return rows[0];
  }

  private async lockCharge(transaction: Prisma.TransactionClient, chargeId: string) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "additional_charges" WHERE "id" = ${chargeId}::uuid FOR UPDATE`,
    );
  }

  private async event(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    aggregateId: string,
    eventType: string,
  ) {
    await transaction.outboxEvent.create({
      data: {
        aggregateId,
        aggregateType: eventType.startsWith('EARNING')
          ? 'OWNER_EARNING'
          : eventType.startsWith('ADDITIONAL')
            ? 'ADDITIONAL_CHARGE'
            : 'POST_RETURN_CLAIM',
        eventType,
        payload: { aggregateId, bookingId },
      },
    });
  }

  private async analytics(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    eventType: string,
    request: RequestMetadata,
  ) {
    await transaction.analyticsEvent.create({
      data: { bookingId, correlationId: request.correlationId ?? null, eventType, metadata: {} },
    });
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    targetId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    await transaction.auditLog.create({
      data: {
        action,
        actorUserId,
        correlationId: request.correlationId ?? null,
        ipAddress: request.ipAddress ?? null,
        reason,
        targetId,
        targetType: 'PostReturnClaim',
      },
    });
  }

  private lineCategory(category: PostReturnClaimCategory): AdditionalChargeLineCategory {
    if (category === PostReturnClaimCategory.EV_BATTERY_DEFICIENCY)
      return AdditionalChargeLineCategory.EV_DEFICIENCY;
    if (category === PostReturnClaimCategory.OTHER)
      return AdditionalChargeLineCategory.ADMIN_ADJUSTMENT;
    return category as unknown as AdditionalChargeLineCategory;
  }

  private disputeOpen(status: DisputeStatus) {
    return (
      status === DisputeStatus.OPEN ||
      status === DisputeStatus.EVIDENCE_COLLECTION ||
      status === DisputeStatus.UNDER_REVIEW
    );
  }

  private bookingIdentity(reference: string): Prisma.BookingWhereInput {
    return /^[0-9a-f-]{36}$/i.test(reference)
      ? { OR: [{ id: reference }, { publicReference: reference }] }
      : { publicReference: reference };
  }

  private minimum(left: bigint, right: bigint) {
    return left < right ? left : right;
  }

  private formulaNotApplicable(message: string): never {
    return this.fail(
      ClaimErrorCode.CLAIM_FORMULA_NOT_APPLICABLE,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private invalid(message: string): never {
    return this.fail(ClaimErrorCode.CLAIM_INVALID_STATE, message, HttpStatus.CONFLICT);
  }

  private notFound(): never {
    return this.fail(ClaimErrorCode.CLAIM_NOT_FOUND, 'Claim not found.', HttpStatus.NOT_FOUND);
  }

  private fail(code: string, message: string, status: HttpStatus): never {
    throw new ApplicationException(code, message, status);
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? Number(item) : item,
      ),
    ) as T;
  }
}
