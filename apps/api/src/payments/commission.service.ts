import { HttpStatus, Injectable } from '@nestjs/common';
import { PaymentErrorCode } from '@carrental/api-contracts';
import { CommissionScope, Prisma } from '@carrental/database';
import { AuditService } from '../audit/audit.service';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import type { CreateCommissionRuleDto } from './payments.dto';

@Injectable()
export class CommissionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rules = await this.database.client.commissionRule.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
    return rules.map(project);
  }

  async create(actorUserId: string, input: CreateCommissionRuleDto, request: RequestMetadata) {
    this.validateScope(input);
    const scopeKey = `${input.scope}:${input.ownerProfileId ?? ''}:${input.vehicleCategoryId ?? ''}`;
    const rule = await this.database.client.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${scopeKey}))`,
      );
      const previous = await transaction.commissionRule.findFirst({
        orderBy: { version: 'desc' },
        where: {
          ownerProfileId: input.ownerProfileId ?? null,
          scope: input.scope,
          vehicleCategoryId: input.vehicleCategoryId ?? null,
        },
      });
      return transaction.commissionRule.create({
        data: {
          calculationVersion: 'COMMISSION_BPS_V1',
          createdByUserId: actorUserId,
          currency: 'PHP',
          effectiveFrom: new Date(),
          fixedAmountMinor: BigInt(input.fixedAmountMinor ?? 0),
          maximumAmountMinor:
            input.maximumAmountMinor === undefined ? null : BigInt(input.maximumAmountMinor),
          minimumAmountMinor:
            input.minimumAmountMinor === undefined ? null : BigInt(input.minimumAmountMinor),
          ownerProfileId: input.ownerProfileId ?? null,
          rateBasisPoints: input.rateBasisPoints,
          reason: input.reason,
          scope: input.scope,
          vehicleCategoryId: input.vehicleCategoryId ?? null,
          version: (previous?.version ?? 0) + 1,
        },
      });
    });
    await this.audit.record({
      action: 'COMMISSION_RULE_CREATED',
      actorUserId,
      metadata: { scope: input.scope, version: rule.version },
      reason: input.reason,
      request,
      targetId: rule.id,
      targetType: 'CommissionRule',
    });
    return project(rule);
  }

  async disable(actorUserId: string, id: string, reason: string, request: RequestMetadata) {
    const current = await this.database.client.commissionRule.findUnique({ where: { id } });
    if (!current)
      throw new ApplicationException(
        PaymentErrorCode.PAYMENT_NOT_FOUND,
        'Commission rule was not found.',
        HttpStatus.NOT_FOUND,
      );
    const rule = current.disabledAt
      ? current
      : await this.database.client.commissionRule.update({
          data: { disabledAt: new Date() },
          where: { id },
        });
    await this.audit.record({
      action: 'COMMISSION_RULE_DISABLED',
      actorUserId,
      reason,
      request,
      targetId: id,
      targetType: 'CommissionRule',
    });
    return project(rule);
  }

  private validateScope(input: CreateCommissionRuleDto): void {
    const valid =
      (input.scope === CommissionScope.PLATFORM_DEFAULT &&
        !input.ownerProfileId &&
        !input.vehicleCategoryId) ||
      (input.scope === CommissionScope.OWNER &&
        Boolean(input.ownerProfileId) &&
        !input.vehicleCategoryId) ||
      (input.scope === CommissionScope.VEHICLE_CATEGORY &&
        Boolean(input.vehicleCategoryId) &&
        !input.ownerProfileId);
    if (!valid)
      throw new ApplicationException(
        PaymentErrorCode.PAYMENT_CONFIGURATION_INVALID,
        'Commission rule target does not match its scope.',
        HttpStatus.BAD_REQUEST,
      );
    if (
      input.minimumAmountMinor !== undefined &&
      input.maximumAmountMinor !== undefined &&
      input.minimumAmountMinor > input.maximumAmountMinor
    ) {
      throw new ApplicationException(
        PaymentErrorCode.PAYMENT_CONFIGURATION_INVALID,
        'Commission minimum cannot exceed maximum.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

function project(rule: {
  fixedAmountMinor: bigint;
  minimumAmountMinor: bigint | null;
  maximumAmountMinor: bigint | null;
  [key: string]: unknown;
}) {
  return {
    ...rule,
    fixedAmountMinor: Number(rule.fixedAmountMinor),
    maximumAmountMinor: rule.maximumAmountMinor === null ? null : Number(rule.maximumAmountMinor),
    minimumAmountMinor: rule.minimumAmountMinor === null ? null : Number(rule.minimumAmountMinor),
  };
}
