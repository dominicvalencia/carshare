import { describe, expect, it, vi } from 'vitest';
import { OwnerStaffRole, OwnerStaffStatus, OwnerStaffVehicleScopeMode } from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
import { OwnerStaffService } from './owner-staff.service';

const owner: OwnerAccessContext = {
  capacity: 'OWNER',
  membershipStatus: 'OWNER',
  ownerProfileId: 'owner-a',
  permissions: [],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

const manager: OwnerAccessContext = {
  capacity: OwnerStaffRole.MANAGER,
  membershipId: 'manager-a',
  membershipStatus: OwnerStaffStatus.ACTIVE,
  ownerProfileId: 'owner-a',
  permissions: ['staff.view'],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

const handle = 'abcdefghijklmnopqrstuvwx';
const nextHandle = 'zyxwvutsrqponmlkjihgfedc';
const request = { correlationId: 'correlation-a', ipAddress: '127.0.0.1' };

function service(
  client: Record<string, unknown>,
  options: {
    appEnv?: string;
    randomSecret?: ReturnType<typeof vi.fn>;
    rateLimit?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return new OwnerStaffService(
    { client } as never,
    { requirePermission: vi.fn() } as never,
    { send: vi.fn() } as never,
    { send: vi.fn() } as never,
    { assertAllowed: options.rateLimit ?? vi.fn() } as never,
    {
      hashIdentifier: vi.fn((value: string) => `fingerprint-${value}`),
      randomSecret: options.randomSecret ?? vi.fn(() => handle),
    } as never,
    {
      getOrThrow: vi.fn(() => options.appEnv ?? 'local'),
    } as never,
    {} as never,
  );
}

function accessLink(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date('2026-10-12T00:00:00.000Z'),
    id: 'link-a',
    ownerProfileId: 'owner-a',
    publicHandle: handle,
    rotatedAt: null,
    rotatedByUserId: null,
    version: 1,
    ...overrides,
  };
}

describe('OwnerStaffService Staff access links', () => {
  it.each([
    ['local', 'carrental'],
    ['test', 'carshare-test'],
    ['staging', 'carshare-staging'],
    ['production', 'carshare'],
  ])('returns the current link with the %s scheme', async (appEnv, scheme) => {
    const current = accessLink();
    const subject = service(
      { ownerStaffAccessLink: { findUnique: vi.fn().mockResolvedValue(current) } },
      { appEnv },
    );

    await expect(subject.staffAccessLink(owner, 'owner-user', request)).resolves.toEqual({
      createdAt: current.createdAt,
      rotatedAt: null,
      url: `${scheme}://owner/staff-access/${handle}`,
      version: 1,
    });
  });

  it.each([manager, { ...manager, capacity: OwnerStaffRole.STAFF }])(
    'denies non-Owner retrieval and does not query the link',
    async (context) => {
      const findUnique = vi.fn();
      const subject = service({ ownerStaffAccessLink: { findUnique } });

      await expect(subject.staffAccessLink(context, 'staff-user', request)).rejects.toMatchObject({
        code: 'OWNER_STAFF_FORBIDDEN',
      });
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('creates a missing link once and audits only its fingerprint', async () => {
    const created = accessLink();
    const auditCreate = vi.fn();
    const create = vi.fn().mockResolvedValue(created);
    const subject = service({
      $transaction: vi.fn(async (callback) =>
        callback({ auditLog: { create: auditCreate }, ownerStaffAccessLink: { create } }),
      ),
      ownerStaffAccessLink: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    await subject.staffAccessLink(owner, 'owner-user', request);

    expect(create).toHaveBeenCalledWith({
      data: { createdByUserId: 'owner-user', ownerProfileId: 'owner-a', publicHandle: handle },
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(handle);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'OWNER_STAFF_ACCESS_LINK_CREATED',
          metadata: expect.objectContaining({ handleFingerprint: 'fingerprint-' }),
        }),
      }),
    );
  });

  it('resolves a current handle minimally and fingerprints its rate-limit key', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'link-a' });
    const rateLimit = vi.fn();
    const subject = service({ ownerStaffAccessLink: { findUnique } }, { rateLimit });

    await expect(subject.resolveStaffAccessLink(handle, request)).resolves.toEqual({
      type: 'STAFF_ACCESS',
      valid: true,
    });
    expect(rateLimit).toHaveBeenCalledWith(
      'owner-staff-access-lookup',
      ['ip:127.0.0.1', 'handle:fingerprint-'],
      20,
      900,
    );
    expect(findUnique).toHaveBeenCalledWith({
      select: { id: true },
      where: { publicHandle: handle },
    });
  });

  it('returns the same minimal invalid result for malformed and random handles', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const subject = service({ ownerStaffAccessLink: { findUnique } });

    await expect(subject.resolveStaffAccessLink('bad', request)).resolves.toEqual({
      type: 'STAFF_ACCESS',
      valid: false,
    });
    await expect(subject.resolveStaffAccessLink(handle, request)).resolves.toEqual({
      type: 'STAFF_ACCESS',
      valid: false,
    });
  });

  it.each([OwnerStaffRole.STAFF, OwnerStaffRole.MANAGER])(
    'authorizes an ACTIVE %s membership without issuing a session',
    async (role) => {
      const auditCreate = vi.fn();
      const rateLimit = vi.fn();
      const subject = service(
        {
          auditLog: { create: auditCreate },
          ownerStaffAccessLink: {
            findFirst: vi.fn().mockResolvedValue({
              ownerProfile: {
                id: 'owner-a',
                legalName: 'Dominic Rentals',
                staffMemberships: [
                  {
                    id: 'membership-a',
                    permissions: [{ permission: { code: 'vehicles.view' } }],
                    role,
                    status: OwnerStaffStatus.ACTIVE,
                    vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
                  },
                ],
                status: 'APPROVED',
                user: { id: 'owner-user', profile: { displayName: 'Dominic' } },
              },
              version: 2,
            }),
          },
        },
        { rateLimit },
      );

      await expect(
        subject.authorizeStaffAccessLink(handle, 'staff-user', request),
      ).resolves.toMatchObject({
        capacity: role,
        membershipId: 'membership-a',
        membershipStatus: 'ACTIVE',
        ownerProfileId: 'owner-a',
        workspaceLabel: 'Dominic Rentals',
      });
      expect(auditCreate).toHaveBeenCalledOnce();
      expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(handle);
      expect(rateLimit).toHaveBeenCalledWith(
        'owner-staff-access-authorize',
        ['ip:127.0.0.1', 'actor:staff-user', 'handle:fingerprint-'],
        10,
        900,
      );
    },
  );

  it('uses one generic failure for stale links, non-active membership states, and Owners', async () => {
    const subject = service({
      ownerStaffAccessLink: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    for (const actorUserId of [
      'wrong-user',
      'invited-user',
      'suspended-user',
      'disabled-user',
      'owner-user',
    ]) {
      await expect(
        subject.authorizeStaffAccessLink(handle, actorUserId, request),
      ).rejects.toMatchObject({
        code: 'OWNER_STAFF_ACCESS_UNAVAILABLE',
        response: 'Staff workspace access is unavailable.',
      });
    }
  });

  it('atomically rotates the handle, increments version, and leaves other tables untouched', async () => {
    const current = accessLink();
    const rotated = accessLink({
      publicHandle: nextHandle,
      rotatedAt: new Date('2026-10-12T01:00:00.000Z'),
      version: 2,
    });
    const auditCreate = vi.fn();
    const rateLimit = vi.fn();
    const transaction = {
      auditLog: { create: auditCreate },
      ownerStaffAccessLink: {
        findUniqueOrThrow: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(rotated),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const subject = service(
      {
        $transaction: vi.fn(async (callback) => callback(transaction)),
        ownerStaffAccessLink: { findUnique: vi.fn().mockResolvedValue(current) },
      },
      { randomSecret: vi.fn(() => nextHandle), rateLimit },
    );

    await expect(
      subject.regenerateStaffAccessLink(owner, 'owner-user', request),
    ).resolves.toMatchObject({ url: `carrental://owner/staff-access/${nextHandle}`, version: 2 });
    expect(transaction.ownerStaffAccessLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publicHandle: nextHandle, version: { increment: 1 } }),
        where: { id: 'link-a', version: 1 },
      }),
    );
    expect(Object.keys(transaction)).toEqual(['auditLog', 'ownerStaffAccessLink']);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(nextHandle);
    expect(rateLimit).toHaveBeenCalledWith(
      'owner-staff-access-regenerate',
      ['actor:owner-user', 'workspace:owner-a'],
      3,
      3600,
    );
  });

  it('recovers an idempotent concurrent create from the database uniqueness guard', async () => {
    const winner = accessLink();
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const subject = service({
      $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }),
      ownerStaffAccessLink: { findUnique },
    });

    await expect(subject.staffAccessLink(owner, 'owner-user', request)).resolves.toMatchObject({
      url: `carrental://owner/staff-access/${handle}`,
      version: 1,
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
