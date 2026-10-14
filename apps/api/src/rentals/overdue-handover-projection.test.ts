import { describe, expect, it, vi } from 'vitest';
import { BookingStatus, HandoverPhase } from '@carrental/database';
import {
  currentOverdueHandoverRecovery,
  normalHandoverRequiresRecovery,
  overdueRecoveryAttribution,
  RentalsService,
} from './rentals.service';

describe('overdue handover recovery projection', () => {
  it('projects the unresolved recovery used by the mobile post-submit state', () => {
    const accepted = { acceptance: { acceptedAt: '2026-10-09T00:00:00.000Z' }, id: 'accepted' };
    const pending = { acceptance: null, id: 'pending' };

    expect(currentOverdueHandoverRecovery([accepted, pending])).toBe(pending);
  });

  it('keeps a disputed recovery current until Operations resolves it', () => {
    const disputed = { acceptance: null, id: 'disputed', response: { decision: 'DISPUTED' } };

    expect(currentOverdueHandoverRecovery([disputed])).toBe(disputed);
  });

  it('retains the latest accepted recovery as historical context', () => {
    const accepted = { acceptance: { acceptedAt: '2026-10-10T00:00:00.000Z' }, id: 'accepted' };

    expect(currentOverdueHandoverRecovery([accepted])).toBe(accepted);
    expect(currentOverdueHandoverRecovery([])).toBeNull();
  });

  it('keeps the Owner of record separate from a delegated recovery actor', () => {
    expect(overdueRecoveryAttribution('owner-user', 'owner-user')).toEqual({
      historyActorUserId: 'owner-user',
      reportedByUserId: 'owner-user',
    });
    expect(overdueRecoveryAttribution('owner-user', 'manager-user')).toEqual({
      historyActorUserId: 'manager-user',
      reportedByUserId: 'owner-user',
    });
  });

  it('uses the existing pickup window end as the normal-to-recovery boundary', () => {
    const booking = {
      actualPickupAt: null,
      actualReturnAt: null,
      pickupWindowEnd: new Date('2026-10-10T10:00:00.000Z'),
      rentalEnd: new Date('2026-10-11T10:00:00.000Z'),
      status: BookingStatus.READY_FOR_PICKUP,
    };

    expect(
      normalHandoverRequiresRecovery(
        booking,
        HandoverPhase.START,
        120,
        new Date('2026-10-10T10:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      normalHandoverRequiresRecovery(
        booking,
        HandoverPhase.START,
        120,
        new Date('2026-10-10T10:00:00.001Z'),
      ),
    ).toBe(true);
  });

  it('uses the configured return grace boundary for every actor path', () => {
    const booking = {
      actualPickupAt: new Date('2026-10-10T10:00:00.000Z'),
      actualReturnAt: null,
      pickupWindowEnd: new Date('2026-10-10T10:30:00.000Z'),
      rentalEnd: new Date('2026-10-11T10:00:00.000Z'),
      status: BookingStatus.RETURN_PENDING,
    };

    expect(
      normalHandoverRequiresRecovery(
        booking,
        HandoverPhase.RETURN,
        120,
        new Date('2026-10-11T12:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      normalHandoverRequiresRecovery(
        booking,
        HandoverPhase.RETURN,
        120,
        new Date('2026-10-11T12:00:00.001Z'),
      ),
    ).toBe(true);
  });

  it('does not require recovery after custody is authoritatively recorded', () => {
    expect(
      normalHandoverRequiresRecovery(
        {
          actualPickupAt: new Date('2026-10-10T09:30:00.000Z'),
          actualReturnAt: null,
          pickupWindowEnd: new Date('2026-10-10T10:00:00.000Z'),
          rentalEnd: new Date('2026-10-11T10:00:00.000Z'),
          status: BookingStatus.ACTIVE,
        },
        HandoverPhase.START,
        120,
        new Date('2026-10-12T10:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('rejects a direct normal pickup evidence mutation after the recovery boundary', async () => {
    const createInspection = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'booking-id' }]),
      booking: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          actualPickupAt: null,
          actualReturnAt: null,
          id: 'booking-id',
          ownerProfile: { status: 'VERIFIED' },
          ownerUserId: 'owner-user',
          pickupWindowEnd: new Date(Date.now() - 60_000),
          pickupWindowStart: new Date(Date.now() - 120_000),
          rentalEnd: new Date(Date.now() + 86_400_000),
          rentalStart: new Date(Date.now() - 120_000),
          status: BookingStatus.READY_FOR_PICKUP,
        }),
      },
      inspection: { create: createInspection },
    };
    const service = new RentalsService(
      {
        client: {
          $transaction: (callback: (client: typeof transaction) => unknown) =>
            callback(transaction),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getOrThrow: vi.fn((key: string) =>
          key === 'SECURITY_DEPOSIT_EXECUTION_ENABLED' ? false : 120,
        ),
      } as never,
    );

    await expect(
      service.upsertOwnerPickupInspectionDraftMedia('owner-user', 'CR-OVERDUE', {} as never),
    ).rejects.toMatchObject({ code: 'HANDOVER_RECOVERY_REQUIRED', status: 409 });
    expect(createInspection).not.toHaveBeenCalled();
  });
});
