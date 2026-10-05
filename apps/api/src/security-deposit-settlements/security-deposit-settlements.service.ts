import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AdditionalChargeStatus,
  ClaimAdjudicationOutcome,
  PostReturnClaimStatus,
  PaymentEvidenceAttribution,
  PaymentOperationEvidenceSource,
  Prisma,
  SecurityDepositSettlementDecisionSource,
  SecurityDepositSettlementStatus,
  SecurityDepositStatus,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import {
  allocateSecurityDepositSettlement,
  assertSettlementDecisionEligible,
  assertSecurityDepositSettlementTransition,
  financiallyTerminalSettlementStatuses,
} from './security-deposit-settlement.domain';
import type { PaymentOperationAdminEvidenceDto } from './security-deposit-settlement.dto';

const settlementInclude = {
  approvedBy: { select: { id: true } },
  items: {
    include: {
      additionalCharge: { select: { status: true } },
      adjudication: { select: { outcome: true, reason: true, version: true } },
      claim: { select: { category: true, description: true, status: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  legs: {
    include: {
      operation: {
        include: { evidence: { orderBy: { createdAt: 'asc' as const } } },
      },
    },
    orderBy: [{ sequence: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.SecurityDepositSettlementInclude;

@Injectable()
export class SecurityDepositSettlementsService {
  constructor(private readonly database: DatabaseService) {}

  async renterProjection(userId: string, reference: string) {
    const booking = await this.bookingForParticipant(reference, { renterUserId: userId });
    return this.participantProjection(booking.id, 'RENTER');
  }

  async ownerProjection(userId: string, reference: string) {
    const booking = await this.bookingForParticipant(reference, { ownerUserId: userId });
    return this.participantProjection(booking.id, 'OWNER');
  }

  async adminProjection(reference: string) {
    const booking = await this.database.client.booking.findUnique({
      select: { id: true, publicReference: true },
      where: { publicReference: reference },
    });
    if (!booking) this.notFound();
    const settlements = await this.database.client.securityDepositSettlement.findMany({
      include: settlementInclude,
      orderBy: { version: 'desc' },
      where: { bookingId: booking.id },
    });
    return {
      bookingReference: booking.publicReference,
      executionAvailable: false,
      payoutBlocked: settlements.some(
        (item) => !financiallyTerminalSettlementStatuses.has(item.status),
      ),
      settlements: settlements.map((item) => this.serialize(item, true)),
    };
  }

  async createReview(
    adminUserId: string,
    reference: string,
    reason: string,
    request: RequestMetadata,
  ) {
    const settlementId = await this.database.client.$transaction(
      async (transaction) => {
        const booking = await transaction.booking.findUnique({
          include: {
            postReturnClaims: {
              include: {
                additionalCharge: { include: { lines: true } },
                adjudications: { orderBy: { version: 'desc' }, take: 1 },
                calculations: {
                  include: { policy: true },
                  orderBy: { version: 'desc' },
                  take: 1,
                },
                disputes: true,
              },
              orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
            },
            securityDeposit: true,
            securityDepositSettlements: { orderBy: { version: 'desc' }, take: 1 },
          },
          where: { publicReference: reference },
        });
        if (!booking?.securityDeposit) this.notFound();
        const authorization = booking.securityDeposit;
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${booking.id}::uuid FOR UPDATE`,
        );
        const now = new Date();
        if (
          authorization.status !== SecurityDepositStatus.AUTHORIZED &&
          authorization.status !== SecurityDepositStatus.CLAIM_HELD
        )
          this.conflict('The Security Deposit is not in an authorized settlement state.');
        try {
          assertSettlementDecisionEligible({
            claimDeadlineAt: booking.claimDeadlineAt,
            claims: booking.postReturnClaims,
            now,
          });
        } catch (error) {
          this.conflict(error instanceof Error ? error.message : 'Settlement review is blocked.');
        }
        const current = booking.securityDepositSettlements[0];
        if (current && !financiallyTerminalSettlementStatuses.has(current.status))
          return current.id;

        const eligible = booking.postReturnClaims.flatMap((claim) => {
          const charge = claim.additionalCharge;
          const adjudication = claim.adjudications[0];
          const calculation = claim.calculations[0];
          if (
            claim.status !== PostReturnClaimStatus.PAYMENT_PENDING ||
            !charge ||
            charge.status !== AdditionalChargeStatus.PAYMENT_PENDING ||
            !adjudication ||
            !calculation?.policy.depositEligible ||
            (adjudication.outcome !== ClaimAdjudicationOutcome.APPROVED &&
              adjudication.outcome !== ClaimAdjudicationOutcome.PARTIALLY_APPROVED) ||
            charge.approvedAmountMinor <= 0n
          )
            return [];
          const line = charge.lines[0];
          if (!line) this.conflict('An approved charge is missing its immutable line snapshot.');
          if (
            charge.currency !== authorization.currency ||
            adjudication.currency !== charge.currency ||
            calculation.currency !== charge.currency
          )
            this.conflict('Claim and Security Deposit currencies do not match.');
          return [{ adjudication, calculation, charge, claim, line }];
        });
        const allocation = allocateSecurityDepositSettlement(
          authorization.authorizedAmountMinor,
          authorization.usedAmountMinor,
          eligible.map(({ charge }) => ({
            approvedAmountMinor: charge.approvedAmountMinor,
            id: charge.id,
          })),
        );
        const byCharge = new Map(allocation.allocations.map((item) => [item.id, item]));
        const settlement = await transaction.securityDepositSettlement.create({
          data: {
            approvedDeductionMinor: allocation.approvedDeductionMinor,
            authorizedAmountMinorSnapshot: allocation.remainingAuthorizedAmountMinor,
            bookingId: booking.id,
            currency: authorization.currency,
            decisionReason: reason,
            decisionSource: SecurityDepositSettlementDecisionSource.SYSTEM,
            items: {
              create: eligible.map(({ adjudication, calculation, charge, claim, line }) => {
                const itemAllocation = byCharge.get(charge.id)!;
                return {
                  additionalChargeId: charge.id,
                  adjudicationVersion: adjudication.version,
                  approvedAmountMinor: charge.approvedAmountMinor,
                  category: line.category,
                  claimAdjudicationId: adjudication.id,
                  claimCalculationId: calculation.id,
                  claimId: claim.id,
                  calculationVersion: calculation.version,
                  currency: charge.currency,
                  depositAppliedMinor: itemAllocation.depositAppliedMinor,
                  descriptionSnapshot: claim.description,
                  excessAmountMinor: itemAllocation.excessAmountMinor,
                  ownerCompensationMinor: charge.ownerCompensationMinor,
                  platformShareMinor: charge.platformShareMinor,
                  policyVersion: calculation.policy.version,
                };
              }),
            },
            releaseAmountMinor: allocation.releaseAmountMinor,
            securityDepositAuthorizationId: authorization.id,
            status: SecurityDepositSettlementStatus.SETTLEMENT_REVIEW,
            version: (current?.version ?? 0) + 1,
          },
        });
        await this.event(
          transaction,
          settlement.id,
          booking.id,
          'SECURITY_DEPOSIT_SETTLEMENT_REVIEW_STARTED',
        );
        await this.audit(
          transaction,
          adminUserId,
          settlement.id,
          'SECURITY_DEPOSIT_SETTLEMENT_REVIEW_STARTED',
          reason,
          request,
          null,
          { status: settlement.status, version: settlement.version },
        );
        return settlement.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.settlementById(settlementId);
  }

  async approve(
    adminUserId: string,
    settlementId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    return this.transitionByAdmin(adminUserId, settlementId, reason, request, 'APPROVE');
  }

  async manualReview(
    adminUserId: string,
    settlementId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    return this.transitionByAdmin(adminUserId, settlementId, reason, request, 'MANUAL_REVIEW');
  }

  async addAdminEvidence(
    adminUserId: string,
    operationId: string,
    input: PaymentOperationAdminEvidenceDto,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const operation = await transaction.paymentOperation.findUnique({
        include: { securityDepositSettlementLeg: true },
        where: { id: operationId },
      });
      if (!operation?.securityDepositSettlementLeg) this.notFound();
      const exactReference =
        input.reference === operation.providerRequestReference ||
        (Boolean(operation.externalOperationId) &&
          input.providerOperationId === operation.externalOperationId);
      const key = createHash('sha256')
        .update(
          [
            'admin',
            operation.id,
            input.reference,
            input.providerOperationId ?? '',
            input.providerStatus,
          ].join('|'),
        )
        .digest('hex');
      await transaction.paymentOperationEvidence.upsert({
        create: {
          attribution: exactReference
            ? PaymentEvidenceAttribution.EXACT
            : PaymentEvidenceAttribution.INSUFFICIENT,
          createdByUserId: adminUserId,
          evidenceKey: key,
          paymentId: operation.paymentId,
          paymentOperationId: exactReference ? operation.id : null,
          ...(input.providerOperationId ? { providerOperationId: input.providerOperationId } : {}),
          providerStatus: input.providerStatus,
          reason: input.reason,
          requestReference: input.reference,
          source: PaymentOperationEvidenceSource.ADMIN_EVIDENCE,
        },
        update: {},
        where: { paymentId_evidenceKey: { evidenceKey: key, paymentId: operation.paymentId } },
      });
      await transaction.paymentOperation.update({
        data: {
          nextReconcileAt: new Date(),
          reconciliationReason: 'Admin evidence added; reconciliation requested.',
        },
        where: { id: operation.id },
      });
      await this.audit(
        transaction,
        adminUserId,
        operation.id,
        'PAYMENT_OPERATION_ADMIN_EVIDENCE_ADDED',
        input.reason,
        request,
        { status: operation.status },
        { attribution: exactReference ? 'EXACT' : 'INSUFFICIENT', status: operation.status },
        'PaymentOperation',
      );
    });
    return { accepted: true, operationId };
  }

  async requestOperationReconciliation(
    adminUserId: string,
    operationId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const operation = await transaction.paymentOperation.findUnique({
        include: { securityDepositSettlementLeg: true },
        where: { id: operationId },
      });
      if (!operation?.securityDepositSettlementLeg) this.notFound();
      await transaction.paymentOperation.update({
        data: {
          manualReviewRequiredAt: null,
          nextReconcileAt: new Date(),
          reconciliationReason: reason,
        },
        where: { id: operation.id },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: operation.id,
          aggregateType: 'PAYMENT_OPERATION',
          eventType: 'PAYMENT_OPERATION_RECONCILIATION_REQUIRED',
          payload: { settlementId: operation.securityDepositSettlementLeg.settlementId },
        },
      });
      await this.audit(
        transaction,
        adminUserId,
        operation.id,
        'PAYMENT_OPERATION_RECONCILIATION_REQUIRED',
        reason,
        request,
        { nextReconcileAt: operation.nextReconcileAt?.toISOString() ?? null },
        { nextReconcileAt: 'NOW' },
        'PaymentOperation',
      );
    });
    return { accepted: true, operationId };
  }

  private async transitionByAdmin(
    adminUserId: string,
    settlementId: string,
    reason: string,
    request: RequestMetadata,
    action: 'APPROVE' | 'MANUAL_REVIEW',
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "security_deposit_settlements" WHERE "id" = ${settlementId}::uuid FOR UPDATE`,
      );
      const settlement = await transaction.securityDepositSettlement.findUnique({
        include: {
          booking: {
            include: { disputes: true, postReturnClaims: { include: { disputes: true } } },
          },
        },
        where: { id: settlementId },
      });
      if (!settlement) this.notFound();
      const target =
        action === 'APPROVE'
          ? SecurityDepositSettlementStatus.APPROVED
          : SecurityDepositSettlementStatus.MANUAL_REVIEW;
      try {
        assertSecurityDepositSettlementTransition(settlement.status, target);
      } catch (error) {
        this.conflict(error instanceof Error ? error.message : 'Invalid settlement transition.');
      }
      if (action === 'APPROVE') {
        try {
          assertSettlementDecisionEligible({
            bookingDisputes: settlement.booking.disputes,
            claimDeadlineAt: settlement.booking.claimDeadlineAt,
            claims: settlement.booking.postReturnClaims,
            now: new Date(),
          });
        } catch (error) {
          this.conflict(error instanceof Error ? error.message : 'Settlement approval is blocked.');
        }
      }
      const now = new Date();
      await transaction.securityDepositSettlement.update({
        data:
          action === 'APPROVE'
            ? {
                approvedAt: now,
                approvedByUserId: adminUserId,
                decisionReason: reason,
                decisionSource: SecurityDepositSettlementDecisionSource.ADMIN,
                status: target,
              }
            : { manualReviewReason: reason, status: target },
        where: { id: settlementId },
      });
      const eventType =
        action === 'APPROVE'
          ? 'SECURITY_DEPOSIT_SETTLEMENT_APPROVED'
          : 'SECURITY_DEPOSIT_MANUAL_REVIEW_REQUIRED';
      await this.event(transaction, settlement.id, settlement.bookingId, eventType);
      await this.audit(
        transaction,
        adminUserId,
        settlement.id,
        eventType,
        reason,
        request,
        { status: settlement.status },
        { status: target },
      );
    });
    return this.settlementById(settlementId);
  }

  private async bookingForParticipant(
    reference: string,
    participant: { renterUserId: string } | { ownerUserId: string },
  ) {
    const booking = await this.database.client.booking.findFirst({
      select: { id: true },
      where: { publicReference: reference, ...participant },
    });
    if (!booking) this.notFound();
    return booking;
  }

  private async participantProjection(bookingId: string, role: 'RENTER' | 'OWNER') {
    const authorization = await this.database.client.securityDepositAuthorization.findUnique({
      include: {
        settlements: { include: settlementInclude, orderBy: { version: 'desc' } },
      },
      where: { bookingId },
    });
    if (!authorization) return null;
    const current = authorization.settlements[0];
    return {
      approvedDeductionMinor: current ? Number(current.approvedDeductionMinor) : 0,
      authorizedAmountMinor: Number(authorization.authorizedAmountMinor),
      currency: authorization.currency,
      executionAvailable: false,
      executionPending: current?.status === SecurityDepositSettlementStatus.APPROVED,
      financiallyOpen: current ? !financiallyTerminalSettlementStatuses.has(current.status) : false,
      history: authorization.settlements.map((item) => this.serialize(item, false)),
      items:
        current?.items.map((item) => ({
          approvedAmountMinor: Number(item.approvedAmountMinor),
          category: item.category,
          depositAppliedMinor: Number(item.depositAppliedMinor),
          description: item.descriptionSnapshot,
          excessAmountMinor: Number(item.excessAmountMinor),
        })) ?? [],
      payoutBlocked:
        role === 'OWNER' &&
        Boolean(current && !financiallyTerminalSettlementStatuses.has(current.status)),
      releaseAmountMinor: current
        ? Number(current.releaseAmountMinor)
        : Number(authorization.authorizedAmountMinor),
      status: current?.status ?? authorization.status,
    };
  }

  private async settlementById(id: string) {
    const settlement = await this.database.client.securityDepositSettlement.findUnique({
      include: settlementInclude,
      where: { id },
    });
    if (!settlement) this.notFound();
    return this.serialize(settlement, true);
  }

  private serialize(
    settlement: Prisma.SecurityDepositSettlementGetPayload<{ include: typeof settlementInclude }>,
    admin: boolean,
  ) {
    return {
      approvedAt: settlement.approvedAt?.toISOString() ?? null,
      approvedDeductionMinor: Number(settlement.approvedDeductionMinor),
      authorizedAmountMinorSnapshot: Number(settlement.authorizedAmountMinorSnapshot),
      completedAt: settlement.completedAt?.toISOString() ?? null,
      createdAt: settlement.createdAt.toISOString(),
      currency: settlement.currency,
      decisionReason: settlement.decisionReason,
      executionAvailable: false,
      id: settlement.id,
      items: settlement.items.map((item) => ({
        additionalChargeId: admin ? item.additionalChargeId : undefined,
        adjudicationVersion: item.adjudicationVersion,
        approvedAmountMinor: Number(item.approvedAmountMinor),
        category: item.category,
        claimId: admin ? item.claimId : undefined,
        depositAppliedMinor: Number(item.depositAppliedMinor),
        description: item.descriptionSnapshot,
        excessAmountMinor: Number(item.excessAmountMinor),
      })),
      legs: admin
        ? settlement.legs.map((leg) => ({
            amountMinor: Number(leg.expectedAmountMinor),
            operation: {
              externalOperationId: leg.operation.externalOperationId,
              id: leg.operation.id,
              lastReconciledAt: leg.operation.lastReconciledAt?.toISOString() ?? null,
              manualReviewRequired: Boolean(leg.operation.manualReviewRequiredAt),
              nextReconcileAt: leg.operation.nextReconcileAt?.toISOString() ?? null,
              providerRequestReference: leg.operation.providerRequestReference,
              reconciliationReason: leg.operation.reconciliationReason,
              status: leg.operation.status,
              type: leg.operation.type,
              evidence: leg.operation.evidence.map((evidence) => ({
                amountMinor: evidence.amountMinor === null ? null : Number(evidence.amountMinor),
                attribution: evidence.attribution,
                currency: evidence.currency,
                providerOperationId: evidence.providerOperationId,
                providerPaymentId: evidence.providerPaymentId,
                providerStatus: evidence.providerStatus,
                receivedAt: evidence.receivedAt.toISOString(),
                reason: evidence.reason,
                requestReference: evidence.requestReference,
                source: evidence.source,
              })),
            },
            role: leg.role,
            sequence: leg.sequence,
          }))
        : undefined,
      manualReviewReason: settlement.manualReviewReason,
      releaseAmountMinor: Number(settlement.releaseAmountMinor),
      status: settlement.status,
      version: settlement.version,
    };
  }

  private async event(
    transaction: Prisma.TransactionClient,
    settlementId: string,
    bookingId: string,
    eventType: string,
  ) {
    await transaction.outboxEvent.create({
      data: {
        aggregateId: settlementId,
        aggregateType: 'SECURITY_DEPOSIT_SETTLEMENT',
        eventType,
        payload: { bookingId, settlementId },
      },
    });
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    settlementId: string,
    action: string,
    reason: string,
    request: RequestMetadata,
    previousState: Prisma.InputJsonValue | null,
    newState: Prisma.InputJsonValue,
    entityType = 'SecurityDepositSettlement',
  ) {
    const actor = await transaction.adminUser.findUniqueOrThrow({
      select: { id: true, role: true },
      where: { credentialUserId: actorUserId },
    });
    await transaction.adminAuditLog.create({
      data: {
        action,
        actorAdminId: actor.id,
        actorRole: actor.role,
        entityId: settlementId,
        entityType,
        newState,
        reason,
        ...(previousState ? { previousState } : {}),
        ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
        ...(request.correlationId ? { requestCorrelationId: request.correlationId } : {}),
        ...(request.userAgent ? { userAgent: request.userAgent.slice(0, 500) } : {}),
      },
    });
  }

  private conflict(message: string): never {
    throw new ApplicationException(
      'SECURITY_DEPOSIT_SETTLEMENT_CONFLICT',
      message,
      HttpStatus.CONFLICT,
    );
  }

  private notFound(): never {
    throw new ApplicationException(
      'SECURITY_DEPOSIT_SETTLEMENT_NOT_FOUND',
      'Security Deposit settlement was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
