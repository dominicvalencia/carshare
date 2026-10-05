import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EarningHoldStatus,
  OwnerEarningStatus,
  OwnerProfileStatus,
  PayoutAccountStatus,
  PayoutEligibilityStatus,
  Prisma,
  RoleCode,
  UserStatus,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';

@Injectable()
export class PayoutEligibilityService {
  constructor(private readonly database: DatabaseService) {}

  async ownerReadiness(ownerProfileId: string, payoutAccountId?: string) {
    const owner = await this.database.client.ownerProfile.findUnique({
      include: {
        payoutAccounts: {
          where: payoutAccountId ? { id: payoutAccountId } : { isDefault: true },
        },
        payoutEligibility: true,
        user: { include: { roles: { include: { role: true } } } },
      },
      where: { id: ownerProfileId },
    });
    if (!owner)
      this.block('PAYOUT_OWNER_NOT_FOUND', 'Owner profile was not found.', HttpStatus.NOT_FOUND);
    const destination = owner.payoutAccounts[0];
    const blockers: string[] = [];
    if (owner.user.status !== UserStatus.ACTIVE) blockers.push('USER_NOT_ACTIVE');
    if (!owner.user.roles.some(({ role }) => role.code === RoleCode.OWNER))
      blockers.push('OWNER_ROLE_MISSING');
    if (owner.status !== OwnerProfileStatus.VERIFIED) blockers.push('OWNER_NOT_VERIFIED');
    if (owner.payoutEligibility?.status !== PayoutEligibilityStatus.ELIGIBLE)
      blockers.push('PAYOUT_NOT_ELIGIBLE');
    if (!destination) blockers.push('PAYOUT_DESTINATION_MISSING');
    else if (destination.status !== PayoutAccountStatus.ACTIVE)
      blockers.push('PAYOUT_DESTINATION_NOT_ACTIVE');
    return { blockers, destination, owner };
  }

  async assertOwnerReady(ownerProfileId: string, payoutAccountId?: string) {
    const readiness = await this.ownerReadiness(ownerProfileId, payoutAccountId);
    if (readiness.blockers.length) {
      this.block(
        'PAYOUT_OWNER_NOT_READY',
        `Owner is not payout ready: ${readiness.blockers.join(', ')}.`,
        HttpStatus.CONFLICT,
      );
    }
    return readiness;
  }

  async earningDiagnostics(ownerProfileId: string) {
    const earnings = await this.database.client.ownerEarning.findMany({
      include: {
        booking: {
          include: {
            disputes: true,
            payments: true,
            postReturnClaims: true,
            rentalIncidents: true,
            securityDeposit: true,
            securityDepositSettlements: true,
          },
        },
        holds: { where: { status: EarningHoldStatus.ACTIVE } },
        payoutItems: { where: { activeAllocation: true } },
      },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      where: { ownerProfileId },
    });
    const workflow = await this.database.client.$queryRaw<
      { bookingId: string; blocker: string | null }[]
    >(Prisma.sql`SELECT b."id" AS "bookingId", "booking_workflow_compliance_blocker"(b."id") AS blocker
      FROM "bookings" b WHERE b."owner_profile_id" = ${ownerProfileId}::uuid`);
    const workflowBlockers = new Map(workflow.map((item) => [item.bookingId, item.blocker]));
    return earnings.map((earning) => {
      const blockers: string[] = [];
      // Never reinterpret paid history; submitted allocations continue reconciliation.
      const workflowBlocker = workflowBlockers.get(earning.bookingId);
      if (
        earning.status !== OwnerEarningStatus.PAID &&
        !earning.payoutItems.length &&
        workflowBlocker
      )
        blockers.push(workflowBlocker);
      if (earning.status !== OwnerEarningStatus.AVAILABLE)
        blockers.push(`EARNING_${earning.status}`);
      if (earning.holds.length) blockers.push('ACTIVE_EARNING_HOLD');
      if (earning.payoutItems.length) blockers.push('ACTIVE_PAYOUT_ALLOCATION');
      if (
        earning.booking.postReturnClaims.some(
          (claim) => !['WITHDRAWN', 'RESOLVED'].includes(claim.status),
        )
      )
        blockers.push('BLOCKING_CLAIM');
      if (
        earning.booking.disputes.some(
          (dispute) =>
            !['RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED', 'CLOSED'].includes(
              dispute.status,
            ),
        )
      )
        blockers.push('BLOCKING_DISPUTE');
      if (
        earning.booking.rentalIncidents.some(
          (incident) =>
            incident.severity === 'CRITICAL' &&
            !['RESOLVED', 'DISMISSED'].includes(incident.status),
        )
      )
        blockers.push('CRITICAL_INCIDENT');
      if (
        earning.booking.payments.some(
          (payment) =>
            payment.reconciliationRequired ||
            ['AUTHORIZING', 'CAPTURING', 'VOID_PENDING'].includes(payment.status),
        )
      )
        blockers.push('PAYMENT_RECONCILIATION');
      const depositTerminal = earning.booking.securityDepositSettlements.some((settlement) =>
        ['RELEASED', 'PARTIALLY_USED', 'USED', 'REVERSED'].includes(settlement.status),
      );
      const depositFinanciallyOpen =
        earning.booking.securityDepositSettlements.some(
          (settlement) =>
            !['RELEASED', 'PARTIALLY_USED', 'USED', 'REVERSED'].includes(settlement.status),
        ) ||
        (earning.booking.securityDeposit !== null &&
          ['AUTHORIZED', 'CLAIM_HELD'].includes(earning.booking.securityDeposit.status) &&
          !depositTerminal);
      if (depositFinanciallyOpen) blockers.push('SECURITY_DEPOSIT_SETTLEMENT_PENDING');
      return {
        amountMinor:
          earning.netEarningAmountMinor +
          earning.deliveryEarningMinor +
          earning.collectionEarningMinor +
          earning.additionalCompensationMinor +
          earning.adjustmentAmountMinor,
        blockers,
        earning,
        eligible: blockers.length === 0,
      };
    });
  }

  eligibleSelectionSql(ownerProfileId: string, maximumAmountMinor?: bigint) {
    return this.eligibleEarningsSql(ownerProfileId, maximumAmountMinor);
  }

  eligibleAggregateSql(ownerProfileId?: string) {
    const eligible = this.eligibleEarningsSql(ownerProfileId);
    return Prisma.sql`
      SELECT e."currency",
        COUNT(*)::integer AS "count",
        SUM(e."net_earning_amount_minor" + e."delivery_earning_minor" + e."collection_earning_minor" + e."additional_compensation_minor" + e."adjustment_amount_minor") AS "amountMinor"
      FROM (${eligible}) eligible
      JOIN "owner_earnings" e ON e."id" = eligible."id"
      GROUP BY e."currency"
      ORDER BY e."currency"
    `;
  }

  private eligibleEarningsSql(ownerProfileId?: string, maximumAmountMinor?: bigint) {
    return Prisma.sql`
      SELECT e."id"
      FROM "owner_earnings" e
      WHERE (${ownerProfileId ?? null}::uuid IS NULL OR e."owner_profile_id" = ${ownerProfileId ?? null}::uuid)
        AND e."status" = 'AVAILABLE'
        AND "booking_workflow_compliance_blocker"(e."booking_id") IS NULL
        AND (${ownerProfileId ?? null}::uuid IS NOT NULL OR EXISTS (
          SELECT 1
          FROM "owner_profiles" op
          JOIN "users" u ON u."id" = op."user_id"
          JOIN "user_roles" ur ON ur."user_id" = u."id"
          JOIN "roles" r ON r."id" = ur."role_id" AND r."code" = 'OWNER'
          JOIN "payout_eligibilities" pe ON pe."owner_profile_id" = op."id" AND pe."status" = 'ELIGIBLE'
          JOIN "owner_payout_accounts" opa ON opa."owner_profile_id" = op."id"
            AND opa."is_default" AND opa."status" = 'ACTIVE'
          WHERE op."id" = e."owner_profile_id"
            AND op."status" = 'VERIFIED'
            AND u."status" = 'ACTIVE'
        ))
        AND (${maximumAmountMinor ?? null}::bigint IS NULL OR
          e."net_earning_amount_minor" + e."delivery_earning_minor" + e."collection_earning_minor" + e."additional_compensation_minor" + e."adjustment_amount_minor" <= ${maximumAmountMinor ?? null}::bigint)
        AND NOT EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = e."id" AND h."status" = 'ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM "payout_items" pi WHERE pi."owner_earning_id" = e."id" AND pi."active_allocation")
        AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = e."booking_id" AND c."status" NOT IN ('WITHDRAWN', 'RESOLVED'))
        AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = e."booking_id" AND d."status" NOT IN ('RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED', 'CLOSED'))
        AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = e."booking_id" AND i."severity" = 'CRITICAL' AND i."status" NOT IN ('RESOLVED', 'DISMISSED'))
        AND NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."booking_id" = e."booking_id" AND (p."reconciliation_required" OR p."status" IN ('AUTHORIZING', 'CAPTURING', 'VOID_PENDING')))
        AND NOT EXISTS (
          SELECT 1 FROM "security_deposit_settlements" s
          WHERE s."booking_id" = e."booking_id"
            AND s."status" NOT IN ('RELEASED', 'PARTIALLY_USED', 'USED', 'REVERSED')
        )
        AND NOT EXISTS (
          SELECT 1 FROM "security_deposit_authorizations" a
          WHERE a."booking_id" = e."booking_id"
            AND a."status" IN ('AUTHORIZED', 'CLAIM_HELD')
            AND NOT EXISTS (
              SELECT 1 FROM "security_deposit_settlements" terminal
              WHERE terminal."security_deposit_authorization_id" = a."id"
                AND terminal."status" IN ('RELEASED', 'PARTIALLY_USED', 'USED', 'REVERSED')
            )
        )
      ORDER BY e."available_at" ASC NULLS LAST, e."created_at" ASC, e."id" ASC
      FOR UPDATE OF e SKIP LOCKED
    `;
  }

  private block(code: string, message: string, status: HttpStatus): never {
    throw new ApplicationException(code, message, status);
  }
}
