import { describe, expect, it, vi } from 'vitest';
import {
  OwnerStaffRole,
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  UserStatus,
} from '@carrental/database';
import { AuthService } from './auth.service';

const handle = 'abcdefghijklmnopqrstuvwx';
const metadata = { ipAddress: '127.0.0.1', userAgent: 'test' };

function user(overrides: Record<string, unknown> = {}) {
  return {
    email: 'staff@example.com',
    emailVerifiedAt: new Date(),
    failedLoginAttempts: 0,
    id: 'user-a',
    loginLockedUntil: null,
    mobileNumber: '09171234567',
    mobileVerifiedAt: new Date(),
    normalizedMobileNumber: '+639171234567',
    ownerProfile: null,
    ownerStaffMemberships: [
      {
        createdAt: new Date(),
        id: 'membership-a',
        ownerProfile: { legalName: 'Dominic Rentals', status: 'VERIFIED' },
        ownerProfileId: 'owner-a',
        permissions: [{ permission: { code: 'vehicles.view' } }],
        role: OwnerStaffRole.STAFF,
        status: OwnerStaffStatus.ACTIVE,
        vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
      },
    ],
    passwordHash: 'hash',
    profile: { displayName: 'Staff User' },
    roles: [],
    status: UserStatus.ACTIVE,
    ...overrides,
  };
}

function setup(
  options: {
    link?: { ownerProfileId: string; version?: number } | null;
    passwordValid?: boolean;
    recheckUser?: ReturnType<typeof user> | null;
    user?: ReturnType<typeof user> | null;
  } = {},
) {
  const foundUser = options.user === undefined ? user() : options.user;
  const currentLink =
    options.link === undefined ? { ownerProfileId: 'owner-a', version: 1 } : options.link;
  const sessionCreate = vi.fn().mockResolvedValue({});
  const transaction = {
    ownerStaffAccessLink: { findUnique: vi.fn().mockResolvedValue(currentLink) },
    session: { create: sessionCreate },
    user: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.recheckUser === undefined ? foundUser : options.recheckUser),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const rateLimit = vi.fn();
  const events = vi.fn();
  const client = {
    $transaction: vi.fn(async (callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    ownerStaffAccessLink: { findUnique: vi.fn().mockResolvedValue(currentLink) },
    session: { create: sessionCreate },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(foundUser),
      findUniqueOrThrow: vi.fn().mockResolvedValue(foundUser),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const subject = new AuthService(
    { client } as never,
    {
      hashIdentifier: vi.fn((value: string) => `fingerprint-${value}`),
      verifyPassword: vi.fn().mockResolvedValue(options.passwordValid ?? true),
    } as never,
    {
      opaqueToken: vi.fn(() => ({ hash: 'refresh-hash', raw: 'refresh-token' })),
      signAccessToken: vi.fn().mockResolvedValue('access-token'),
    } as never,
    { assertAllowed: rateLimit } as never,
    { record: events } as never,
    {} as never,
    {} as never,
    {
      getOrThrow: vi.fn((key: string) => (key === 'REFRESH_TOKEN_TTL_DAYS' ? 30 : 900)),
    } as never,
  );
  return { client, events, rateLimit, sessionCreate, subject, transaction };
}

describe('AuthService contextual Staff access login', () => {
  it.each([OwnerStaffRole.STAFF, OwnerStaffRole.MANAGER])(
    'creates a normal session only after an ACTIVE %s membership recheck',
    async (role) => {
      const activeUser = user({
        ownerStaffMemberships: [{ ...user().ownerStaffMemberships[0], role }],
      });
      const { events, rateLimit, sessionCreate, subject, transaction } = setup({
        recheckUser: activeUser,
        user: activeUser,
      });

      const result = await subject.loginStaffAccess(
        handle,
        { mobileNumber: '0917 123 4567', password: 'correct-password', platform: 'IOS' },
        metadata,
      );

      expect(result).toMatchObject({
        accessToken: 'access-token',
        authorizedWorkspace: { capacity: role, ownerProfileId: 'owner-a' },
        refreshToken: 'refresh-token',
        user: { ownerWorkspaces: [expect.objectContaining({ capacity: role })] },
      });
      expect(sessionCreate).toHaveBeenCalledOnce();
      expect(transaction.user.findFirst).toHaveBeenCalledBefore(sessionCreate);
      expect(rateLimit).toHaveBeenCalledWith(
        'owner-staff-access-login',
        ['ip:127.0.0.1', 'mobile:fingerprint-', 'handle:fingerprint-'],
        10,
        900,
      );
      expect(events).toHaveBeenCalledWith(
        'STAFF_ACCESS_LOGIN_SUCCESS',
        expect.objectContaining({ sessionId: expect.any(String), userId: 'user-a' }),
      );
    },
  );

  it.each(['09171234567', '+639171234567'])(
    'normalizes %s to the authoritative PH mobile identity',
    async (mobileNumber) => {
      const { client, subject } = setup();
      await subject.loginStaffAccess(handle, { mobileNumber, password: 'correct' }, metadata);
      expect(client.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { normalizedMobileNumber: '+639171234567' } }),
      );
    },
  );

  it.each([
    ['unknown mobile', { user: null }],
    ['wrong password', { passwordValid: false }],
    ['invalid link', { link: null }],
    ['unverified mobile', { user: user({ mobileVerifiedAt: null }) }],
    ['disabled user', { user: user({ status: UserStatus.BLOCKED }) }],
    [
      'inactive membership',
      {
        user: user({
          ownerStaffMemberships: [
            { ...user().ownerStaffMemberships[0], status: OwnerStaffStatus.SUSPENDED },
          ],
        }),
      },
    ],
    [
      'different workspace',
      {
        user: user({
          ownerStaffMemberships: [
            { ...user().ownerStaffMemberships[0], ownerProfileId: 'owner-b' },
          ],
        }),
      },
    ],
    ['rotation during login', { recheckUser: null }],
  ] as const)(
    'returns one generic failure and creates no session for %s',
    async (_name, options) => {
      const { sessionCreate, subject } = setup(options as never);
      await expect(
        subject.loginStaffAccess(
          handle,
          { mobileNumber: '09171234567', password: 'password' },
          metadata,
        ),
      ).rejects.toMatchObject({ code: 'STAFF_ACCESS_LOGIN_FAILED' });
      expect(sessionCreate).not.toHaveBeenCalled();
    },
  );
});
