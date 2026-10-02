import { BookingAmendmentStatus, BookingStatus } from '@carrental/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AmendmentOwnerDecisionService,
  ownerUpcomingAmendmentStatuses,
  ownerVisibleAmendmentStatuses,
} from './amendment-owner-decision.service';
import { OwnerAmendmentListScope } from './owner-booking-amendments.dto';

describe('Owner amendment history authority', () => {
  const count = vi.fn().mockResolvedValue(0);
  const findMany = vi.fn().mockResolvedValue([]);
  const transaction = vi.fn().mockResolvedValue([0, []]);
  const database = {
    client: {
      $transaction: transaction,
      bookingAmendment: { count, findMany },
    },
  };
  const service = new AmendmentOwnerDecisionService(database as never, {} as never, {} as never);

  beforeEach(() => vi.clearAllMocks());

  it('keeps Needs response restricted to owned PENDING_OWNER amendments', async () => {
    await service.listOwnerHistory('owner-1', {
      page: 1,
      pageSize: 20,
      scope: OwnerAmendmentListScope.NEEDS_RESPONSE,
    });
    const query = findMany.mock.calls[0]![0];
    expect(query.where).toMatchObject({
      booking: { ownerUserId: 'owner-1' },
      status: BookingAmendmentStatus.PENDING_OWNER,
    });
    expect(query).toMatchObject({ skip: 0, take: 20 });
  });

  it('bounds Upcoming by accepted in-progress/applied states and relevant booking lifecycle', async () => {
    await service.listOwnerHistory('owner-2', {
      page: 2,
      pageSize: 10,
      scope: OwnerAmendmentListScope.UPCOMING,
    });
    const query = findMany.mock.calls[0]![0];
    expect(query.where.booking).toEqual({
      ownerUserId: 'owner-2',
      status: {
        in: [
          BookingStatus.CAPTURE_PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.READY_FOR_PICKUP,
          BookingStatus.ACTIVE,
          BookingStatus.RETURN_PENDING,
        ],
      },
    });
    expect(query.where.status.in).toEqual([
      BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      BookingAmendmentStatus.APPLIED,
      BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    ]);
    expect(query).toMatchObject({ skip: 10, take: 10 });
  });

  it('returns all owned states with deterministic newest-activity ordering and pagination', async () => {
    const result = await service.listOwnerHistory('owner-3', {
      page: 3,
      pageSize: 5,
      scope: OwnerAmendmentListScope.ALL,
    });
    const query = findMany.mock.calls[0]![0];
    expect(query.where.booking).toEqual({ ownerUserId: 'owner-3' });
    expect(query.where.status.in).toEqual(ownerVisibleAmendmentStatuses);
    expect(ownerVisibleAmendmentStatuses).toEqual([
      BookingAmendmentStatus.PENDING_OWNER,
      BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      BookingAmendmentStatus.APPLIED,
      BookingAmendmentStatus.DECLINED,
      BookingAmendmentStatus.WITHDRAWN,
      BookingAmendmentStatus.EXPIRED,
      BookingAmendmentStatus.FAILED,
      BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    ]);
    expect(ownerUpcomingAmendmentStatuses).not.toContain(BookingAmendmentStatus.DECLINED);
    expect(query.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    expect(query).toMatchObject({ skip: 10, take: 5 });
    expect(result).toEqual({ items: [], page: 3, pageSize: 5, total: 0, totalPages: 1 });
  });

  it('leaves the existing actionable authority unchanged', async () => {
    await service.list('owner-4');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          booking: { ownerUserId: 'owner-4' },
          status: BookingAmendmentStatus.PENDING_OWNER,
        }),
      }),
    );
  });
});
