import { describe, expect, it, vi } from 'vitest';
import { OwnerWorkspaceBookingsController } from './owner-workspace-bookings.controller';

const context = {
  capacity: 'MANAGER' as const,
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
  userId: 'manager-user-1',
};

describe('OwnerWorkspaceBookingsController', () => {
  it('passes workspace context and the real actor to accept without changing payment processing', async () => {
    const bookings = {
      ownerAcceptForAccess: vi.fn().mockResolvedValue({}),
      ownerDetailForAccess: vi.fn().mockResolvedValue({ publicReference: 'CR-1' }),
    };
    const payments = { processPendingForBooking: vi.fn().mockResolvedValue(undefined) };
    const access = {
      auditDelegatedAction: vi.fn().mockResolvedValue(undefined),
      requireRequestManagement: vi.fn(),
    };
    const controller = new OwnerWorkspaceBookingsController(
      bookings as never,
      payments as never,
      access as never,
    );

    await controller.accept(principal as never, 'CR-1', { headers: {} } as never);

    expect(bookings.ownerAcceptForAccess).toHaveBeenCalledWith(
      context,
      'manager-user-1',
      'CR-1',
      expect.any(Object),
    );
    expect(payments.processPendingForBooking).toHaveBeenCalledWith('CR-1', expect.any(Object));
    expect(access.auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'manager-user-1', permission: 'bookings.accept' }),
    );
  });

  it('passes workspace context and the real actor to reject', async () => {
    const bookings = {
      ownerDetailForAccess: vi.fn().mockResolvedValue({ publicReference: 'CR-1' }),
      ownerRejectForAccess: vi.fn().mockResolvedValue({}),
    };
    const payments = { processPendingForBooking: vi.fn().mockResolvedValue(undefined) };
    const access = {
      auditDelegatedAction: vi.fn().mockResolvedValue(undefined),
      requireRequestManagement: vi.fn(),
    };
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
      'manager-user-1',
      'CR-1',
      'Unavailable',
      expect.any(Object),
    );
    expect(access.auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'manager-user-1', permission: 'bookings.reject' }),
    );
  });

  it('denies direct request access to Operational Staff before querying bookings', () => {
    const bookings = { listForOwnerAccess: vi.fn() };
    const access = {
      requireRequestManagement: vi.fn(() => {
        throw new Error('Operational Staff cannot access booking requests');
      }),
    };
    const controller = new OwnerWorkspaceBookingsController(
      bookings as never,
      {} as never,
      access as never,
    );

    expect(() =>
      controller.list({ ...principal, ownerAccess: { ...context, capacity: 'STAFF' } } as never),
    ).toThrow('Operational Staff cannot access booking requests');
    expect(bookings.listForOwnerAccess).not.toHaveBeenCalled();
  });
});
