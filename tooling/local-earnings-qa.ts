import argon2 from '../packages/database/node_modules/argon2';
import { config } from '../packages/database/node_modules/dotenv';
import { resolve } from 'node:path';
import {
  FinancialAccountType,
  LedgerTransactionType,
  Prisma,
  type PrismaClient,
  createDatabaseClient,
} from '../packages/database/src/index';

config({ path: resolve(__dirname, '../.env') });

const EMAIL = 'earnings.qa@demo.carrental.ph';
const PASSWORD = 'CarRentalDemo2026!';
const CURRENCY = 'PHP';
const PREFIX = 'EARNINGS-QA';
const ID = {
  user: 'e1000000-0000-4000-8000-000000000001',
  profile: 'e1000000-0000-4000-8000-000000000002',
  owner: 'e1000000-0000-4000-8000-000000000003',
  vehicle: 'e1000000-0000-4000-8000-000000000004',
  policy: 'e1000000-0000-4000-8000-000000000005',
  payoutAccount: 'e1000000-0000-4000-8000-000000000006',
  eligibility: 'e1000000-0000-4000-8000-000000000007',
  rule: 'e1000000-0000-4000-8000-000000000008',
  upcomingBatch: 'e1000000-0000-4000-8000-000000000009',
  upcomingPayout: 'e1000000-0000-4000-8000-000000000010',
  paidBatch: 'e1000000-0000-4000-8000-000000000011',
  paidPayout: 'e1000000-0000-4000-8000-000000000012',
} as const;

const scenarios = [
  { key: 'AVAILABLE', net: 357_500n, compensation: 0n, status: 'AVAILABLE' },
  { key: 'UPCOMING', net: 892_500n, compensation: 0n, status: 'AVAILABLE' },
  { key: 'PENDING', net: 245_000n, compensation: 75_000n, status: 'PENDING' },
  { key: 'HELD', net: 50_000n, compensation: 0n, status: 'HELD' },
  { key: 'PAID', net: 600_000n, compensation: 0n, status: 'PAID' },
  { key: 'REVERSAL', net: 100_000n, compensation: 0n, status: 'REVERSED' },
  { key: 'PENALTY', net: 50_000n, compensation: 0n, status: 'REVERSED' },
] as const;

function scenarioId(index: number, offset: number) {
  return `e${offset.toString(16).padStart(3, '0')}0000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function requireLocalDatabase(url: string) {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname))
    throw new Error(`Refusing non-local database host: ${parsed.hostname}`);
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development')
    throw new Error(`Refusing NODE_ENV=${process.env.NODE_ENV}; development is required.`);
}

async function accounts(tx: Prisma.TransactionClient) {
  const rows = await tx.financialAccount.findMany({
    where: {
      active: true,
      currency: CURRENCY,
      type: {
        in: [
          FinancialAccountType.CUSTOMER_FUNDS_HELD,
          FinancialAccountType.OWNER_PAYABLE,
          FinancialAccountType.OWNER_PENALTY_RECEIVABLE,
          FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE,
          FinancialAccountType.PAYOUT_CASH,
          FinancialAccountType.PAYOUT_PROVIDER_CLEARING,
          FinancialAccountType.PLATFORM_CANCELLATION_REVENUE,
          FinancialAccountType.PLATFORM_COMMISSION_REVENUE,
        ],
      },
    },
  });
  const byType = new Map(rows.map((row) => [row.type, row.id]));
  return (type: FinancialAccountType) => {
    const id = byType.get(type);
    if (!id) throw new Error(`Required ${CURRENCY} account ${type} is missing.`);
    return id;
  };
}

async function setup(client: PrismaClient) {
  const existing = await client.user.findUnique({ where: { normalizedEmail: EMAIL } });
  if (existing) {
    console.log('QA fixture already exists; verifying without writing.');
    await audit(client);
    return;
  }
  const renter = await client.user.findFirst({
    where: { normalizedEmail: 'renter@demo.carrental.ph', status: 'ACTIVE' },
  });
  const ownerRole = await client.role.findUnique({ where: { code: 'OWNER' } });
  if (!renter || !ownerRole)
    throw new Error('Required local demo renter or OWNER role is missing.');
  const passwordHash = await argon2.hash(PASSWORD, {
    memoryCost: 19_456,
    parallelism: 1,
    timeCost: 2,
    type: argon2.argon2id,
  });
  const now = new Date('2026-10-03T04:00:00.000Z');

  await client.$transaction(
    async (tx) => {
      const account = await accounts(tx);
      await tx.user.create({
        data: {
          email: EMAIL,
          emailVerifiedAt: now,
          id: ID.user,
          normalizedEmail: EMAIL,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      await tx.userProfile.create({
        data: {
          displayName: 'Earnings QA Owner',
          firstName: 'Earnings QA',
          id: ID.profile,
          lastName: 'Owner',
          userId: ID.user,
        },
      });
      await tx.userRole.create({ data: { roleId: ownerRole.id, userId: ID.user } });
      await tx.ownerProfile.create({
        data: {
          id: ID.owner,
          legalName: 'Earnings QA Owner',
          publicReference: 'EARNINGS-QA-OWNER',
          status: 'VERIFIED',
          submittedAt: now,
          userId: ID.user,
          verifiedAt: now,
        },
      });
      await tx.payoutEligibility.create({
        data: {
          id: ID.eligibility,
          lastEvaluatedAt: now,
          ownerProfileId: ID.owner,
          reason: 'Local Earnings visual QA fixture',
          requirements: {},
          status: 'ELIGIBLE',
        },
      });
      await tx.ownerPayoutAccount.create({
        data: {
          accountHolderName: 'Earnings QA Owner',
          createdByUserId: ID.user,
          currency: CURRENCY,
          destinationChannel: 'BPI',
          encryptedAccountIdentifier: 'local-demo-only-not-real',
          encryptionAuthTag: 'local-demo-auth-tag',
          encryptionIv: 'local-demo-iv',
          id: ID.payoutAccount,
          identifierFingerprint: 'e'.repeat(64),
          isDefault: true,
          maskedAccountIdentifier: '••••1234',
          ownerProfileId: ID.owner,
          provider: 'FAKE',
          status: 'ACTIVE',
          type: 'BANK_ACCOUNT',
          validationLevel: 'LOCAL_DEMO',
          verifiedAt: now,
        },
      });
      await tx.vehicle.create({
        data: {
          approvedAt: now,
          id: ID.vehicle,
          make: 'Honda',
          model: 'City',
          modelYear: 2024,
          operationalStatus: 'AVAILABLE',
          ownerProfileId: ID.owner,
          ownerUserId: ID.user,
          status: 'APPROVED',
        },
      });
      await tx.vehiclePolicyVersion.create({
        data: {
          createdByUserId: ID.user,
          currency: CURRENCY,
          dailyRateMinor: 250_000,
          id: ID.policy,
          includedKilometersPerDay: 150,
          maximumRentalDays: 30,
          mileagePolicy: 'LIMITED',
          minimumRentalDays: 1,
          supportsRenterPickup: true,
          supportsRenterReturn: true,
          vehicleId: ID.vehicle,
          version: 1,
        },
      });
      await tx.commissionRule.create({
        data: {
          calculationVersion: 'COMMISSION_BPS_V1',
          createdByUserId: ID.user,
          currency: CURRENCY,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          id: ID.rule,
          ownerProfileId: ID.owner,
          rateBasisPoints: 1500,
          reason: 'Local Earnings QA fixture',
          scope: 'OWNER',
          version: 1,
        },
      });

      for (const [index, scenario] of scenarios.entries()) {
        const quoteId = scenarioId(index, 10);
        const bookingId = scenarioId(index, 20);
        const paymentId = scenarioId(index, 30);
        const earningId = scenarioId(index, 40);
        const total = scenario.net + scenario.compensation;
        const commission = (scenario.net * 15n) / 85n;
        const gross = scenario.key === 'PENALTY' ? 50_000n : scenario.net + commission;
        const rentalStart = new Date(Date.UTC(2026, 7, 1 + index * 3, 1));
        const rentalEnd = new Date(Date.UTC(2026, 7, 3 + index * 3, 1));
        await tx.pricingQuote.create({
          data: {
            baseRentalAmountMinor: Number(gross),
            chargeableDays: 2,
            currency: CURRENCY,
            discountedRentalSubtotalMinor: Number(gross),
            expiresAt: new Date('2027-01-01T00:00:00.000Z'),
            excessKilometerRateMinor: 1_500,
            id: quoteId,
            includedMileageKm: 300,
            policyVersionId: ID.policy,
            pricingEngineVersion: 'EARNINGS_QA_V1',
            rentalEnd,
            rentalStart,
            renterUserId: renter.id,
            subtotalMinor: Number(gross),
            totalMinor: Number(gross),
            turnaroundMinutes: 120,
            unlimitedMileage: false,
            vehicleId: ID.vehicle,
            vehicleTimezone: 'Asia/Manila',
          },
        });
        await tx.booking.create({
          data: {
            handoverWorkflowVersion: null,
            id: bookingId,
            ownerProfileId: ID.owner,
            ownerUserId: ID.user,
            publicReference: `${PREFIX}-${scenario.key}`,
            quoteId,
            rentalEnd,
            rentalStart,
            renterUserId: renter.id,
            status: scenario.key === 'PENALTY' ? 'CANCELLED' : 'COMPLETED',
            vehicleId: ID.vehicle,
          },
        });
        await tx.payment.create({
          data: {
            amountMinor: gross,
            authorizedAmountMinor: gross,
            authorizedAt: rentalStart,
            bookingId,
            capturedAmountMinor: gross,
            capturedAt: rentalStart,
            currency: CURRENCY,
            externalPaymentId: `earnings-qa-${scenario.key.toLowerCase()}`,
            id: paymentId,
            provider: 'FAKE',
            providerRequestReference: `earnings-qa-${scenario.key.toLowerCase()}`,
            providerState: 'CAPTURED',
            purpose: 'RENTAL',
            status: 'CAPTURED',
          },
        });
        await tx.ledgerTransaction.create({
          data: {
            currency: CURRENCY,
            description: `${scenario.key} local QA capture`,
            entries: {
              create: [
                {
                  accountId: account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
                  amountMinor: gross,
                  currency: CURRENCY,
                },
                {
                  accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
                  amountMinor: -gross,
                  currency: CURRENCY,
                },
              ],
            },
            id: scenarioId(index, 50),
            sourceId: paymentId,
            sourceType: 'PAYMENT',
            type: LedgerTransactionType.CAPTURE_RECOGNITION,
          },
        });
        if (scenario.key !== 'PENALTY') {
          await tx.ownerEarning.create({
            data: {
              additionalCompensationMinor: scenario.compensation,
              availableAt: scenario.status === 'AVAILABLE' ? rentalEnd : null,
              bookingId,
              commissionAmountMinor: commission,
              currency: CURRENCY,
              grossRentalAmountMinor: gross,
              id: earningId,
              lastFinancialResolutionAt: scenario.key === 'REVERSAL' ? now : null,
              netEarningAmountMinor: scenario.net,
              ownerProfileId: ID.owner,
              paymentId,
              status: scenario.key === 'PAID' ? 'AVAILABLE' : scenario.status,
            },
          });
          await tx.ledgerTransaction.create({
            data: {
              currency: CURRENCY,
              description: `${scenario.key} local QA earning allocation`,
              entries: {
                create: [
                  {
                    accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
                    amountMinor: gross,
                    currency: CURRENCY,
                  },
                  {
                    accountId: account(FinancialAccountType.OWNER_PAYABLE),
                    amountMinor: -scenario.net,
                    currency: CURRENCY,
                  },
                  {
                    accountId: account(FinancialAccountType.PLATFORM_COMMISSION_REVENUE),
                    amountMinor: -commission,
                    currency: CURRENCY,
                  },
                ],
              },
              id: scenarioId(index, 60),
              sourceId: earningId,
              sourceType: 'OWNER_EARNING',
              type: LedgerTransactionType.CAPTURE_ALLOCATION,
            },
          });
          if (scenario.compensation) {
            await tx.ledgerTransaction.create({
              data: {
                currency: CURRENCY,
                description: 'Local QA owner compensation',
                entries: {
                  create: [
                    {
                      accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
                      amountMinor: scenario.compensation,
                      currency: CURRENCY,
                    },
                    {
                      accountId: account(FinancialAccountType.OWNER_PAYABLE),
                      amountMinor: -scenario.compensation,
                      currency: CURRENCY,
                    },
                  ],
                },
                id: scenarioId(index, 70),
                sourceId: earningId,
                sourceType: 'OWNER_EARNING_COMPENSATION',
                type: LedgerTransactionType.ADJUSTMENT,
              },
            });
          }
          if (scenario.key === 'REVERSAL') {
            await tx.ledgerTransaction.create({
              data: {
                currency: CURRENCY,
                description: 'Local QA nonzero earning reversal',
                entries: {
                  create: [
                    {
                      accountId: account(FinancialAccountType.OWNER_PAYABLE),
                      amountMinor: scenario.net,
                      currency: CURRENCY,
                    },
                    {
                      accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
                      amountMinor: -scenario.net,
                      currency: CURRENCY,
                    },
                  ],
                },
                id: scenarioId(index, 80),
                sourceId: earningId,
                sourceType: 'OWNER_EARNING',
                type: LedgerTransactionType.REVERSAL,
              },
            });
          }
          if (scenario.key === 'HELD') {
            await tx.earningHold.create({
              data: {
                amountMinor: total,
                createdByUserId: ID.user,
                currency: CURRENCY,
                id: scenarioId(index, 90),
                mode: 'FULL',
                ownerEarningId: earningId,
                rationale: 'Local Earnings QA administrative review hold',
                reason: 'ADMIN_REVIEW',
                status: 'ACTIVE',
              },
            });
          }
        }
      }

      await createPayout(
        tx,
        account,
        'UPCOMING',
        ID.upcomingBatch,
        ID.upcomingPayout,
        scenarioId(1, 40),
        892_500n,
        now,
      );
      await createPayout(
        tx,
        account,
        'PAID',
        ID.paidBatch,
        ID.paidPayout,
        scenarioId(4, 40),
        600_000n,
        now,
      );

      const penaltyIndex = 6;
      const penaltyBookingId = scenarioId(penaltyIndex, 20);
      const penaltyPaymentId = scenarioId(penaltyIndex, 30);
      const cancellationId = scenarioId(penaltyIndex, 100);
      const snapshotId = scenarioId(penaltyIndex, 110);
      const settlementId = scenarioId(penaltyIndex, 120);
      const obligationId = scenarioId(penaltyIndex, 130);
      await tx.commissionSnapshot.create({
        data: {
          bookingId: penaltyBookingId,
          calculatedCommissionMinor: 50_000n,
          calculationVersion: 'COMMISSION_BPS_V1',
          commissionableBaseMinor: 50_000n,
          currency: CURRENCY,
          fixedAmountMinor: 0n,
          id: snapshotId,
          paymentId: penaltyPaymentId,
          rateBasisPoints: 1500,
          ruleId: ID.rule,
          ruleVersion: 1,
          scope: 'OWNER',
        },
      });
      await tx.bookingCancellation.create({
        data: {
          actorType: 'USER',
          actorUserId: ID.user,
          bookingId: penaltyBookingId,
          correlationId: 'earnings-qa-penalty',
          id: cancellationId,
          reasonCode: 'VEHICLE_UNAVAILABLE',
          reasonText: 'Local Earnings QA owner cancellation penalty',
        },
      });
      await tx.bookingCancellationSettlement.create({
        data: {
          actorType: 'OWNER',
          bookingCancellationId: cancellationId,
          bookingId: penaltyBookingId,
          calculationVersion: 'CANCELLATION_V1',
          capturedAmountMinor: 50_000n,
          collectionFeeMinor: 0n,
          collectionRefundedMinor: 0n,
          commissionRetainedMinor: 50_000n,
          commissionSnapshotId: snapshotId,
          confirmedAt: now,
          currency: CURRENCY,
          deliveryCompleted: false,
          deliveryCompletionBasis: 'NOT_STARTED',
          deliveryFeeMinor: 0n,
          deliveryRefundedMinor: 0n,
          deliveryRetainedMinor: 0n,
          fulfillmentTreatment: {},
          id: settlementId,
          evaluatedAt: now,
          nonRefundableRentalMinor: 50_000n,
          ownerEarningForfeitedMinor: 0n,
          paymentDisposition: 'NO_REFUND',
          paymentId: penaltyPaymentId,
          policyCode: 'ADVANCE_FINAL_72H_NON_REFUNDABLE',
          policyVersion: 'OWNER_CANCELLATION_V1',
          previewVersion: 'CANCELLATION_PREVIEW_V1',
          refundAmountMinor: 0n,
          rentalComponentMinor: 50_000n,
          responsibility: 'OWNER',
          scheduledPickupAt: now,
          structuredReason: 'VEHICLE_UNAVAILABLE',
        },
      });
      await tx.ownerFinancialObligation.create({
        data: {
          auditMetadata: { fixture: PREFIX },
          cancellationSettlementId: settlementId,
          commissionSnapshotId: snapshotId,
          currency: CURRENCY,
          effectiveAt: now,
          id: obligationId,
          originalAmountMinor: 50_000n,
          ownerProfileId: ID.owner,
          policyVersion: 'OWNER_CANCELLATION_V1',
          reasonCode: 'VEHICLE_UNAVAILABLE',
          remainingAmountMinor: 50_000n,
          sourceCancellationId: cancellationId,
          status: 'OUTSTANDING',
          type: 'CANCELLATION_PENALTY',
        },
      });
      await tx.ledgerTransaction.create({
        data: {
          correlationId: 'earnings-qa-penalty',
          currency: CURRENCY,
          description: 'Local QA owner cancellation penalty recognized',
          entries: {
            create: [
              {
                accountId: account(FinancialAccountType.OWNER_PENALTY_RECEIVABLE),
                amountMinor: 50_000n,
                currency: CURRENCY,
              },
              {
                accountId: account(FinancialAccountType.PLATFORM_CANCELLATION_REVENUE),
                amountMinor: -50_000n,
                currency: CURRENCY,
              },
            ],
          },
          id: scenarioId(penaltyIndex, 140),
          sourceId: obligationId,
          sourceType: 'OWNER_FINANCIAL_OBLIGATION',
          type: LedgerTransactionType.OWNER_PENALTY_RECOGNITION,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  console.log(`Created ${EMAIL}. Password: ${PASSWORD}`);
  await audit(client);
}

async function createPayout(
  tx: Prisma.TransactionClient,
  account: (type: FinancialAccountType) => string,
  kind: 'UPCOMING' | 'PAID',
  batchId: string,
  payoutId: string,
  earningId: string,
  amount: bigint,
  now: Date,
) {
  const paid = kind === 'PAID';
  await tx.payoutBatch.create({
    data: {
      createdByUserId: ID.user,
      currency: CURRENCY,
      id: batchId,
      publicReference: `${PREFIX}-BATCH-${kind}`,
      status: paid ? 'COMPLETED' : 'IN_PROGRESS',
    },
  });
  await tx.payout.create({
    data: {
      amountMinor: amount,
      approvedAt: now,
      approvedByUserId: ID.user,
      batchId,
      createdByUserId: ID.user,
      currency: CURRENCY,
      destinationAccountHolder: 'Earnings QA Owner',
      destinationChannel: 'BPI',
      destinationCurrency: CURRENCY,
      destinationMasked: '••••1234',
      destinationType: 'BANK_ACCOUNT',
      grossEarningMinor: amount,
      id: payoutId,
      lastProviderRetrievedAt: paid ? now : null,
      ownerProfileId: ID.owner,
      paidAt: paid ? now : null,
      payoutAccountId: ID.payoutAccount,
      provider: 'FAKE',
      providerPayoutId: `earnings-qa-${kind.toLowerCase()}`,
      providerState: paid ? 'PAID' : 'PROCESSING',
      publicReference: `${PREFIX}-PAYOUT-${kind}`,
      reconciliationRequired: !paid,
      status: paid ? 'PAID' : 'PROCESSING',
      submittedAt: now,
    },
  });
  await tx.payoutItem.create({
    data: {
      activeAllocation: true,
      amountMinor: amount,
      currency: CURRENCY,
      id: kind === 'PAID' ? scenarioId(4, 150) : scenarioId(1, 150),
      ownerEarningId: earningId,
      payoutId,
    },
  });
  if (paid) await tx.ownerEarning.update({ data: { status: 'PAID' }, where: { id: earningId } });
  await tx.ledgerTransaction.create({
    data: {
      currency: CURRENCY,
      description: `Local QA ${kind.toLowerCase()} payout submission`,
      entries: {
        create: [
          {
            accountId: account(FinancialAccountType.OWNER_PAYABLE),
            amountMinor: amount,
            currency: CURRENCY,
          },
          {
            accountId: account(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
            amountMinor: -amount,
            currency: CURRENCY,
          },
        ],
      },
      id: kind === 'PAID' ? scenarioId(4, 160) : scenarioId(1, 160),
      sourceId: payoutId,
      sourceType: 'PAYOUT',
      type: LedgerTransactionType.PAYOUT_SUBMISSION,
    },
  });
  if (paid)
    await tx.ledgerTransaction.create({
      data: {
        currency: CURRENCY,
        description: 'Local QA paid payout settlement',
        entries: {
          create: [
            {
              accountId: account(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
              amountMinor: amount,
              currency: CURRENCY,
            },
            {
              accountId: account(FinancialAccountType.PAYOUT_CASH),
              amountMinor: -amount,
              currency: CURRENCY,
            },
          ],
        },
        id: scenarioId(4, 170),
        sourceId: payoutId,
        sourceType: 'PAYOUT',
        type: LedgerTransactionType.PAYOUT_SETTLEMENT,
      },
    });
}

async function audit(client: PrismaClient) {
  const owner = await client.ownerProfile.findUnique({ where: { userId: ID.user } });
  if (!owner) throw new Error('QA Owner fixture is not installed.');
  const earnings = await client.ownerEarning.findMany({
    include: {
      holds: { where: { status: 'ACTIVE' } },
      payoutItems: { where: { activeAllocation: true } },
    },
    orderBy: { createdAt: 'asc' },
    where: { ownerProfileId: owner.id },
  });
  const total = (earning: (typeof earnings)[number]) =>
    earning.netEarningAmountMinor +
    earning.deliveryEarningMinor +
    earning.collectionEarningMinor +
    earning.additionalCompensationMinor +
    earning.adjustmentAmountMinor;
  const activeHolds = (earning: (typeof earnings)[number]) =>
    earning.holds.reduce((sum, hold) => sum + hold.amountMinor, 0n);
  const available = earnings
    .filter((e) => e.status === 'AVAILABLE')
    .reduce((sum, e) => sum + total(e) - activeHolds(e), 0n);
  const pending = earnings
    .filter((e) => e.status === 'PENDING' || e.status === 'HELD')
    .reduce((sum, e) => sum + total(e) - activeHolds(e), 0n);
  const held = earnings.reduce((sum, e) => sum + activeHolds(e), 0n);
  const payoutReady = earnings
    .filter((e) => e.status === 'AVAILABLE' && !e.holds.length && !e.payoutItems.length)
    .reduce((sum, e) => sum + total(e), 0n);
  if (earnings.some((e) => total(e) < 0n || activeHolds(e) > total(e)))
    throw new Error('QA earning authority is inconsistent.');
  const imbalanced = await client.$queryRaw<Array<{ id: string; balance: bigint }>>(Prisma.sql`
    SELECT t.id, COALESCE(SUM(e.amount_minor), 0)::bigint balance
    FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
    WHERE t.correlation_id = 'earnings-qa-penalty'
       OR t.source_id = ANY(ARRAY[${Prisma.join([...scenarios.map((_, i) => scenarioId(i, 30)), ...scenarios.slice(0, 6).map((_, i) => scenarioId(i, 40)), ID.upcomingPayout, ID.paidPayout])}]::uuid[])
    GROUP BY t.id HAVING SUM(e.amount_minor) <> 0
  `);
  if (imbalanced.length)
    throw new Error(
      `Unbalanced QA ledger transactions: ${imbalanced.map(({ id }) => id).join(', ')}`,
    );
  const upcoming = await client.payout.findUnique({ where: { id: ID.upcomingPayout } });
  const paid = await client.payout.findUnique({ where: { id: ID.paidPayout } });
  const obligation = await client.ownerFinancialObligation.findFirst({
    where: { ownerProfileId: owner.id },
  });
  console.log(
    JSON.stringify(
      {
        activity: {
          adjustments: {
            compensationMinor: '75000',
            penaltyMinor: '-50000',
            reversalMinor: '-100000',
          },
          paid: paid && {
            amountMinor: paid.amountMinor.toString(),
            reference: paid.publicReference,
            status: paid.status,
          },
          upcoming: upcoming && {
            amountMinor: upcoming.amountMinor.toString(),
            reference: upcoming.publicReference,
            status: upcoming.status,
          },
        },
        identity: { email: EMAIL, ownerProfileId: owner.id, password: PASSWORD },
        penalty: obligation && {
          amountMinor: obligation.originalAmountMinor.toString(),
          status: obligation.status,
        },
        summary: {
          availableMinor: available.toString(),
          currency: CURRENCY,
          heldMinor: held.toString(),
          payoutReadyMinor: payoutReady.toString(),
          pendingMinor: pending.toString(),
          upcomingPayoutMinor: upcoming?.amountMinor.toString() ?? null,
        },
      },
      null,
      2,
    ),
  );
}

async function cleanup(client: PrismaClient, dryRun: boolean) {
  const owner = await client.ownerProfile.findUnique({ where: { userId: ID.user } });
  const counts = owner
    ? {
        bookings: await client.booking.count({ where: { ownerProfileId: owner.id } }),
        earnings: await client.ownerEarning.count({ where: { ownerProfileId: owner.id } }),
        payouts: await client.payout.count({ where: { ownerProfileId: owner.id } }),
      }
    : { bookings: 0, earnings: 0, payouts: 0 };
  console.log(
    JSON.stringify({ dryRun, email: EMAIL, ownerProfileId: owner?.id ?? null, ...counts }, null, 2),
  );
  if (dryRun || !owner) return;
  await client.$transaction(
    async (tx) => {
      const bookingIds = (
        await tx.booking.findMany({ select: { id: true }, where: { ownerProfileId: owner.id } })
      ).map(({ id }) => id);
      const paymentIds = (
        await tx.payment.findMany({
          select: { id: true },
          where: { bookingId: { in: bookingIds } },
        })
      ).map(({ id }) => id);
      const earningIds = (
        await tx.ownerEarning.findMany({
          select: { id: true },
          where: { ownerProfileId: owner.id },
        })
      ).map(({ id }) => id);
      const payoutIds = (
        await tx.payout.findMany({ select: { id: true }, where: { ownerProfileId: owner.id } })
      ).map(({ id }) => id);
      const obligationIds = (
        await tx.ownerFinancialObligation.findMany({
          select: { id: true },
          where: { ownerProfileId: owner.id },
        })
      ).map(({ id }) => id);
      const ledgerIds = (
        await tx.ledgerTransaction.findMany({
          select: { id: true },
          where: {
            OR: [
              { sourceId: { in: [...paymentIds, ...earningIds, ...payoutIds, ...obligationIds] } },
              { correlationId: 'earnings-qa-penalty' },
            ],
          },
        })
      ).map(({ id }) => id);
      await tx.ledgerEntry.deleteMany({ where: { transactionId: { in: ledgerIds } } });
      await tx.ledgerTransaction.deleteMany({ where: { id: { in: ledgerIds } } });
      await tx.payoutItem.deleteMany({ where: { payoutId: { in: payoutIds } } });
      await tx.payout.deleteMany({ where: { id: { in: payoutIds } } });
      await tx.payoutBatch.deleteMany({ where: { id: { in: [ID.upcomingBatch, ID.paidBatch] } } });
      await tx.earningHold.deleteMany({ where: { ownerEarningId: { in: earningIds } } });
      await tx.ownerFinancialObligation.deleteMany({ where: { id: { in: obligationIds } } });
      await tx.bookingCancellationSettlement.deleteMany({
        where: { bookingId: { in: bookingIds } },
      });
      await tx.bookingCancellation.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.ownerEarning.deleteMany({ where: { id: { in: earningIds } } });
      await tx.commissionSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await tx.pricingQuote.deleteMany({
        where: { id: { in: scenarios.map((_, i) => scenarioId(i, 10)) } },
      });
      await tx.vehiclePolicyVersion.deleteMany({ where: { id: ID.policy } });
      await tx.vehicle.deleteMany({ where: { id: ID.vehicle } });
      await tx.commissionRule.deleteMany({ where: { id: ID.rule } });
      await tx.ownerPayoutAccount.deleteMany({ where: { id: ID.payoutAccount } });
      await tx.payoutEligibility.deleteMany({ where: { id: ID.eligibility } });
      await tx.ownerProfile.delete({ where: { id: ID.owner } });
      await tx.userProfile.deleteMany({ where: { userId: ID.user } });
      await tx.userRole.deleteMany({ where: { userId: ID.user } });
      await tx.user.delete({ where: { id: ID.user } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  console.log('QA fixture removed.');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  requireLocalDatabase(databaseUrl);
  const client = createDatabaseClient(databaseUrl);
  const command = process.argv[2] ?? 'audit';
  try {
    if (command === 'setup') await setup(client);
    else if (command === 'audit') await audit(client);
    else if (command === 'cleanup') await cleanup(client, process.argv.includes('--dry-run'));
    else throw new Error('Usage: local-earnings-qa.ts <setup|audit|cleanup [--dry-run]>');
  } finally {
    await client.$disconnect();
  }
}

void main();
