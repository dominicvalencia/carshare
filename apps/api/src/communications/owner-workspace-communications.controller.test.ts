import { describe, expect, it, vi } from 'vitest';
import { OwnerWorkspaceCommunicationsController } from './owner-workspace-communications.controller';

const context = {
  capacity: 'STAFF' as const,
  membershipId: 'membership-1',
  membershipStatus: 'ACTIVE' as const,
  ownerProfileId: 'owner-profile-1',
  permissions: ['messages.view', 'messages.reply'],
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

describe('OwnerWorkspaceCommunicationsController', () => {
  it('uses workspace-scoped conversation reads', async () => {
    const communications = { listForOwnerAccess: vi.fn().mockResolvedValue({ items: [] }) };
    const controller = new OwnerWorkspaceCommunicationsController(communications as never);
    await controller.list(principal as never, { limit: 50 } as never);
    expect(communications.listForOwnerAccess).toHaveBeenCalledWith(context, { limit: 50 });
  });

  it('retains the real actor while sending through the Owner business identity', async () => {
    const communications = { sendForOwnerAccess: vi.fn().mockResolvedValue({ id: 'message-1' }) };
    const controller = new OwnerWorkspaceCommunicationsController(communications as never);
    await controller.send(
      principal as never,
      'conversation-1',
      { body: 'Hello' },
      'message-key-1',
      { headers: {} } as never,
    );
    expect(communications.sendForOwnerAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'staff-user-1',
        context,
        conversationId: 'conversation-1',
      }),
    );
  });
});
