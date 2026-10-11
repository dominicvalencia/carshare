import { describe, expect, it, vi } from 'vitest';
import { OwnerWorkspaceHomeController } from './owner-workspace-home.controller';

const context = {
  capacity: 'STAFF' as const,
  membershipId: 'membership-1',
  membershipStatus: 'ACTIVE' as const,
  ownerProfileId: 'owner-profile-1',
  permissions: ['rentals.view'],
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

describe('OwnerWorkspaceHomeController', () => {
  it('passes the authoritative workspace context to Today', async () => {
    const home = { todayForAccess: vi.fn().mockResolvedValue({ today: {} }) };
    const controller = new OwnerWorkspaceHomeController(home as never);

    await controller.today(principal as never);

    expect(home.todayForAccess).toHaveBeenCalledWith(context);
  });

  it('passes workspace context and pagination to upcoming rentals', async () => {
    const home = { upcomingForAccess: vi.fn().mockResolvedValue({ items: [] }) };
    const controller = new OwnerWorkspaceHomeController(home as never);
    const query = { page: 2, pageSize: 20 };

    await controller.upcoming(principal as never, query);

    expect(home.upcomingForAccess).toHaveBeenCalledWith(context, query);
  });
});
