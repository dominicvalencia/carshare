import cookieParser from 'cookie-parser';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash, argon2id } from 'argon2';
import { Logger } from 'nestjs-pino';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import { RoleCode } from '@carrental/database';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { attachAdminIdentity } from './admin-fixture';
import {
  EmailProvider,
  type EmailMessage,
  SmsProvider,
  type SmsMessage,
} from '../src/providers/delivery.provider';

class CapturingEmailProvider extends EmailProvider {
  readonly messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

class CapturingSmsProvider extends SmsProvider {
  readonly messages: SmsMessage[] = [];
  async send(message: SmsMessage): Promise<void> {
    this.messages.push(message);
  }
}

describe.sequential('Phase 2 identity integration', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let emailProvider: CapturingEmailProvider;
  let smsProvider: CapturingSmsProvider;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `renter-${unique}@example.test`;
  const password = 'correct horse battery staple';
  const mobile = `+63917${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
  let accessToken = '';
  let firstRefreshToken = '';
  let ownerId = '';
  let adminAccessToken = '';
  let currentSessionId = '';
  let otherAccessToken = '';
  let otherUserId = '';
  let otherOwnerId = '';

  beforeAll(async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rate:*', 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
    redis.disconnect();
    emailProvider = new CapturingEmailProvider();
    smsProvider = new CapturingSmsProvider();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailProvider)
      .useValue(emailProvider)
      .overrideProvider(SmsProvider)
      .useValue(smsProvider)
      .compile();
    app = module.createNestApplication({ bufferLogs: true });
    app.use(cookieParser());
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
    );
    await app.init();
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers one roleless user, then explicitly enrolls the RENTER persona', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        mobileNumber: mobile,
        password,
        platform: 'WEB',
        firstName: 'Phase',
        lastName: 'Two',
      })
      .expect(201);
    accessToken = response.body.data.accessToken;
    firstRefreshToken = response.body.data.refreshToken;
    expect(response.body.data.user.roles).toEqual([]);
    const stored = await database.client.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
    });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(password);
    const rolelessState = await request(app.getHttpServer())
      .get('/api/v1/me/personas')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(rolelessState.body.data).toMatchObject({
      owner: { enabled: false, onboarding: 'NOT_ENABLED', status: null },
      renter: { enabled: false, onboarding: 'NOT_ENABLED' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/me/personas')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ persona: 'ADMIN' })
      .expect(400);
    const enrolled = await request(app.getHttpServer())
      .post('/api/v1/me/personas')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ persona: 'RENTER' })
      .expect(201);
    expect(enrolled.body.data).toMatchObject({
      newlyEnrolled: true,
      renter: { enabled: true, onboarding: 'IN_PROGRESS' },
    });
    const repeatedEnrollment = await request(app.getHttpServer())
      .post('/api/v1/me/personas')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ persona: 'RENTER' })
      .expect(201);
    expect(repeatedEnrollment.body.data.newlyEnrolled).toBe(false);
    const initialPersona = await database.client.userProfile.findUniqueOrThrow({
      where: { userId: stored.id },
      select: { initialMarketplacePersona: true },
    });
    expect(initialPersona.initialMarketplacePersona).toBe('RENTER');
    await request(app.getHttpServer())
      .post('/api/v1/me/personas/owner/onboarding-entry')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    const completed = await request(app.getHttpServer())
      .post('/api/v1/me/personas/renter/onboarding-completion')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(completed.body.data.renter).toEqual({ enabled: true, onboarding: 'COMPLETE' });
    const firstCompletion = await database.client.userProfile.findUniqueOrThrow({
      where: { userId: stored.id },
      select: { renterOnboardingCompletedAt: true },
    });
    await request(app.getHttpServer())
      .post('/api/v1/me/personas/renter/onboarding-completion')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const repeatedCompletion = await database.client.userProfile.findUniqueOrThrow({
      where: { userId: stored.id },
      select: { renterOnboardingCompletedAt: true },
    });
    expect(repeatedCompletion.renterOnboardingCompletedAt).toEqual(
      firstCompletion.renterOnboardingCompletedAt,
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, platform: 'WEB' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `duplicate-mobile-${unique}@example.test`,
        mobileNumber: mobile,
        password,
        platform: 'WEB',
      })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('MOBILE_ALREADY_EXISTS'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'invalid', password: 'short', platform: 'WEB' })
      .expect(400);
  });

  it('enrolls OWNER idempotently without exposing administrative role assignment', async () => {
    const ownerFirstEmail = `owner-first-${unique}@example.test`;
    const registration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: ownerFirstEmail, password, platform: 'WEB' })
      .expect(201);
    const token = registration.body.data.accessToken as string;
    const userId = registration.body.data.user.id as string;
    const concurrentEnrollments = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/me/personas')
        .set('Authorization', `Bearer ${token}`)
        .send({ persona: 'OWNER' })
        .expect(201),
      request(app.getHttpServer())
        .post('/api/v1/me/personas')
        .set('Authorization', `Bearer ${token}`)
        .send({ persona: 'OWNER' })
        .expect(201),
    ]);
    expect(
      concurrentEnrollments.map((response) => response.body.data.newlyEnrolled).sort(),
    ).toEqual([false, true]);
    expect(await database.client.ownerProfile.count({ where: { userId } })).toBe(1);
    const ownerAssignments = await database.client.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    expect(ownerAssignments.map(({ role }) => role.code)).toEqual(['OWNER']);
    const assignedAt = ownerAssignments[0]!.assignedAt;
    await request(app.getHttpServer())
      .post('/api/v1/me/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ persona: 'OWNER' })
      .expect(201);
    const repeatedOwner = await database.client.userRole.findFirstOrThrow({
      where: { userId, role: { code: RoleCode.OWNER } },
    });
    expect(repeatedOwner.assignedAt).toEqual(assignedAt);
    const firstEntry = await request(app.getHttpServer())
      .post('/api/v1/me/personas/owner/onboarding-entry')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(firstEntry.body.data.ownerOnboardingFirstEnteredAt).toEqual(expect.any(String));
    const firstEntryTimestamp = await database.client.userProfile.findUniqueOrThrow({
      where: { userId },
      select: { initialMarketplacePersona: true, ownerOnboardingFirstEnteredAt: true },
    });
    expect(firstEntryTimestamp.initialMarketplacePersona).toBe('OWNER');
    await request(app.getHttpServer())
      .post('/api/v1/me/personas/owner/onboarding-entry')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const repeatedEntryTimestamp = await database.client.userProfile.findUniqueOrThrow({
      where: { userId },
      select: { ownerOnboardingFirstEnteredAt: true },
    });
    expect(repeatedEntryTimestamp.ownerOnboardingFirstEnteredAt).toEqual(
      firstEntryTimestamp.ownerOnboardingFirstEnteredAt,
    );

    await request(app.getHttpServer())
      .post('/api/v1/me/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ persona: 'RENTER' })
      .expect(201);
    const afterSecondPersona = await database.client.userProfile.findUniqueOrThrow({
      where: { userId },
      select: { initialMarketplacePersona: true },
    });
    expect(afterSecondPersona.initialMarketplacePersona).toBe('OWNER');
    await request(app.getHttpServer())
      .post('/api/v1/me/personas')
      .set('Authorization', `Bearer ${token}`)
      .send({ persona: 'SUPER_ADMIN' })
      .expect(400);
    expect(await database.client.adminUser.count({ where: { credentialUserId: userId } })).toBe(0);
  });

  it('protects login enumeration and verifies email with a one-time hashed token', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: 'wrong-password', platform: 'WEB' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        identifier: `unknown-${unique}@example.test`,
        password: 'wrong-password',
        platform: 'WEB',
      })
      .expect(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    const verification = emailProvider.messages.find(
      (message) => message.template === 'EMAIL_VERIFICATION',
    );
    expect(verification).toBeDefined();
    expect(verification!.actionUrl).toContain(encodeURIComponent(verification!.token));
    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/requests')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(202);
    const replacement = emailProvider.messages.at(-1)!;
    expect(replacement.token).not.toBe(verification!.token);
    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/confirmations')
      .send({ token: verification!.token })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/confirmations')
      .send({ token: replacement.token })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/email-verification/confirmations')
      .send({ token: replacement.token })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('EMAIL_VERIFICATION_TOKEN_INVALID'));
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(200);
    const second = rotated.body.data.refreshToken as string;
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefreshToken })
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('REFRESH_TOKEN_REUSED'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password, platform: 'WEB', deviceName: 'Integration browser' })
      .expect(200);
    accessToken = login.body.data.accessToken;
    currentSessionId = login.body.data.sessionId;
  }, 15_000);

  it('manages sessions and authenticates with mobile OTP without exposing its hash', async () => {
    const sessions = await request(app.getHttpServer())
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(sessions.body.data.length).toBeGreaterThan(0);
    const otpRequest = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/requests')
      .send({ mobileNumber: mobile, platform: 'WEB', purpose: 'LOGIN' })
      .expect(202);
    const challengeId = otpRequest.body.data.challengeId as string;
    const otp = smsProvider.messages.at(-1);
    expect(otp).toBeDefined();
    const challenge = await database.client.otpChallenge.findUniqueOrThrow({
      where: { id: challengeId },
    });
    expect(challenge.codeHash).not.toContain(otp!.code);
    await database.client.otpChallenge.update({
      data: { resendAvailableAt: challenge.createdAt },
      where: { id: challengeId },
    });
    const replacementRequest = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/requests')
      .send({ mobileNumber: mobile, platform: 'WEB', purpose: 'LOGIN' })
      .expect(202);
    const replacementChallengeId = replacementRequest.body.data.challengeId as string;
    const replacementOtp = smsProvider.messages.at(-1)!;
    expect(
      (await database.client.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } }))
        .consumedAt,
    ).not.toBeNull();
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verifications')
      .send({ challengeId, code: otp!.code, platform: 'WEB' })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verifications')
      .send({ challengeId: replacementChallengeId, code: '000000', platform: 'WEB' })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verifications')
      .send({ challengeId: replacementChallengeId, code: replacementOtp.code, platform: 'WEB' })
      .expect(200);

    const active = sessions.body.data.find(
      (session: { id: string; revokedAt: string | null }) =>
        session.id !== currentSessionId && !session.revokedAt,
    );
    if (active) {
      await request(app.getHttpServer())
        .delete(`/api/v1/sessions/${active.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    }
    await request(app.getHttpServer())
      .post('/api/v1/sessions/logout-others')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('adds, changes, and verifies a Philippine mobile number through the account flow', async () => {
    const firstRequest = await request(app.getHttpServer())
      .post('/api/v1/auth/mobile-verification/requests')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mobileNumber: mobile, platform: 'WEB' })
      .expect(202);
    const firstCode = smsProvider.messages.findLast(
      ({ template }) => template === 'MOBILE_VERIFICATION_OTP',
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verifications')
      .send({
        challengeId: firstRequest.body.data.challengeId,
        code: firstCode!.code,
        platform: 'WEB',
      })
      .expect(200);
    expect(
      (await database.client.user.findUniqueOrThrow({ where: { normalizedEmail: email } }))
        .mobileVerifiedAt,
    ).not.toBeNull();

    const changedMobile = mobile.replace('+63917', '+63918');
    const changed = await request(app.getHttpServer())
      .post('/api/v1/auth/mobile-verification/requests')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mobileNumber: changedMobile.replace('+63', '0'), platform: 'WEB' })
      .expect(202);
    const afterChange = await database.client.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
    });
    expect(afterChange.normalizedMobileNumber).toBe(changedMobile);
    expect(afterChange.mobileVerifiedAt).toBeNull();
    const changedCode = smsProvider.messages.findLast(
      ({ template, to }) => template === 'MOBILE_VERIFICATION_OTP' && to === changedMobile,
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verifications')
      .send({
        challengeId: changed.body.data.challengeId,
        code: changedCode!.code,
        platform: 'WEB',
      })
      .expect(200);
    const snapshot = await request(app.getHttpServer())
      .get('/api/v1/renter-verification')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(snapshot.body.data.mobileNumber).toBe(changedMobile);
    expect(snapshot.body.data.mobileVerifiedAt).toBeTruthy();
  });

  it('completes owner onboarding with an authorized sensitive file', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/v1/owners/onboarding')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    ownerId = started.body.data.id;
    await request(app.getHttpServer())
      .patch('/api/v1/owners/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        legalName: 'Phase Two Owner',
        contactNumber: mobile,
        addressLine1: '1 Test Street',
        city: 'Makati',
        province: 'Metro Manila',
        postalCode: '1200',
      })
      .expect(200);
    const uploaded = await request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('classification', 'SENSITIVE')
      .attach('file', Buffer.from('identity-document'), {
        contentType: 'application/pdf',
        filename: 'identity.pdf',
      })
      .expect(201);
    const fileId = uploaded.body.data.id as string;
    await request(app.getHttpServer())
      .post('/api/v1/owners/me/submission')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ verificationFileIds: [fileId] })
      .expect(201);
    const other = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: `other-${unique}@example.test`, password, platform: 'WEB' })
      .expect(201);
    otherAccessToken = other.body.data.accessToken;
    otherUserId = other.body.data.user.id;
    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}/content`)
      .set('Authorization', `Bearer ${other.body.data.accessToken}`)
      .expect(403);
  });

  it('allows a permissioned admin to approve and suspend without changing OWNER role', async () => {
    const adminEmail = `admin-${unique}@example.test`;
    const superAdmin = await database.client.role.findUniqueOrThrow({
      where: { code: RoleCode.SUPER_ADMIN },
    });
    const admin = await database.client.user.create({
      data: {
        email: adminEmail,
        emailVerifiedAt: new Date(),
        normalizedEmail: adminEmail,
        passwordHash: await hash(password, {
          memoryCost: 19_456,
          parallelism: 1,
          timeCost: 2,
          type: argon2id,
        }),
        roles: { create: { roleId: superAdmin.id } },
      },
    });
    await attachAdminIdentity(database.client, admin.id, adminEmail, 'Identity Administrator', [
      RoleCode.SUPER_ADMIN,
    ]);
    const login = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ identifier: adminEmail, password, platform: 'WEB' })
      .expect(200);
    adminAccessToken = login.body.data.accessToken;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/owners/${ownerId}/approval`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/owners/me/operational-eligibility')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/owners/${ownerId}/suspension`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ reason: 'Integration suspension test' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/owners/me/operational-eligibility')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    const ownerUser = await database.client.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
      include: { roles: { include: { role: true } } },
    });
    expect(ownerUser.roles.map(({ role }) => role.code)).toContain(RoleCode.OWNER);
    expect(admin.id).toBeTruthy();
    await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${ownerUser.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: ownerUser.id,
          ownerBookings: expect.any(Array),
          ownedVehicles: expect.any(Array),
          renterBookings: expect.any(Array),
          roles: expect.any(Array),
          verifications: expect.any(Array),
        });
        expect(body.data).not.toHaveProperty('passwordHash');
        expect(body.data).not.toHaveProperty('sessions');
        expect(body.data.profile).not.toHaveProperty('addressLine1');
        expect(JSON.stringify(body.data)).not.toContain('fileAsset');
      });

    const otherStarted = await request(app.getHttpServer())
      .post('/api/v1/owners/onboarding')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(201);
    otherOwnerId = otherStarted.body.data.id;
    await request(app.getHttpServer())
      .patch('/api/v1/owners/me')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({
        legalName: 'Rejected Owner',
        contactNumber: '+639181234567',
        addressLine1: '2 Test Street',
        city: 'Taguig',
        province: 'Metro Manila',
        postalCode: '1630',
      })
      .expect(200);
    const otherFile = await request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .field('classification', 'SENSITIVE')
      .attach('file', Buffer.from('other-identity'), {
        contentType: 'application/pdf',
        filename: 'other.pdf',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/owners/me/submission')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({ verificationFileIds: [otherFile.body.data.id] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/owners/${otherOwnerId}/rejection`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ reason: 'Please submit a clearer identity document' })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/api/v1/owners/me')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({ legalName: 'Corrected Owner' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/owners/me/submission')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({ verificationFileIds: [otherFile.body.data.id] })
      .expect(201);
  });

  it('enforces OTP expiry and attempt limits', async () => {
    const user = await database.client.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
    });
    const yesterday = new Date(Date.now() - 86_400_000);
    const expired = await database.client.otpChallenge.create({
      data: {
        attemptCount: 0,
        codeHash: '0'.repeat(64),
        createdAt: yesterday,
        destinationHash: '1'.repeat(64),
        destinationLastFour: '0000',
        expiresAt: new Date(yesterday.getTime() + 60_000),
        maxAttempts: 5,
        purpose: 'LOGIN',
        resendAvailableAt: yesterday,
        userId: user.id,
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verifications')
      .send({ challengeId: expired.id, code: '000000', platform: 'WEB' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('OTP_EXPIRED'));
    const exhaustedCreatedAt = new Date();
    const exhausted = await database.client.otpChallenge.create({
      data: {
        attemptCount: 5,
        codeHash: '0'.repeat(64),
        createdAt: exhaustedCreatedAt,
        destinationHash: '2'.repeat(64),
        destinationLastFour: '0000',
        expiresAt: new Date(Date.now() + 60_000),
        maxAttempts: 5,
        purpose: 'LOGIN',
        resendAvailableAt: exhaustedCreatedAt,
        userId: user.id,
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verifications')
      .send({ challengeId: exhausted.id, code: '000000', platform: 'WEB' })
      .expect(429)
      .expect(({ body }) => expect(body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED'));
  });

  it('resets password with a one-time token and revokes previous sessions', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/requests')
      .send({ email })
      .expect(202);
    const expiredReset = emailProvider.messages.findLast(
      (message) => message.template === 'PASSWORD_RESET',
    );
    expect(expiredReset).toBeDefined();
    expect(expiredReset!.actionUrl).toBe(
      `carshare-test://reset-password?token=${encodeURIComponent(expiredReset!.token)}`,
    );
    await database.client.authToken.update({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { id: expiredReset!.token.split('.')[0] },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirmations')
      .send({ token: expiredReset!.token, newPassword: 'unused password that is long enough' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('PASSWORD_RESET_TOKEN_EXPIRED'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/requests')
      .send({ email })
      .expect(202);
    const reset = emailProvider.messages.findLast(
      (message) => message.template === 'PASSWORD_RESET',
    );
    const newPassword = 'a newer correct horse battery staple';
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirmations')
      .send({ token: reset!.token, newPassword })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/password-reset/confirmations')
      .send({ token: reset!.token, newPassword })
      .expect(422);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    const finalLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: newPassword, platform: 'WEB' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/sessions/logout-all')
      .set('Authorization', `Bearer ${finalLogin.body.data.accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${finalLogin.body.data.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${otherUserId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'SUSPENDED', reason: 'Integration account suspension' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: `other-${unique}@example.test`, password, platform: 'WEB' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('ACCOUNT_SUSPENDED'));
  });
});
