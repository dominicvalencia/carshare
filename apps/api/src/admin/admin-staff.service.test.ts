import { describe, expect, it, vi } from 'vitest';
import { AdminRole, AdminStatus, UserStatus } from '@carrental/database';
import {
  AdminStaffService,
  isLocalInvitationExposureAllowed,
  isUsableAdminInvitation,
} from './admin-staff.service';

const owner = {
  adminRole: AdminRole.OWNER,
  adminStatus: AdminStatus.ACTIVE,
  adminUserId: 'owner-admin',
  permissions: ['staff.create', 'staff.edit', 'staff.permissions.manage'],
  roles: [],
  sessionId: 'session-owner',
  status: UserStatus.ACTIVE,
  userId: 'owner-user',
} as const;

const superAdmin = { ...owner, adminRole: AdminRole.SUPER_ADMIN, adminUserId: 'super-admin' };

function service(databaseOverrides: Record<string, unknown> = {}) {
  const findUnique = vi.fn();
  const database = {
    client: {
      adminUser: { findUnique, findUniqueOrThrow: vi.fn(), update: vi.fn() },
      adminInvitation: { findUnique: vi.fn() },
      user: { findUnique: vi.fn() },
      ...databaseOverrides,
    },
  };
  const instance = new AdminStaffService(
    database as never,
    { assertPasswordPolicy: vi.fn(), hashPassword: vi.fn(), secureEqual: vi.fn() } as never,
    { parseOpaqueId: vi.fn(), hashOpaque: vi.fn() } as never,
    { send: vi.fn() } as never,
    { latest: vi.fn() } as never,
    { recordAdmin: vi.fn() } as never,
    { getOrThrow: vi.fn() } as never,
  );
  return { findUnique, instance };
}

describe('AdminStaffService protections', () => {
  it('never permits OWNER creation through staff management', async () => {
    await expect(
      service().instance.create(
        {
          displayName: 'Second Owner',
          email: 'owner2@example.test',
          permissions: [],
          role: AdminRole.OWNER,
        },
        owner,
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('prevents SUPER_ADMIN from creating or promoting SUPER_ADMIN', async () => {
    await expect(
      service().instance.create(
        {
          displayName: 'Escalated',
          email: 'staff@example.test',
          permissions: [],
          role: AdminRole.SUPER_ADMIN,
        },
        superAdmin,
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects suspended identities during administrative login', async () => {
    const { findUnique, instance } = service();
    findUnique.mockResolvedValue({ status: AdminStatus.SUSPENDED });
    await expect(instance.completeLogin('credential-user')).rejects.toMatchObject({ status: 403 });
  });

  it('accepts an invitation only before expiry and only once', () => {
    const now = new Date('2026-09-09T03:00:00.000Z');
    const invitation = {
      adminUser: { status: AdminStatus.INVITED },
      consumedAt: null,
      expiresAt: new Date('2026-09-10T03:00:00.000Z'),
      revokedAt: null,
    };
    expect(isUsableAdminInvitation(invitation, true, now)).toBe(true);
    expect(isUsableAdminInvitation({ ...invitation, consumedAt: now }, true, now)).toBe(false);
    expect(isUsableAdminInvitation({ ...invitation, revokedAt: now }, true, now)).toBe(false);
    expect(isUsableAdminInvitation({ ...invitation, expiresAt: now }, true, now)).toBe(false);
    expect(isUsableAdminInvitation(invitation, false, now)).toBe(false);
  });

  it('exposes raw invitation links only for local/test development delivery', () => {
    expect(isLocalInvitationExposureAllowed('local', 'development')).toBe(true);
    expect(isLocalInvitationExposureAllowed('test', 'development')).toBe(true);
    expect(isLocalInvitationExposureAllowed('staging', 'development')).toBe(false);
    expect(isLocalInvitationExposureAllowed('production', 'development')).toBe(false);
    expect(isLocalInvitationExposureAllowed('local', 'postmark')).toBe(false);
  });
});
