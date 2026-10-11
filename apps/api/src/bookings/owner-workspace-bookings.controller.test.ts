import { describe, expect, it, vi } from 'vitest';
import { OwnerWorkspaceBookingsController } from './owner-workspace-bookings.controller';

const context = {
  capacity: 'STAFF' as const,
  membershipId: 'membership-1',
  membershipStatus: 'ACTIVE' as const,
  ownerProfileId: 'owner-profile-1',
  permissions: ['bookings.view', 'bookings.accept', 'bookings.reject'],
  vehicleScopeMode: 'SELECTED_VEHICLES' as const,
};
const principal = {
  ownerAccess: context,
  permissions: [],
  roles: [],
  sessionId: 'session-1',
  status: 'ACTIVE' as const,
  userId: 'staff-user-1',
};

describe('OwnerWorkspaceBookingsController', () => {
  it('passes workspace context and the real actor to accept without changing payment processing', async () => {
    const bookings = {
      ownerAcceptForAccess: vi.fn().mockResolvedValue({}),
      ownerDetailForAccess: vi.fn().mockResolvedValue({ publicReference: 'CR-1' }),
    };
    const payments = { processPendingForBooking: vi.fn().mockResolvedValue(undefined) };
    const access = { auditDelegatedAction: vi.fn().mockResolvedValue(undefined) };
    const controller = new OwnerWorkspaceBookingsController(
      bookings as never,
      payments as never,
      access as never,
    );

    await controller.accept(principal as never, 'CR-1', { headers: {} } as never);

    expect(bookings.ownerAcceptForAccess).toHaveBeenCalledWith(
      context,
      'staff-user-1',
      'CR-1',
      expect.any(Object),
    );
    expect(payments.processPendingForBooking).toHaveBeenCalledWith('CR-1', expect.any(Object));
    expect(access.auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'staff-user-1', permission: 'bookings.accept' }),
    );
  });

  it('passes workspace context and the real actor to reject', async () => {
    const bookings = {
      ownerDetailForAccess: vi.fn().mockResolvedValue({ publicReference: 'CR-1' }),
      ownerRejectForAccess: vi.fn().mockResolvedValue({}),
    };
    const payments = { processPendingForBooking: vi.fn().mockResolvedValue(undefined) };
    const access = { auditDelegatedAction: vi.fn().mockResolvedValue(undefined) };
    const controller = new OwnerWorkspaceBookingsController(
      bookings as never,
      payments as never,
      access as never,
    );

    await controller.reject(principal as never, 'CR-1', { reason: 'Unavailable' }, {
      headers: {},
    } as never);

    expect(bookings.ownerRejectForAccess).toHaveBeenCalledWith(
      context,
      'staff-user-1',
      'CR-1',
      'Unavailable',
      expect.any(Object),
    );
    expect(access.auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'staff-user-1', permission: 'bookings.reject' }),
    );
  });
});
