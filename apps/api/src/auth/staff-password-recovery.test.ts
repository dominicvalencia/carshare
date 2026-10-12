import { describe, expect, it, vi } from 'vitest';
import { AuthTokenType, OtpPurpose, OwnerStaffStatus, UserStatus } from '@carrental/database';
import { AuthService } from './auth.service';

const handle = 'abcdefghijklmnopqrstuvwx';
const metadata = { ipAddress: '127.0.0.1', userAgent: 'test' };

function setup(eligible = true) {
  const now = new Date();
  const link = {
    id: 'link-a',
    ownerProfileId: 'owner-a',
    version: 3,
    ownerProfile: {
      staffMemberships: eligible ? [{ user: { id: 'user-a' } }] : [],
      userId: 'owner-user',
    },
  };
  const transaction = {
    authToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    devicePushToken: { updateMany: vi.fn() },
    otpChallenge: { create: vi.fn().mockResolvedValue({ id: 'challenge-a' }), updateMany: vi.fn() },
    ownerStaffMembership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-a' }) },
    session: { updateMany: vi.fn() },
    user: { update: vi.fn() },
  };
  const client = {
    $transaction: vi.fn(async (callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    otpChallenge: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ownerStaffAccessLink: { findFirst: vi.fn().mockResolvedValue(eligible ? link : null) },
  };
  const sms = { send: vi.fn() };
  const subject = new AuthService(
    { client } as never,
    {
      assertPasswordPolicy: vi.fn(),
      hashIdentifier: vi.fn((value: string) => `hash-${value}`),
      hashPassword: vi.fn().mockResolvedValue('new-password-hash'),
      hashToken: vi.fn((value: string) => `token-${value}`),
      randomOtp: vi.fn(() => '123456'),
      secureEqual: vi.fn((left: string, right: string) => left === right),
    } as never,
    {
      hashOpaque: vi.fn(() => 'reset-hash'),
      opaqueToken: vi.fn(() => ({ hash: 'reset-hash', raw: 'reset-token' })),
      parseOpaqueId: vi.fn(() => 'token-a'),
    } as never,
    { assertAllowed: vi.fn() } as never,
    { record: vi.fn() } as never,
    {} as never,
    sms as never,
    { getOrThrow: vi.fn((key: string) => (key === 'OTP_MAX_ATTEMPTS' ? 5 : 10)) } as never,
  );
  return { client, link, now, sms, subject, transaction };
}

describe('AuthService contextual Staff password recovery', () => {
  it('returns the same generic response and sends no SMS for an ineligible account', async () => {
    const { sms, subject } = setup(false);
    const response = await subject.requestStaffPasswordReset(handle, '09171234567', metadata);
    expect(response).toMatchObject({
      challengeId: expect.any(String),
      message: expect.stringContaining('If the account is eligible'),
    });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('creates a link-version-bound challenge and sends the dedicated OTP when eligible', async () => {
    const { sms, subject, transaction } = setup();
    await subject.requestStaffPasswordReset(handle, '09171234567', metadata);
    expect(transaction.otpChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerStaffAccessLinkId: 'link-a',
        purpose: OtpPurpose.STAFF_PASSWORD_RESET,
        staffAccessLinkVersion: 3,
        userId: 'user-a',
      }),
    });
    expect(sms.send).toHaveBeenCalledWith({
      code: '123456',
      template: 'STAFF_PASSWORD_RESET_OTP',
      to: '+639171234567',
    });
  });

  it('rejects OTP verification after the stable link has rotated', async () => {
    const { client, subject } = setup();
    client.otpChallenge.findUnique.mockResolvedValue({
      attemptCount: 0,
      codeHash: 'token-123456',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      id: 'challenge-a',
      maxAttempts: 5,
      ownerStaffAccessLink: { ownerProfileId: 'owner-a', publicHandle: handle, version: 4 },
      ownerStaffAccessLinkId: 'link-a',
      purpose: OtpPurpose.STAFF_PASSWORD_RESET,
      staffAccessLinkVersion: 3,
      userId: 'user-a',
    });
    await expect(
      subject.verifyStaffPasswordReset(handle, 'challenge-a', '123456', metadata),
    ).rejects.toMatchObject({ code: 'STAFF_PASSWORD_RESET_INVALID' });
  });

  it('preserves the generic global password-reset session revocation policy', async () => {
    const { subject, transaction } = setup();
    transaction.authToken.findUnique.mockResolvedValue({
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      id: 'token-a',
      ownerStaffAccessLink: { ownerProfileId: 'owner-a', publicHandle: handle, version: 3 },
      ownerStaffAccessLinkId: 'link-a',
      staffAccessLinkVersion: 3,
      tokenHash: 'reset-hash',
      type: AuthTokenType.STAFF_PASSWORD_RESET,
      userId: 'user-a',
    });
    transaction.authToken.updateMany.mockResolvedValue({ count: 1 });
    await subject.completeStaffPasswordReset(
      handle,
      'reset-token',
      'New secure password 123',
      'New secure password 123',
      metadata,
    );
    expect(transaction.session.updateMany).toHaveBeenCalledWith({
      data: { revocationReason: 'PASSWORD_RESET', revokedAt: expect.any(Date) },
      where: { revokedAt: null, userId: 'user-a' },
    });
    expect(transaction.ownerStaffMembership.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: OwnerStaffStatus.ACTIVE, userId: 'user-a' }),
    });
    expect(transaction.user.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ passwordHash: 'new-password-hash' }),
      where: { id: 'user-a' },
    });
    expect(UserStatus.ACTIVE).toBe('ACTIVE');
  });
});
