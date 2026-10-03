import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  OwnerPayoutMethodStatus,
  PayoutMethodErrorCode,
  type OwnerPayoutMethodDetail,
  type OwnerPayoutMethodList,
  type OwnerPayoutMethodListItem,
  type OwnerPayoutMethodType,
} from '@carrental/api-contracts';
import {
  FinancialAccountType,
  LedgerTransactionType,
  OwnerEarningStatus,
  OwnerFinancialObligationStatus,
  OwnerFinancialObligationType,
  OwnerProfileStatus,
  PayoutAccountStatus,
  PayoutBatchStatus,
  PayoutEligibilityStatus,
  PayoutFailureCategory,
  PayoutOperationStatus,
  PayoutOperationType,
  PayoutProviderCode,
  PayoutStatus,
  PayoutWebhookStatus,
  Prisma,
  planOwnerObligationRecoveries,
} from '@carrental/database';
import type {
  PayoutProvider,
  PayoutProviderStatus,
  ProviderWebhookInput,
} from '@carrental/payouts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import type { CreatePayoutAccountDto, CreatePayoutBatchDto, CreatePayoutDto } from './payouts.dto';
import { PayoutEligibilityService } from './payout-eligibility.service';
import { PayoutEncryptionService } from './payout-encryption.service';
import { PAYOUT_PROVIDER } from './payout-provider.factory';
import { ownerPayoutMethodCatalog, payoutMethodInstitution } from './payout-method-catalog';

const PAYOUT_INCLUDE = {
  batch: { select: { publicReference: true, status: true } },
  items: {
    include: {
      ownerEarning: {
        include: {
          booking: { select: { publicReference: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  operations: { orderBy: { createdAt: 'asc' as const } },
  adjustments: { orderBy: { createdAt: 'asc' as const } },
  obligationRecoveries: { orderBy: { recoveredAt: 'asc' as const } },
  ownerProfile: {
    include: {
      payoutEligibility: true,
      financialObligations: { select: { currency: true, remainingAmountMinor: true } },
      user: { include: { profile: true } },
    },
  },
  payoutAccount: true,
} satisfies Prisma.PayoutInclude;

type PayoutRecord = Prisma.PayoutGetPayload<{ include: typeof PAYOUT_INCLUDE }>;

@Injectable()
export class PayoutsService {
  private readonly minimumAmountMinor: bigint;
  private readonly reconcileDelayMs: number;
  private readonly fourEyesEnabled: boolean;

  constructor(
    private readonly database: DatabaseService,
    private readonly encryption: PayoutEncryptionService,
    private readonly eligibility: PayoutEligibilityService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
    @Inject(ConfigService) configuration: ConfigService<ApiEnvironment, true>,
  ) {
    this.minimumAmountMinor = BigInt(
      configuration.getOrThrow('PAYOUT_MINIMUM_AMOUNT_MINOR', { infer: true }),
    );
    this.reconcileDelayMs =
      configuration.getOrThrow('PAYOUT_RECONCILE_INTERVAL_SECONDS', { infer: true }) * 1000;
    this.fourEyesEnabled = configuration.getOrThrow('PAYOUT_FOUR_EYES_ENABLED', { infer: true });
  }

  async ownerAccounts(ownerUserId: string) {
    const owner = await this.ownerByUser(ownerUserId);
    const accounts = await this.database.client.ownerPayoutAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      where: { ownerProfileId: owner.id },
    });
    return {
      eligibility: owner.payoutEligibility ?? {
        status: PayoutEligibilityStatus.NOT_READY,
      },
      items: accounts.map((account) => this.accountProjection(account)),
    };
  }

  ownerPayoutMethodCatalog() {
    const supportedTypes = this.provider
      .getCapabilities()
      .destinationTypes.filter(
        (type): type is OwnerPayoutMethodType => type === 'BANK_ACCOUNT' || type === 'E_WALLET',
      );
    return ownerPayoutMethodCatalog(supportedTypes);
  }

  async ownerPayoutMethods(ownerUserId: string): Promise<OwnerPayoutMethodList> {
    const owner = await this.ownerByUser(ownerUserId);
    const accounts = await this.database.client.ownerPayoutAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      where: { ownerProfileId: owner.id },
    });
    return { items: accounts.map((account) => this.ownerPayoutMethodProjection(account)) };
  }

  async ownerPayoutMethodDetail(
    ownerUserId: string,
    accountId: string,
  ): Promise<OwnerPayoutMethodDetail> {
    const owner = await this.ownerByUser(ownerUserId);
    const account = await this.database.client.ownerPayoutAccount.findFirst({
      include: {
        _count: {
          select: {
            payouts: {
              where: {
                status: {
                  in: [PayoutStatus.APPROVED, PayoutStatus.SUBMITTING, PayoutStatus.PROCESSING],
                },
              },
            },
          },
        },
      },
      where: { id: accountId, ownerProfileId: owner.id },
    });
    if (!account)
      throw new ApplicationException(
        PayoutMethodErrorCode.NOT_FOUND,
        'Payout method was not found.',
        HttpStatus.NOT_FOUND,
      );
    const payoutInProgress = account._count.payouts > 0;
    return {
      ...this.ownerPayoutMethodProjection(account),
      accountHolderName: account.accountHolderName,
      actions: {
        canEdit: false,
        canRemove: account.status !== PayoutAccountStatus.DISABLED && !payoutInProgress,
        canSetPrimary: account.status === PayoutAccountStatus.ACTIVE && !account.isDefault,
        removalBlockedReason: payoutInProgress ? 'PAYOUT_IN_PROGRESS' : null,
      },
      disabledAt: account.disabledAt?.toISOString() ?? null,
      verifiedAt: account.verifiedAt?.toISOString() ?? null,
    };
  }

  async addOwnerAccount(
    ownerUserId: string,
    input: CreatePayoutAccountDto,
    request: RequestMetadata,
  ) {
    const owner = await this.ownerByUser(ownerUserId);
    if (owner.status !== OwnerProfileStatus.VERIFIED) {
      this.conflict('PAYOUT_OWNER_NOT_VERIFIED', 'Owner verification is required.');
    }
    if (owner.payoutEligibility?.status === PayoutEligibilityStatus.RESTRICTED) {
      this.conflict('PAYOUT_ELIGIBILITY_RESTRICTED', 'Payout eligibility is restricted.');
    }
    const destination = {
      accountHolderName: input.accountHolderName.trim(),
      accountIdentifier: input.accountIdentifier.trim(),
      country: 'PH' as const,
      currency: 'PHP' as const,
      destinationChannel: input.destinationChannel.trim().toUpperCase(),
      type: input.type,
    };
    const supportedMethod = this.ownerPayoutMethodCatalog().methods.some(
      (method) =>
        method.code === destination.destinationChannel && method.type === destination.type,
    );
    if (!supportedMethod)
      this.conflict(PayoutMethodErrorCode.UNSUPPORTED, 'This payout destination is not supported.');
    const validation = await this.provider.validateDestination(destination);
    const protectedIdentifier = this.encryption.protect(destination.accountIdentifier);
    const status =
      validation.kind === 'VALID'
        ? PayoutAccountStatus.ACTIVE
        : validation.kind === 'INVALID'
          ? PayoutAccountStatus.REJECTED
          : PayoutAccountStatus.REQUIRES_ACTION;
    let account: Prisma.OwnerPayoutAccountGetPayload<Record<string, never>>;
    try {
      account = await this.database.client.$transaction(async (transaction) => {
        const activeCount = await transaction.ownerPayoutAccount.count({
          where: { ownerProfileId: owner.id, status: PayoutAccountStatus.ACTIVE },
        });
        const created = await transaction.ownerPayoutAccount.create({
          data: {
            accountHolderName: destination.accountHolderName,
            createdByUserId: ownerUserId,
            currency: 'PHP',
            destinationChannel: destination.destinationChannel,
            encryptedAccountIdentifier: protectedIdentifier.ciphertext,
            encryptionAuthTag: protectedIdentifier.authTag,
            encryptionIv: protectedIdentifier.iv,
            identifierFingerprint: protectedIdentifier.fingerprint,
            isDefault: status === PayoutAccountStatus.ACTIVE && activeCount === 0,
            maskedAccountIdentifier: protectedIdentifier.masked,
            ownerProfileId: owner.id,
            provider: this.providerCode(),
            safeValidationReference: validation.safeValidationReference ?? null,
            status,
            type: input.type,
            validationLevel: validation.validationLevel,
            verifiedAt:
              status === PayoutAccountStatus.ACTIVE && validation.validationLevel === 'PROVIDER'
                ? new Date()
                : null,
          },
        });
        await this.audit(
          transaction,
          ownerUserId,
          'PAYOUT_ACCOUNT_CREATED',
          'OWNER_PAYOUT_ACCOUNT',
          created.id,
          request,
          validation.safeReason,
          {
            destination: created.maskedAccountIdentifier,
            status: created.status,
          },
        );
        await this.event(transaction, created.id, 'PAYOUT_ACCOUNT_ADDED', {
          accountId: created.id,
          destination: created.maskedAccountIdentifier,
          ownerProfileId: owner.id,
          status: created.status,
        });
        return created;
      });
    } catch (error) {
      if (this.isUniqueViolation(error))
        this.conflict(PayoutMethodErrorCode.DUPLICATE, 'This payout method is already saved.');
      throw error;
    }
    return this.accountProjection(account);
  }

  async setDefault(ownerUserId: string, accountId: string, request: RequestMetadata) {
    const owner = await this.ownerByUser(ownerUserId);
    return this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "owner_profiles" WHERE "id" = ${owner.id}::uuid FOR UPDATE`,
      );
      const account = await transaction.ownerPayoutAccount.findFirst({
        where: {
          id: accountId,
          ownerProfileId: owner.id,
          status: PayoutAccountStatus.ACTIVE,
        },
      });
      if (!account) this.notFound('Active payout account was not found.');
      await transaction.ownerPayoutAccount.updateMany({
        data: { isDefault: false },
        where: { currency: account.currency, ownerProfileId: owner.id, isDefault: true },
      });
      const updated = await transaction.ownerPayoutAccount.update({
        data: { isDefault: true },
        where: { id: account.id },
      });
      await this.audit(
        transaction,
        ownerUserId,
        'PAYOUT_ACCOUNT_DEFAULT_CHANGED',
        'OWNER_PAYOUT_ACCOUNT',
        account.id,
        request,
        undefined,
        {
          destination: account.maskedAccountIdentifier,
        },
      );
      return this.accountProjection(updated);
    });
  }

  async disableAccount(
    ownerUserId: string,
    accountId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    const owner = await this.ownerByUser(ownerUserId);
    return this.database.client.$transaction(async (transaction) => {
      const account = await transaction.ownerPayoutAccount.findFirst({
        where: { id: accountId, ownerProfileId: owner.id },
      });
      if (!account) this.notFound('Payout account was not found.');
      if (account.status === PayoutAccountStatus.DISABLED) return this.accountProjection(account);
      const activePayout = await transaction.payout.count({
        where: {
          payoutAccountId: account.id,
          status: { in: [PayoutStatus.APPROVED, PayoutStatus.SUBMITTING, PayoutStatus.PROCESSING] },
        },
      });
      if (activePayout)
        this.conflict('PAYOUT_ACCOUNT_IN_USE', 'An active payout uses this destination.');
      const updated = await transaction.ownerPayoutAccount.update({
        data: { disabledAt: new Date(), isDefault: false, status: PayoutAccountStatus.DISABLED },
        where: { id: account.id },
      });
      await this.audit(
        transaction,
        ownerUserId,
        'PAYOUT_ACCOUNT_DISABLED',
        'OWNER_PAYOUT_ACCOUNT',
        account.id,
        request,
        reason,
        {
          destination: account.maskedAccountIdentifier,
        },
      );
      return this.accountProjection(updated);
    });
  }

  async ownerPayouts(ownerUserId: string, payoutId?: string) {
    const owner = await this.ownerByUser(ownerUserId);
    const payouts = await this.database.client.payout.findMany({
      include: PAYOUT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      where: { ownerProfileId: owner.id, ...(payoutId ? { id: payoutId } : {}) },
    });
    if (payoutId && !payouts.length) this.notFound('Payout was not found.');
    return payoutId
      ? this.ownerPayoutProjection(payouts[0]!)
      : payouts.map((item) => this.ownerPayoutProjection(item));
  }

  async setEligibility(
    actorUserId: string,
    ownerProfileId: string,
    status: PayoutEligibilityStatus,
    reason: string,
    request: RequestMetadata,
  ) {
    const owner = await this.database.client.ownerProfile.findUnique({
      where: { id: ownerProfileId },
    });
    if (!owner) this.notFound('Owner profile was not found.');
    const eligibility = await this.database.client.$transaction(async (transaction) => {
      const changed = await transaction.payoutEligibility.upsert({
        create: {
          changedByUserId: actorUserId,
          lastEvaluatedAt: new Date(),
          ownerProfileId,
          reason,
          status,
        },
        update: { changedByUserId: actorUserId, lastEvaluatedAt: new Date(), reason, status },
        where: { ownerProfileId },
      });
      await this.audit(
        transaction,
        actorUserId,
        'PAYOUT_ELIGIBILITY_CHANGED',
        'PAYOUT_ELIGIBILITY',
        changed.id,
        request,
        reason,
        { status },
      );
      if (status === PayoutEligibilityStatus.RESTRICTED) {
        await this.event(transaction, changed.id, 'PAYOUT_ELIGIBILITY_RESTRICTED', {
          ownerProfileId,
        });
      }
      return changed;
    });
    return eligibility;
  }

  async adminQueue() {
    const owners = await this.database.client.ownerProfile.findMany({
      include: {
        payoutAccounts: { where: { isDefault: true } },
        payoutEligibility: true,
        user: { include: { profile: true } },
      },
      orderBy: { createdAt: 'asc' },
      where: { earnings: { some: { status: OwnerEarningStatus.AVAILABLE } } },
    });
    return Promise.all(
      owners.map(async (owner) => {
        const diagnostics = await this.eligibility.earningDiagnostics(owner.id);
        const readiness = await this.eligibility.ownerReadiness(owner.id);
        const failures = await this.database.client.payout.count({
          where: { ownerProfileId: owner.id, status: PayoutStatus.FAILED },
        });
        return {
          availableEligibleMinor: this.minor(
            diagnostics
              .filter((item) => item.eligible)
              .reduce((sum, item) => sum + item.amountMinor, 0n),
          ),
          blockers: [
            ...new Set([...readiness.blockers, ...diagnostics.flatMap((item) => item.blockers)]),
          ],
          destination: owner.payoutAccounts[0]
            ? this.accountProjection(owner.payoutAccounts[0])
            : null,
          owner: {
            displayName: owner.user.profile?.displayName,
            id: owner.id,
            status: owner.status,
            userId: owner.userId,
          },
          payoutEligibility: owner.payoutEligibility?.status ?? PayoutEligibilityStatus.NOT_READY,
          previousFailures: failures,
          provider: this.provider.code,
        };
      }),
    );
  }

  async adminPayouts(payoutId?: string) {
    const payouts = await this.database.client.payout.findMany({
      include: PAYOUT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      where: payoutId ? { id: payoutId } : {},
    });
    if (payoutId && !payouts.length) this.notFound('Payout was not found.');
    const projections = await Promise.all(payouts.map((payout) => this.adminProjection(payout)));
    return payoutId ? projections[0] : projections;
  }

  async createPayout(
    actorUserId: string,
    input: CreatePayoutDto,
    request: RequestMetadata,
    existingBatchId?: string,
  ) {
    const readiness = await this.eligibility.assertOwnerReady(
      input.ownerProfileId,
      input.payoutAccountId,
    );
    const account = readiness.destination!;
    const payout = await this.database.client.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "owner_profiles" WHERE "id" = ${input.ownerProfileId}::uuid FOR UPDATE`,
        );
        const rows = await transaction.$queryRaw<Array<{ id: string }>>(
          this.eligibility.eligibleSelectionSql(
            input.ownerProfileId,
            input.maximumAmountMinor ? BigInt(input.maximumAmountMinor) : undefined,
          ),
        );
        if (!rows.length)
          this.conflict('NO_ELIGIBLE_EARNINGS', 'No eligible AVAILABLE earnings were found.');
        const earnings = await transaction.ownerEarning.findMany({
          orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
          where: { id: { in: rows.map(({ id }) => id) } },
        });
        let selected = earnings;
        if (input.maximumAmountMinor) {
          let running = 0n;
          selected = earnings.filter((earning) => {
            const amount = this.earningAmount(earning);
            if (running + amount > BigInt(input.maximumAmountMinor!)) return false;
            running += amount;
            return true;
          });
        }
        const total = selected.reduce((sum, earning) => sum + this.earningAmount(earning), 0n);
        if (total < this.minimumAmountMinor)
          this.conflict(
            'PAYOUT_BELOW_MINIMUM',
            'Eligible total is below the configured payout minimum.',
          );
        const currency = selected[0]!.currency;
        const obligations = await transaction.ownerFinancialObligation.findMany({
          orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
          select: { id: true, remainingAmountMinor: true },
          where: {
            currency,
            ownerProfileId: input.ownerProfileId,
            remainingAmountMinor: { gt: 0n },
            status: {
              in: [
                OwnerFinancialObligationStatus.OUTSTANDING,
                OwnerFinancialObligationStatus.PARTIALLY_RECOVERED,
              ],
            },
            type: OwnerFinancialObligationType.CANCELLATION_PENALTY,
          },
        });
        const reserved = await transaction.payoutAdjustment.groupBy({
          by: ['sourceId'],
          _sum: { signedAmountMinor: true },
          where: { sourceId: { in: obligations.map(({ id }) => id) }, status: 'RESERVED' },
        });
        const recoveryPlan = planOwnerObligationRecoveries(
          obligations.map((obligation) => ({
            ...obligation,
            remainingAmountMinor:
              obligation.remainingAmountMinor +
              (reserved.find(({ sourceId }) => sourceId === obligation.id)?._sum
                .signedAmountMinor ?? 0n),
          })),
          total,
        );
        const recoveryTotal = recoveryPlan.reduce((sum, item) => sum + item.amountMinor, 0n);
        const batch = existingBatchId
          ? await transaction.payoutBatch.findUniqueOrThrow({ where: { id: existingBatchId } })
          : await transaction.payoutBatch.create({
              data: {
                createdByUserId: actorUserId,
                note: input.note ?? null,
                publicReference: this.reference('PB'),
                status: PayoutBatchStatus.IN_PROGRESS,
              },
            });
        const payoutId = randomUUID();
        const created = await transaction.payout.create({
          data: {
            adjustmentAmountMinor: -recoveryTotal,
            amountMinor: total - recoveryTotal,
            adjustments: {
              create: recoveryPlan.map((item) => ({
                auditMetadata: { authority: 'OWNER_FINANCIAL_OBLIGATION' },
                correlationId: request.correlationId ?? null,
                currency,
                idempotencyKey: `payout:${payoutId}:obligation:${item.obligationId}:reserve:v1`,
                signedAmountMinor: -item.amountMinor,
                sourceId: item.obligationId,
                sourceType: 'OWNER_FINANCIAL_OBLIGATION',
                type: 'OWNER_CANCELLATION_PENALTY_RECOVERY',
              })),
            },
            batchId: batch.id,
            createdByUserId: actorUserId,
            currency,
            destinationAccountHolder: account.accountHolderName,
            destinationChannel: account.destinationChannel,
            destinationCountry: account.country,
            destinationCurrency: account.currency,
            destinationMasked: account.maskedAccountIdentifier,
            destinationType: account.type,
            grossEarningMinor: total,
            id: payoutId,
            items: {
              create: selected.map((earning) => ({
                amountMinor: this.earningAmount(earning),
                currency: earning.currency,
                ownerEarningId: earning.id,
              })),
            },
            operations: {
              create: {
                actorUserId,
                completedAt: new Date(),
                correlationId: request.correlationId ?? null,
                idempotencyKey: `payout-create:${randomUUID()}`,
                status: PayoutOperationStatus.SUCCEEDED,
                type: PayoutOperationType.CREATE,
              },
            },
            ownerProfileId: input.ownerProfileId,
            payoutAccountId: account.id,
            provider: this.providerCode(),
            publicReference: this.reference('PO'),
            status: PayoutStatus.PENDING_APPROVAL,
          },
          include: PAYOUT_INCLUDE,
        });
        await this.audit(
          transaction,
          actorUserId,
          'PAYOUT_CREATED',
          'PAYOUT',
          created.id,
          request,
          input.note,
          {
            amountMinor: total.toString(),
            destination: account.maskedAccountIdentifier,
            earningCount: selected.length,
          },
        );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.payoutProjection(payout as PayoutRecord);
  }

  async createBatch(actorUserId: string, input: CreatePayoutBatchDto, request: RequestMetadata) {
    const batch = await this.database.client.payoutBatch.create({
      data: {
        createdByUserId: actorUserId,
        note: input.note ?? null,
        publicReference: this.reference('PB'),
        status: PayoutBatchStatus.IN_PROGRESS,
      },
    });
    const results = [];
    for (const ownerProfileId of [...new Set(input.ownerProfileIds)].sort()) {
      results.push(
        await this.createPayout(
          actorUserId,
          { ownerProfileId, ...(input.note ? { note: input.note } : {}) },
          request,
          batch.id,
        ),
      );
    }
    return { batch: { ...batch }, payouts: results };
  }

  async approve(actorUserId: string, payoutId: string, note: string, request: RequestMetadata) {
    const current = await this.loadPayout(payoutId);
    if (current.status === PayoutStatus.APPROVED) return this.payoutProjection(current);
    if (current.status !== PayoutStatus.PENDING_APPROVAL)
      this.conflict('INVALID_PAYOUT_STATE', 'Only pending payouts may be approved.');
    if (this.fourEyesEnabled && current.createdByUserId === actorUserId)
      this.conflict(
        'PAYOUT_FOUR_EYES_REQUIRED',
        'The payout creator cannot approve this payout while four-eyes control is enabled.',
      );
    await this.eligibility.assertOwnerReady(current.ownerProfileId, current.payoutAccountId);
    const updated = await this.database.client.$transaction(async (transaction) => {
      const changed = await transaction.payout.update({
        data: {
          approvalNote: note,
          approvedAt: new Date(),
          approvedByUserId: actorUserId,
          operations: {
            create: {
              actorUserId,
              completedAt: new Date(),
              correlationId: request.correlationId ?? null,
              idempotencyKey: `payout:${payoutId}:approve:v1`,
              status: PayoutOperationStatus.SUCCEEDED,
              type: PayoutOperationType.APPROVE,
            },
          },
          status: PayoutStatus.APPROVED,
        },
        include: PAYOUT_INCLUDE,
        where: { id: payoutId, status: PayoutStatus.PENDING_APPROVAL },
      });
      await this.audit(
        transaction,
        actorUserId,
        'PAYOUT_APPROVED',
        'PAYOUT',
        payoutId,
        request,
        note,
        { amountMinor: changed.amountMinor.toString() },
      );
      return changed;
    });
    return this.payoutProjection(updated as PayoutRecord);
  }

  async submit(actorUserId: string | null, payoutId: string, request: RequestMetadata) {
    const prepared = await this.prepareSubmission(actorUserId, payoutId, request);
    if (!prepared.execute) return this.payoutProjection(prepared.payout);
    let result;
    try {
      result = await this.provider.createPayout(prepared.input);
    } catch (error) {
      await this.markUnknown(payoutId, error);
      return this.payoutProjection(await this.loadPayout(payoutId));
    }
    await this.applyProviderStatus(payoutId, result, request);
    return this.payoutProjection(await this.loadPayout(payoutId));
  }

  async cancel(actorUserId: string, payoutId: string, reason: string, request: RequestMetadata) {
    const payout = await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "payouts" WHERE "id" = ${payoutId}::uuid FOR UPDATE`,
      );
      const current = await transaction.payout.findUnique({
        include: PAYOUT_INCLUDE,
        where: { id: payoutId },
      });
      if (!current) this.notFound('Payout was not found.');
      if (current.status === PayoutStatus.CANCELLED) return current;
      if (
        !(
          [PayoutStatus.PENDING_APPROVAL, PayoutStatus.APPROVED] as readonly PayoutStatus[]
        ).includes(current.status)
      )
        this.conflict('INVALID_PAYOUT_STATE', 'Only pre-submission payouts may be cancelled.');
      await this.releaseAllocation(transaction, current, OwnerEarningStatus.AVAILABLE);
      const changed = await transaction.payout.update({
        data: {
          cancelledAt: new Date(),
          operations: {
            create: {
              actorUserId,
              completedAt: new Date(),
              correlationId: request.correlationId ?? null,
              idempotencyKey: `payout:${payoutId}:cancel:v1`,
              safeFailureMessage: reason,
              status: PayoutOperationStatus.SUCCEEDED,
              type: PayoutOperationType.CANCEL,
            },
          },
          status: PayoutStatus.CANCELLED,
        },
        include: PAYOUT_INCLUDE,
        where: { id: payoutId },
      });
      await this.audit(
        transaction,
        actorUserId,
        'PAYOUT_CANCELLED',
        'PAYOUT',
        payoutId,
        request,
        reason,
      );
      return changed;
    });
    return this.payoutProjection(payout as PayoutRecord);
  }

  async reconcilePayout(payoutId: string, request: RequestMetadata) {
    const payout = await this.loadPayout(payoutId);
    if (
      !([PayoutStatus.SUBMITTING, PayoutStatus.PROCESSING] as readonly PayoutStatus[]).includes(
        payout.status,
      )
    )
      return this.payoutProjection(payout);
    let status: PayoutProviderStatus;
    try {
      if (payout.providerPayoutId) {
        status = await this.provider.retrievePayout(payout.providerPayoutId);
      } else {
        const prepared = this.providerInput(payout);
        const recovered = await this.provider.createPayout(prepared);
        status = recovered;
      }
    } catch (error) {
      await this.markUnknown(payoutId, error);
      return this.payoutProjection(await this.loadPayout(payoutId));
    }
    await this.applyProviderStatus(payoutId, status, request);
    return this.payoutProjection(await this.loadPayout(payoutId));
  }

  async reconcileDue(limit = 50): Promise<number> {
    const due = await this.database.client.payout.findMany({
      select: { id: true },
      take: limit,
      where: {
        reconciliationRequired: true,
        status: { in: [PayoutStatus.SUBMITTING, PayoutStatus.PROCESSING] },
        OR: [{ reconcileAfter: null }, { reconcileAfter: { lte: new Date() } }],
      },
    });
    for (const payout of due)
      await this.reconcilePayout(payout.id, { correlationId: `payout-reconcile:${randomUUID()}` });
    return due.length;
  }

  async receiveWebhook(input: ProviderWebhookInput, request: RequestMetadata) {
    const normalized = await this.provider.normalizeWebhook(input);
    const payloadDigest = createHash('sha256').update(input.rawBody).digest('hex');
    const payout = await this.database.client.payout.findFirst({
      where: { provider: this.providerCode(), providerPayoutId: normalized.providerPayoutId },
    });
    const identity = {
      externalEventId: normalized.externalEventId,
      provider: this.providerCode(),
    };
    let event;
    try {
      event = await this.database.client.payoutWebhookEvent.create({
        data: {
          eventType: normalized.eventType,
          externalEventId: normalized.externalEventId,
          payloadDigest,
          ...(payout ? { payoutId: payout.id } : {}),
          provider: this.providerCode(),
          providerPayoutId: normalized.providerPayoutId,
          redactedPayload: normalized.redactedPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      event = await this.database.client.payoutWebhookEvent.findUniqueOrThrow({
        where: { provider_externalEventId: identity },
      });
    }
    if (event.status !== PayoutWebhookStatus.RECEIVED) return { accepted: true, duplicate: true };
    if (!payout) {
      await this.database.client.payoutWebhookEvent.update({
        data: {
          failureReason: 'Payout not found; reconciliation backlog.',
          status: PayoutWebhookStatus.FAILED,
        },
        where: { id: event.id },
      });
      return { accepted: true, pendingReconciliation: true };
    }
    await this.database.client.payoutWebhookEvent.update({
      data: { attemptCount: { increment: 1 }, status: PayoutWebhookStatus.PROCESSING },
      where: { id: event.id },
    });
    try {
      if (normalized.state === 'REVERSED') {
        const providerStatus = await this.provider.retrievePayout(normalized.providerPayoutId);
        await this.applyProviderStatus(payout.id, providerStatus, {
          ...request,
          correlationId: `payout-webhook:${event.id}`,
        });
      } else {
        await this.reconcilePayout(payout.id, {
          ...request,
          correlationId: `payout-webhook:${event.id}`,
        });
      }
      await this.database.client.payoutWebhookEvent.update({
        data: { processedAt: new Date(), status: PayoutWebhookStatus.PROCESSED },
        where: { id: event.id },
      });
    } catch (error) {
      await this.database.client.payoutWebhookEvent.update({
        data: {
          failureReason:
            error instanceof Error ? error.message.slice(0, 500) : 'Webhook processing failed.',
          status: PayoutWebhookStatus.FAILED,
        },
        where: { id: event.id },
      });
    }
    return { accepted: true, duplicate: false };
  }

  private async prepareSubmission(
    actorUserId: string | null,
    payoutId: string,
    request: RequestMetadata,
  ): Promise<{
    execute: boolean;
    input: ReturnType<PayoutsService['providerInput']>;
    payout: PayoutRecord;
  }> {
    const current = await this.loadPayout(payoutId);
    if (current.status !== PayoutStatus.APPROVED)
      return { execute: false, input: this.providerInput(current), payout: current };
    await this.eligibility.assertOwnerReady(current.ownerProfileId, current.payoutAccountId);
    const prepared = await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "payouts" WHERE "id" = ${payoutId}::uuid FOR UPDATE`,
      );
      const locked = await transaction.payout.findUnique({
        include: PAYOUT_INCLUDE,
        where: { id: payoutId },
      });
      if (!locked) this.notFound('Payout was not found.');
      if (locked.status !== PayoutStatus.APPROVED) return { claimed: false, payout: locked };
      if (!locked.submittedAt && !locked.providerPayoutId) {
        const workflow = await transaction.$queryRaw<{ blocker: string | null }[]>(Prisma.sql`
          SELECT "booking_workflow_compliance_blocker"(e."booking_id") AS blocker
          FROM "payout_items" p JOIN "owner_earnings" e ON e."id" = p."owner_earning_id"
          WHERE p."payout_id" = ${payoutId}::uuid AND p."active_allocation"
          FOR UPDATE OF e
        `);
        const blocker = workflow.find((item) => item.blocker)?.blocker;
        if (blocker)
          this.conflict(
            'PAYOUT_WORKFLOW_INCOMPLETE',
            `Required rental workflow is incomplete: ${blocker}.`,
          );
      }
      const payout = await transaction.payout.update({
        data: {
          operations: {
            create: {
              actorUserId,
              attemptCount: 1,
              correlationId: request.correlationId ?? null,
              idempotencyKey: `payout:${payoutId}:submit:v1`,
              providerRequestReference: locked.publicReference,
              startedAt: new Date(),
              status: PayoutOperationStatus.PROCESSING,
              type: PayoutOperationType.SUBMIT,
            },
          },
          reconcileAfter: new Date(Date.now() + this.reconcileDelayMs),
          reconciliationRequired: true,
          status: PayoutStatus.SUBMITTING,
        },
        include: PAYOUT_INCLUDE,
        where: { id: payoutId },
      });
      if (payout.amountMinor === 0n) {
        await this.applyPenaltyAdjustments(transaction, payout, request);
        await transaction.ownerEarning.updateMany({
          data: { status: OwnerEarningStatus.PAID },
          where: { payoutItems: { some: { activeAllocation: true, payoutId: payout.id } } },
        });
        await transaction.payoutOperation.updateMany({
          data: { completedAt: new Date(), status: PayoutOperationStatus.SUCCEEDED },
          where: { idempotencyKey: `payout:${payout.id}:submit:v1` },
        });
        const settled = await transaction.payout.update({
          data: {
            paidAt: new Date(),
            reconcileAfter: null,
            reconciliationRequired: false,
            status: PayoutStatus.PAID,
            submittedAt: new Date(),
          },
          include: PAYOUT_INCLUDE,
          where: { id: payout.id },
        });
        await this.event(transaction, payout.id, 'PAYOUT_PAID', {
          amountMinor: '0',
          ownerProfileId: payout.ownerProfileId,
          payoutId: payout.id,
          providerSubmissionSkipped: true,
        });
        return { claimed: false, payout: settled };
      }
      return { claimed: true, payout };
    });
    const included = prepared.payout as PayoutRecord;
    return {
      execute: prepared.claimed,
      input: this.providerInput(included),
      payout: included,
    };
  }

  private providerInput(payout: PayoutRecord) {
    const identifier = this.encryption.reveal({
      authTag: payout.payoutAccount.encryptionAuthTag,
      ciphertext: payout.payoutAccount.encryptedAccountIdentifier,
      iv: payout.payoutAccount.encryptionIv,
    });
    return {
      accountHolderName: payout.destinationAccountHolder,
      accountIdentifier: identifier,
      amountMinor: payout.amountMinor,
      country: 'PH' as const,
      currency: 'PHP' as const,
      description: `Car rental owner payout ${payout.publicReference}`,
      destinationChannel: payout.destinationChannel,
      idempotencyKey: `payout:${payout.id}:submit:v1`,
      referenceId: payout.publicReference,
      type: payout.destinationType,
    };
  }

  private async applyProviderStatus(
    payoutId: string,
    status: PayoutProviderStatus,
    request: RequestMetadata,
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "payouts" WHERE "id" = ${payoutId}::uuid FOR UPDATE`,
      );
      const payout = await transaction.payout.findUnique({
        include: PAYOUT_INCLUDE,
        where: { id: payoutId },
      });
      if (!payout) this.notFound('Payout was not found.');
      if (status.amountMinor !== 0n && status.amountMinor !== payout.amountMinor)
        throw new Error('Provider payout amount does not match internal payout.');
      if (payout.providerPayoutId && payout.providerPayoutId !== status.externalPayoutId)
        throw new Error('Provider payout identity mismatch.');
      if (status.state === 'FAILED') {
        await this.finalizeFailed(transaction, payout, status, request);
        return;
      }
      await this.ensureSubmitted(transaction, payout, status, request);
      if (status.state === 'SUCCEEDED') {
        await this.finalizePaid(transaction, payout, status, request);
      } else if (status.state === 'REVERSED') {
        await this.finalizeReversed(transaction, payout, status, request);
      } else {
        await transaction.payout.update({
          data: {
            lastProviderRetrievedAt: new Date(),
            providerPayoutId: status.externalPayoutId,
            providerState: status.providerState,
            reconcileAfter: new Date(Date.now() + this.reconcileDelayMs),
            reconciliationRequired: true,
            status: PayoutStatus.PROCESSING,
          },
          where: { id: payout.id },
        });
      }
    });
  }

  private async ensureSubmitted(
    transaction: Prisma.TransactionClient,
    payout: PayoutRecord,
    status: PayoutProviderStatus,
    request: RequestMetadata,
  ) {
    const existing = await transaction.ledgerTransaction.findUnique({
      where: {
        sourceType_sourceId_type_currency: {
          currency: payout.currency,
          sourceId: payout.id,
          sourceType: 'PAYOUT',
          type: LedgerTransactionType.PAYOUT_SUBMISSION,
        },
      },
    });
    if (!existing) {
      const accounts = await this.accounts(transaction, payout.currency);
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: payout.currency,
          description: 'Owner payable transferred to payout provider clearing',
          entries: {
            create: [
              {
                accountId: accounts(FinancialAccountType.OWNER_PAYABLE),
                amountMinor: payout.amountMinor,
                currency: payout.currency,
                memo: 'Owner payable settled into payout clearing',
              },
              {
                accountId: accounts(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
                amountMinor: -payout.amountMinor,
                currency: payout.currency,
                memo: 'Payout provider clearing liability',
              },
            ],
          },
          sourceId: payout.id,
          sourceType: 'PAYOUT',
          type: LedgerTransactionType.PAYOUT_SUBMISSION,
        },
      });
      await this.event(transaction, payout.id, 'PAYOUT_PROCESSING', {
        amountMinor: payout.amountMinor.toString(),
        destination: payout.destinationMasked,
        ownerProfileId: payout.ownerProfileId,
        payoutId: payout.id,
      });
    }
    await transaction.payoutOperation.updateMany({
      data: {
        completedAt: new Date(),
        providerOperationReference: status.externalPayoutId,
        status: PayoutOperationStatus.SUCCEEDED,
      },
      where: { idempotencyKey: `payout:${payout.id}:submit:v1` },
    });
    await transaction.payout.update({
      data: {
        providerPayoutId: status.externalPayoutId,
        providerState: status.providerState,
        ...(payout.status === PayoutStatus.PAID ? {} : { status: PayoutStatus.PROCESSING }),
        submittedAt: payout.submittedAt ?? new Date(),
      },
      where: { id: payout.id },
    });
  }

  private async finalizePaid(
    transaction: Prisma.TransactionClient,
    payout: PayoutRecord,
    status: PayoutProviderStatus,
    request: RequestMetadata,
  ) {
    if (payout.status === PayoutStatus.PAID) return;
    await this.applyPenaltyAdjustments(transaction, payout, request);
    const accounts = await this.accounts(transaction, payout.currency);
    await transaction.ledgerTransaction.create({
      data: {
        correlationId: request.correlationId ?? null,
        currency: payout.currency,
        description: 'Payout provider confirmed owner settlement',
        entries: {
          create: [
            {
              accountId: accounts(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
              amountMinor: payout.amountMinor,
              currency: payout.currency,
              memo: 'Clear payout provider liability',
            },
            {
              accountId: accounts(FinancialAccountType.PAYOUT_CASH),
              amountMinor: -payout.amountMinor,
              currency: payout.currency,
              memo: 'Payout cash transferred',
            },
          ],
        },
        sourceId: payout.id,
        sourceType: 'PAYOUT',
        type: LedgerTransactionType.PAYOUT_SETTLEMENT,
      },
    });
    await transaction.ownerEarning.updateMany({
      data: { status: OwnerEarningStatus.PAID },
      where: { payoutItems: { some: { activeAllocation: true, payoutId: payout.id } } },
    });
    await transaction.payout.update({
      data: {
        lastProviderRetrievedAt: new Date(),
        paidAt: status.authoritativeAt ?? new Date(),
        providerFeeAmountMinor: status.feeAmountMinor ?? 0n,
        providerPayoutId: status.externalPayoutId,
        providerState: status.providerState,
        reconcileAfter: null,
        reconciliationRequired: false,
        status: PayoutStatus.PAID,
      },
      where: { id: payout.id },
    });
    await this.event(transaction, payout.id, 'PAYOUT_PAID', {
      amountMinor: payout.amountMinor.toString(),
      destination: payout.destinationMasked,
      ownerProfileId: payout.ownerProfileId,
      payoutId: payout.id,
    });
  }

  private async applyPenaltyAdjustments(
    transaction: Prisma.TransactionClient,
    payout: PayoutRecord,
    request: RequestMetadata,
  ) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "owner_profiles" WHERE "id" = ${payout.ownerProfileId}::uuid FOR UPDATE`,
    );
    for (const adjustment of payout.adjustments.filter(({ status }) => status === 'RESERVED')) {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "owner_financial_obligations" WHERE "id" = ${adjustment.sourceId}::uuid FOR UPDATE`,
      );
      const amountMinor = -adjustment.signedAmountMinor;
      const ledgerTransactionId = randomUUID();
      const accounts = await this.accounts(transaction, payout.currency);
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: payout.currency,
          description: 'Owner cancellation penalty recovered from eligible payout',
          entries: {
            create: [
              {
                accountId: accounts(FinancialAccountType.OWNER_PAYABLE),
                amountMinor,
                currency: payout.currency,
                memo: 'Reduce Owner payable',
              },
              {
                accountId: accounts(FinancialAccountType.OWNER_PENALTY_RECEIVABLE),
                amountMinor: -amountMinor,
                currency: payout.currency,
                memo: 'Reduce cancellation penalty receivable',
              },
            ],
          },
          id: ledgerTransactionId,
          sourceId: adjustment.id,
          sourceType: 'PAYOUT_ADJUSTMENT',
          type: LedgerTransactionType.OWNER_PENALTY_RECOVERY,
        },
      });
      await transaction.ownerObligationRecovery.create({
        data: {
          amountMinor,
          currency: payout.currency,
          idempotencyKey: `payout-adjustment:${adjustment.id}:recovery:v1`,
          ledgerTransactionId,
          obligationId: adjustment.sourceId,
          payoutId: payout.id,
        },
      });
      await transaction.payoutAdjustment.update({
        data: { appliedAt: new Date(), ledgerTransactionId, status: 'APPLIED' },
        where: { id: adjustment.id },
      });
    }
  }

  private async finalizeFailed(
    transaction: Prisma.TransactionClient,
    payout: PayoutRecord,
    status: PayoutProviderStatus,
    request: RequestMetadata,
  ) {
    if (
      ([PayoutStatus.FAILED, PayoutStatus.CANCELLED] as readonly PayoutStatus[]).includes(
        payout.status,
      )
    )
      return;
    const submission = await transaction.ledgerTransaction.findUnique({
      where: {
        sourceType_sourceId_type_currency: {
          currency: payout.currency,
          sourceId: payout.id,
          sourceType: 'PAYOUT',
          type: LedgerTransactionType.PAYOUT_SUBMISSION,
        },
      },
    });
    if (submission) {
      const accounts = await this.accounts(transaction, payout.currency);
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: payout.currency,
          description: 'Failed payout restored owner payable',
          entries: {
            create: [
              {
                accountId: accounts(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
                amountMinor: payout.amountMinor,
                currency: payout.currency,
                memo: 'Reverse payout clearing',
              },
              {
                accountId: accounts(FinancialAccountType.OWNER_PAYABLE),
                amountMinor: -payout.amountMinor,
                currency: payout.currency,
                memo: 'Restore owner payable',
              },
            ],
          },
          sourceId: payout.id,
          sourceType: 'PAYOUT',
          type: LedgerTransactionType.PAYOUT_FAILURE_REVERSAL,
        },
      });
    }
    await this.releaseAllocation(transaction, payout, OwnerEarningStatus.AVAILABLE);
    const category = this.failureCategory(status.failureCategory);
    await transaction.payout.update({
      data: {
        failedAt: status.authoritativeAt ?? new Date(),
        failureCategory: category,
        providerPayoutId: status.externalPayoutId,
        providerState: status.providerState,
        reconcileAfter: null,
        reconciliationRequired: false,
        safeFailureCode: status.safeFailureCode ?? null,
        safeFailureMessage: status.safeFailureMessage ?? null,
        status: PayoutStatus.FAILED,
      },
      where: { id: payout.id },
    });
    if (['INVALID_DESTINATION', 'ACCOUNT_CLOSED'].includes(category)) {
      await transaction.ownerPayoutAccount.update({
        data: { isDefault: false, status: PayoutAccountStatus.REQUIRES_ACTION },
        where: { id: payout.payoutAccountId },
      });
      await this.event(transaction, payout.payoutAccountId, 'PAYOUT_ACCOUNT_REQUIRES_ACTION', {
        accountId: payout.payoutAccountId,
        destination: payout.destinationMasked,
        ownerProfileId: payout.ownerProfileId,
      });
    }
    await this.event(transaction, payout.id, 'PAYOUT_FAILED', {
      category,
      destination: payout.destinationMasked,
      ownerProfileId: payout.ownerProfileId,
      payoutId: payout.id,
    });
  }

  private async finalizeReversed(
    transaction: Prisma.TransactionClient,
    payout: PayoutRecord,
    status: PayoutProviderStatus,
    request: RequestMetadata,
  ) {
    if (payout.status === PayoutStatus.REVERSED) return;
    const settlement = await transaction.ledgerTransaction.findUnique({
      where: {
        sourceType_sourceId_type_currency: {
          currency: payout.currency,
          sourceId: payout.id,
          sourceType: 'PAYOUT',
          type: LedgerTransactionType.PAYOUT_SETTLEMENT,
        },
      },
    });
    if (!settlement) throw new Error('Cannot reverse an unsettled payout.');
    const accounts = await this.accounts(transaction, payout.currency);
    await transaction.ledgerTransaction.create({
      data: {
        correlationId: request.correlationId ?? null,
        currency: payout.currency,
        description: 'Provider reversed previously successful payout',
        entries: {
          create: [
            {
              accountId: accounts(FinancialAccountType.PAYOUT_CASH),
              amountMinor: payout.amountMinor,
              currency: payout.currency,
              memo: 'Provider returned payout cash',
            },
            {
              accountId: accounts(FinancialAccountType.OWNER_PAYABLE),
              amountMinor: -payout.amountMinor,
              currency: payout.currency,
              memo: 'Restore owner payable after reversal',
            },
          ],
        },
        sourceId: payout.id,
        sourceType: 'PAYOUT',
        type: LedgerTransactionType.PAYOUT_REVERSAL,
      },
    });
    await this.releaseAllocation(transaction, payout, OwnerEarningStatus.AVAILABLE);
    await transaction.payout.update({
      data: {
        providerState: status.providerState,
        reconcileAfter: null,
        reconciliationRequired: false,
        reversedAt: status.authoritativeAt ?? new Date(),
        status: PayoutStatus.REVERSED,
      },
      where: { id: payout.id },
    });
  }

  private async markUnknown(payoutId: string, error: unknown) {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.payout.update({
        data: {
          reconcileAfter: new Date(Date.now() + this.reconcileDelayMs),
          reconciliationRequired: true,
          safeFailureMessage: 'Provider result is unknown; reconciliation required.',
        },
        where: { id: payoutId },
      });
      await transaction.payoutOperation.updateMany({
        data: {
          attemptCount: { increment: 1 },
          safeFailureMessage:
            error instanceof Error ? error.message.slice(0, 500) : 'Provider result unknown.',
          status: PayoutOperationStatus.UNKNOWN,
        },
        where: { idempotencyKey: `payout:${payoutId}:submit:v1` },
      });
    });
  }

  private async releaseAllocation(
    transaction: Prisma.TransactionClient,
    payout: PayoutRecord,
    earningStatus: OwnerEarningStatus,
  ) {
    await transaction.payoutAdjustment.updateMany({
      data: { releasedAt: new Date(), status: 'RELEASED' },
      where: { payoutId: payout.id, status: 'RESERVED' },
    });
    const earningIds = payout.items
      .filter((item) => item.activeAllocation)
      .map((item) => item.ownerEarningId);
    await transaction.payoutItem.updateMany({
      data: { activeAllocation: false, releasedAt: new Date() },
      where: { activeAllocation: true, payoutId: payout.id },
    });
    if (earningIds.length)
      await transaction.ownerEarning.updateMany({
        data: { status: earningStatus },
        where: { id: { in: earningIds } },
      });
  }

  private async accounts(transaction: Prisma.TransactionClient, currency: string) {
    const accounts = await transaction.financialAccount.findMany({
      where: { active: true, currency },
    });
    return (type: FinancialAccountType) => {
      const account = accounts.find((candidate) => candidate.type === type);
      if (!account) throw new Error(`Financial account ${type} is missing.`);
      return account.id;
    };
  }

  private async adminProjection(payout: PayoutRecord) {
    const ledger = await this.database.client.ledgerTransaction.findMany({
      include: { entries: true },
      orderBy: { postedAt: 'asc' },
      where: { sourceId: payout.id, sourceType: 'PAYOUT' },
    });
    const difference =
      payout.amountMinor -
      payout.items
        .filter((item) => item.activeAllocation)
        .reduce((sum, item) => sum + item.amountMinor, 0n) -
      payout.adjustments
        .filter(({ status }) => status !== 'RELEASED')
        .reduce((sum, item) => sum + item.signedAmountMinor, 0n);
    return {
      ...this.payoutProjection(payout),
      diagnostics: {
        differenceMinor: this.minor(difference),
        lastProviderRetrieval: payout.lastProviderRetrievedAt,
        ledgerBalanced: ledger.every(
          (transaction) =>
            transaction.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n) === 0n,
        ),
        ledgerSettlementStatus: ledger.some(
          (item) => item.type === LedgerTransactionType.PAYOUT_SETTLEMENT,
        )
          ? 'SETTLED'
          : ledger.some((item) => item.type === LedgerTransactionType.PAYOUT_SUBMISSION)
            ? 'CLEARING'
            : 'NOT_POSTED',
        problem:
          difference !== 0n ||
          (payout.status === PayoutStatus.PAID &&
            payout.amountMinor > 0n &&
            !ledger.some((item) => item.type === LedgerTransactionType.PAYOUT_SETTLEMENT)),
        providerReference: payout.providerPayoutId,
      },
    };
  }

  private payoutProjection(payout: PayoutRecord) {
    return {
      amountMinor: this.minor(payout.amountMinor),
      cancellationPenaltyRecoveryMinor: this.minor(
        -payout.adjustments
          .filter(
            ({ type, status }) =>
              type === 'OWNER_CANCELLATION_PENALTY_RECOVERY' && status !== 'RELEASED',
          )
          .reduce((sum, item) => sum + item.signedAmountMinor, 0n),
      ),
      approvedAt: payout.approvedAt,
      batch: payout.batch,
      createdAt: payout.createdAt,
      currency: payout.currency,
      grossEligibleEarningsMinor: this.minor(payout.grossEarningMinor),
      outstandingCancellationPenaltyMinor: this.minor(
        payout.ownerProfile.financialObligations
          .filter(({ currency }) => currency === payout.currency)
          .reduce((sum, item) => sum + item.remainingAmountMinor, 0n),
      ),
      destination: {
        accountHolderName: payout.destinationAccountHolder,
        channel: payout.destinationChannel,
        country: payout.destinationCountry,
        currency: payout.destinationCurrency,
        maskedIdentifier: payout.destinationMasked,
        type: payout.destinationType,
      },
      failedAt: payout.failedAt,
      failureCategory: payout.failureCategory,
      id: payout.id,
      items: payout.items.map((item) => ({
        activeAllocation: item.activeAllocation,
        amountMinor: this.minor(item.amountMinor),
        bookingReference: item.ownerEarning.booking.publicReference,
        earningId: item.ownerEarningId,
      })),
      operations: payout.operations.map((operation) => ({
        attemptCount: operation.attemptCount,
        completedAt: operation.completedAt,
        createdAt: operation.createdAt,
        failureCategory: operation.failureCategory,
        id: operation.id,
        status: operation.status,
        type: operation.type,
      })),
      owner: {
        displayName: payout.ownerProfile.user.profile?.displayName,
        id: payout.ownerProfileId,
      },
      paidAt: payout.paidAt,
      provider: payout.provider,
      providerState: payout.providerState,
      publicReference: payout.publicReference,
      status: payout.status,
      submittedAt: payout.submittedAt,
    };
  }

  private ownerPayoutProjection(payout: PayoutRecord) {
    return {
      adjustmentAmountMinor: this.minor(payout.adjustmentAmountMinor),
      amountMinor: this.minor(payout.amountMinor),
      approvedAt: payout.approvedAt,
      cancellationPenaltyRecoveryMinor: this.minor(
        -payout.adjustments
          .filter(
            ({ type, status }) =>
              type === 'OWNER_CANCELLATION_PENALTY_RECOVERY' && status !== 'RELEASED',
          )
          .reduce((sum, item) => sum + item.signedAmountMinor, 0n),
      ),
      createdAt: payout.createdAt,
      currency: payout.currency,
      destination: {
        channel: payout.destinationChannel,
        maskedIdentifier: payout.destinationMasked,
      },
      failedAt: payout.failedAt,
      grossEligibleEarningsMinor: this.minor(payout.grossEarningMinor),
      id: payout.id,
      includedEarnings: payout.items.map((item) => ({
        amountMinor: this.minor(item.amountMinor),
        bookingReference: item.ownerEarning.booking.publicReference,
        earningId: item.ownerEarningId,
      })),
      paidAt: payout.paidAt,
      publicReference: payout.publicReference,
      status: payout.status,
      submittedAt: payout.submittedAt,
    };
  }

  private accountProjection(account: {
    accountHolderName: string;
    createdAt: Date;
    currency: string;
    destinationChannel: string;
    disabledAt: Date | null;
    id: string;
    isDefault: boolean;
    maskedAccountIdentifier: string;
    provider: PayoutProviderCode;
    status: PayoutAccountStatus;
    type: string;
    validationLevel: string | null;
    verifiedAt: Date | null;
  }) {
    return {
      accountHolderName: account.accountHolderName,
      createdAt: account.createdAt,
      currency: account.currency,
      destinationChannel: account.destinationChannel,
      disabledAt: account.disabledAt,
      id: account.id,
      isDefault: account.isDefault,
      maskedAccountIdentifier: account.maskedAccountIdentifier,
      provider: account.provider,
      status: account.status,
      type: account.type,
      validationLevel: account.validationLevel,
      verifiedAt: account.verifiedAt,
    };
  }

  private ownerPayoutMethodProjection(account: {
    createdAt: Date;
    destinationChannel: string;
    id: string;
    isDefault: boolean;
    maskedAccountIdentifier: string;
    status: PayoutAccountStatus;
    type: string;
    updatedAt: Date;
  }): OwnerPayoutMethodListItem {
    return {
      createdAt: account.createdAt.toISOString(),
      id: account.id,
      institution: payoutMethodInstitution(account.destinationChannel),
      isPrimary: account.isDefault,
      maskedAccountIdentifier: account.maskedAccountIdentifier,
      status: this.ownerPayoutMethodStatus(account.status),
      type: account.type as OwnerPayoutMethodType,
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private ownerPayoutMethodStatus(status: PayoutAccountStatus): OwnerPayoutMethodStatus {
    if (status === PayoutAccountStatus.ACTIVE) return OwnerPayoutMethodStatus.READY;
    if (status === PayoutAccountStatus.PENDING_VERIFICATION)
      return OwnerPayoutMethodStatus.PENDING_VERIFICATION;
    if (status === PayoutAccountStatus.REQUIRES_ACTION)
      return OwnerPayoutMethodStatus.NEEDS_ATTENTION;
    return OwnerPayoutMethodStatus.UNAVAILABLE;
  }

  private async ownerByUser(userId: string) {
    const owner = await this.database.client.ownerProfile.findUnique({
      include: { payoutEligibility: true },
      where: { userId },
    });
    if (!owner) this.notFound('Owner profile was not found.');
    return owner;
  }

  private loadPayout(id: string) {
    return this.database.client.payout
      .findUnique({ include: PAYOUT_INCLUDE, where: { id } })
      .then((payout) => {
        if (!payout) this.notFound('Payout was not found.');
        return payout;
      });
  }

  private earningAmount(earning: {
    additionalCompensationMinor: bigint;
    adjustmentAmountMinor: bigint;
    collectionEarningMinor: bigint;
    deliveryEarningMinor: bigint;
    netEarningAmountMinor: bigint;
  }) {
    return (
      earning.netEarningAmountMinor +
      earning.deliveryEarningMinor +
      earning.collectionEarningMinor +
      earning.additionalCompensationMinor +
      earning.adjustmentAmountMinor
    );
  }

  private providerCode(): PayoutProviderCode {
    return this.provider.code === 'XENDIT' ? PayoutProviderCode.XENDIT : PayoutProviderCode.FAKE;
  }

  private failureCategory(category?: string): PayoutFailureCategory {
    return Object.values(PayoutFailureCategory).includes(category as PayoutFailureCategory)
      ? (category as PayoutFailureCategory)
      : PayoutFailureCategory.UNKNOWN;
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002',
    );
  }

  private reference(prefix: string): string {
    return `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
  }

  private minor(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
      throw new Error('Minor amount exceeds the API safe-integer range.');
    return Number(value);
  }

  private event(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ) {
    return transaction.outboxEvent.create({
      data: { aggregateId, aggregateType: 'PAYOUT', eventType, payload },
    });
  }

  private audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    request: RequestMetadata,
    reason?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return transaction.auditLog.create({
      data: {
        action,
        actorUserId,
        correlationId: request.correlationId ?? null,
        ipAddress: request.ipAddress ?? null,
        ...(metadata ? { metadata } : {}),
        reason: reason ?? null,
        targetId,
        targetType,
      },
    });
  }

  private conflict(code: string, message: string): never {
    throw new ApplicationException(code, message, HttpStatus.CONFLICT);
  }

  private notFound(message: string): never {
    throw new ApplicationException('PAYOUT_NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }
}
