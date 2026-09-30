import { describe, expect, it, vi } from 'vitest';
import { AdminBookingAmendmentsService } from './admin-booking-amendments.service';

describe('AdminBookingAmendmentsService', () => {
  it('uses bounded pagination and authoritative relation filters', async () => {
    const count = vi.fn().mockResolvedValue(26);
    const findMany = vi.fn().mockResolvedValue([]);
    const database = {
      client: {
        $transaction: vi.fn().mockResolvedValue([26, []]),
        bookingAmendment: { count, findMany },
      },
    };
    const service = new AdminBookingAmendmentsService(database as never);
    const result = await service.list({
      direction: 'REFUND' as never,
      page: 2,
      pageSize: 25,
      reconciliationRequired: 'true',
      scope: 'ACTIVE_EXTENSION' as never,
      status: 'FINANCIAL_RECOVERY_PENDING' as never,
    });
    expect(database.client.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ page: 2, pageSize: 25, total: 26, totalPages: 2 });
  });
});
