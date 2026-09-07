import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthTokenType,
  OtpPurpose,
  PushTokenStatus,
  RoleCode,
  UserStatus,
  type Prisma,
  type SessionPlatform,
} from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import { ApplicationException } from '../common/errors/application.exception';
import { normalizePhilippineMobile } from '../common/phone/philippine-mobile';
import { DatabaseService } from '../infrastructure/database/database.service';
import { CryptoService } from '../security/crypto.service';
import { RateLimitService } from '../security/rate-limit.service';
import { SecurityEventService } from '../security/security-event.service';
import type { RequestMetadata } from '../security/security-context';
import { EmailProvider, SmsProvider } from '../providers/delivery.provider';
import { TokenService } from './token.service';
import type {
  DeviceDto,
  LoginDto,
  MobileVerificationRequestDto,
  OtpRequestDto,
  OtpVerifyDto,
  RegisterDto,
} from './auth.dto';

export interface AuthenticationResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresIn: number;
  readonly sessionId: string;
  readonly user: ReturnType<AuthService['publicUser']>;
}

const sessionUserInclude = {
  profile: true,
  roles: { include: { role: true } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly rateLimits: RateLimitService,
    private readonly events: SecurityEventService,
    private readonly emailProvider: EmailProvider,
    private readonly smsProvider: SmsProvider,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async register(input: RegisterDto, metadata: RequestMetadata): Promise<AuthenticationResult> {
    const normalizedEmail = this.normalizeEmail(input.email);
    const normalizedMobile = input.mobileNumber
      ? this.normalizeMobile(input.mobileNumber)
      : undefined;
    await this.rateLimits.assertAllowed(
      'register',
      [metadata.ipAddress ?? 'unknown', normalizedEmail],
      5,
      3600,
    );
    try {
      this.crypto.assertPasswordPolicy(input.password);
    } catch (error) {
      throw new ApplicationException(
        IdentityErrorCode.PASSWORD_POLICY_VIOLATION,
        error instanceof Error ? error.message : 'Password does not meet the policy.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const duplicate = await this.database.client.user.findFirst({
      where: {
        OR: [
          { normalizedEmail },
          ...(normalizedMobile ? [{ normalizedMobileNumber: normalizedMobile }] : []),
        ],
      },
      select: { normalizedEmail: true },
    });
    if (duplicate) {
      const emailDuplicate = duplicate.normalizedEmail === normalizedEmail;
      throw new ApplicationException(
        emailDuplicate
          ? IdentityErrorCode.EMAIL_ALREADY_EXISTS
          : IdentityErrorCode.MOBILE_ALREADY_EXISTS,
        emailDuplicate
          ? 'This email is already registered.'
          : 'This mobile number is already registered.',
        HttpStatus.CONFLICT,
      );
    }

    const passwordHash = await this.crypto.hashPassword(input.password);
    const user = await this.database.client.$transaction(async (transaction) => {
      const renter = await transaction.role.findUniqueOrThrow({ where: { code: RoleCode.RENTER } });
      return transaction.user.create({
        data: {
          email: input.email.trim(),
          normalizedEmail,
          ...(normalizedMobile
            ? { mobileNumber: input.mobileNumber!.trim(), normalizedMobileNumber: normalizedMobile }
            : {}),
          passwordHash,
          profile: {
            create: {
              ...(input.firstName ? { firstName: input.firstName.trim() } : {}),
              ...(input.lastName ? { lastName: input.lastName.trim() } : {}),
              ...([input.firstName, input.lastName].filter(Boolean).join(' ')
                ? { displayName: [input.firstName, input.lastName].filter(Boolean).join(' ') }
                : {}),
            },
          },
          roles: { create: { roleId: renter.id } },
        },
        include: sessionUserInclude,
      });
    });
    await this.issueEmailToken(user.id, normalizedEmail, AuthTokenType.EMAIL_VERIFICATION);
    const result = await this.createSession(user, input, metadata);
    await this.events.record('REGISTER_SUCCESS', {
      ...metadata,
      sessionId: result.sessionId,
      userId: user.id,
    });
    return result;
  }

  async login(input: LoginDto, metadata: RequestMetadata): Promise<AuthenticationResult> {
    const identifier = this.normalizeIdentifier(input.identifier);
    await this.rateLimits.assertAllowed(
      'login',
      [metadata.ipAddress ?? 'unknown', identifier.value],
      10,
      900,
    );
    const user = await this.database.client.user.findFirst({
      where:
        identifier.kind === 'email'
          ? { normalizedEmail: identifier.value }
          : { normalizedMobileNumber: identifier.value },
      include: sessionUserInclude,
    });
    const valid = await this.crypto.verifyPassword(user?.passwordHash ?? null, input.password);
    if (!user || !valid) {
      if (user) await this.recordFailedLogin(user.id);
      await this.events.record('LOGIN_FAILED', {
        ...metadata,
        data: { identifierKind: identifier.kind },
      });
      throw this.invalidCredentials();
    }
    if (user.loginLockedUntil && user.loginLockedUntil > new Date())
      throw this.invalidCredentials();
    this.assertAccountActive(user.status);
    await this.database.client.user.update({
      data: { failedLoginAttempts: 0, lastLoginAt: new Date(), loginLockedUntil: null },
      where: { id: user.id },
    });
    const result = await this.createSession(user, input, metadata);
    await this.events.record('LOGIN_SUCCESS', {
      ...metadata,
      sessionId: result.sessionId,
      userId: user.id,
    });
    return result;
  }

  async refresh(rawToken: string, metadata: RequestMetadata): Promise<AuthenticationResult> {
    const tokenId = this.tokens.parseOpaqueId(rawToken);
    if (!tokenId) throw this.invalidRefresh();
    await this.rateLimits.assertAllowed(
      'refresh',
      [metadata.ipAddress ?? 'unknown', tokenId],
      60,
      60,
    );
    const found = await this.database.client.refreshToken.findUnique({
      where: { id: tokenId },
      include: { session: { include: { user: { include: sessionUserInclude } } } },
    });
    if (!found || !this.crypto.secureEqual(found.tokenHash, this.tokens.hashOpaque(rawToken))) {
      throw this.invalidRefresh();
    }
    if (found.usedAt) {
      await this.revokeFamily(found.sessionId, 'REFRESH_TOKEN_REUSE');
      await this.events.record('TOKEN_REUSE_DETECTED', {
        ...metadata,
        sessionId: found.sessionId,
        userId: found.session.userId,
      });
      throw new ApplicationException(
        IdentityErrorCode.REFRESH_TOKEN_REUSED,
        'Refresh token reuse was detected. Sign in again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const now = new Date();
    if (
      found.revokedAt ||
      found.expiresAt <= now ||
      found.session.revokedAt ||
      found.session.expiresAt <= now
    ) {
      throw this.invalidRefresh();
    }
    this.assertAccountActive(found.session.user.status);
    const replacementId = randomUUID();
    const replacement = this.tokens.opaqueToken(replacementId);
    try {
      await this.database.client.$transaction(async (transaction) => {
        await transaction.refreshToken.create({
          data: {
            expiresAt: found.session.expiresAt,
            id: replacementId,
            sessionId: found.sessionId,
            tokenHash: replacement.hash,
          },
        });
        const update = await transaction.refreshToken.updateMany({
          data: { usedAt: now, replacedById: replacementId },
          where: { id: found.id, usedAt: null, revokedAt: null },
        });
        if (update.count !== 1) throw new Error('CONCURRENT_REFRESH');
        await transaction.session.update({
          data: { lastUsedAt: now },
          where: { id: found.sessionId },
        });
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'CONCURRENT_REFRESH') throw error;
      await this.revokeFamily(found.sessionId, 'CONCURRENT_REFRESH_REUSE');
      throw new ApplicationException(
        IdentityErrorCode.REFRESH_TOKEN_REUSED,
        'Refresh token reuse was detected. Sign in again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const roles = found.session.user.roles.map(({ role }) => role.code);
    const accessToken = await this.tokens.signAccessToken(
      found.session.userId,
      found.sessionId,
      roles,
    );
    await this.events.record('TOKEN_REFRESH', {
      ...metadata,
      sessionId: found.sessionId,
      userId: found.session.userId,
    });
    return {
      accessToken,
      accessTokenExpiresIn: this.configuration.getOrThrow('ACCESS_TOKEN_TTL_SECONDS', {
        infer: true,
      }),
      refreshToken: replacement.raw,
      sessionId: found.sessionId,
      user: this.publicUser(found.session.user),
    };
  }

  async logout(sessionId: string, metadata: RequestMetadata): Promise<void> {
    const session = await this.database.client.session.findUnique({ where: { id: sessionId } });
    if (!session) return;
    await this.revokeFamily(sessionId, 'USER_LOGOUT');
    await this.events.record('SESSION_REVOKED', { ...metadata, sessionId, userId: session.userId });
  }

  async requestEmailVerification(userId: string, metadata: RequestMetadata): Promise<void> {
    await this.rateLimits.assertAllowed(
      'email-verification',
      [metadata.ipAddress ?? 'unknown', userId],
      5,
      3600,
    );
    const user = await this.database.client.user.findUnique({ where: { id: userId } });
    if (!user?.normalizedEmail || user.emailVerifiedAt) return;
    await this.issueEmailToken(user.id, user.normalizedEmail, AuthTokenType.EMAIL_VERIFICATION);
    await this.events.record('EMAIL_VERIFICATION_REQUESTED', { ...metadata, userId });
  }

  async confirmEmailVerification(rawToken: string, metadata: RequestMetadata): Promise<void> {
    const token = await this.findAuthToken(rawToken, AuthTokenType.EMAIL_VERIFICATION);
    if (token.consumedAt) throw this.invalidEmailToken();
    if (token.expiresAt <= new Date()) {
      throw new ApplicationException(
        IdentityErrorCode.EMAIL_VERIFICATION_TOKEN_EXPIRED,
        'The verification token has expired.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.database.client.$transaction([
      this.database.client.authToken.update({
        data: { consumedAt: new Date() },
        where: { id: token.id },
      }),
      this.database.client.user.update({
        data: { emailVerifiedAt: new Date() },
        where: { id: token.userId },
      }),
    ]);
    await this.events.record('EMAIL_VERIFIED', { ...metadata, userId: token.userId });
  }

  async requestPasswordReset(email: string, metadata: RequestMetadata): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    await this.rateLimits.assertAllowed(
      'password-reset',
      [metadata.ipAddress ?? 'unknown', normalizedEmail],
      5,
      3600,
    );
    const user = await this.database.client.user.findUnique({ where: { normalizedEmail } });
    if (user) {
      await this.issueEmailToken(user.id, normalizedEmail, AuthTokenType.PASSWORD_RESET);
      await this.events.record('PASSWORD_RESET_REQUESTED', { ...metadata, userId: user.id });
    }
  }

  async resetPassword(
    rawToken: string,
    password: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    try {
      this.crypto.assertPasswordPolicy(password);
    } catch (error) {
      throw new ApplicationException(
        IdentityErrorCode.PASSWORD_POLICY_VIOLATION,
        error instanceof Error ? error.message : 'Password does not meet the policy.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const token = await this.findAuthToken(rawToken, AuthTokenType.PASSWORD_RESET);
    if (token.consumedAt) throw this.invalidReset();
    if (token.expiresAt <= new Date()) {
      throw new ApplicationException(
        IdentityErrorCode.PASSWORD_RESET_TOKEN_EXPIRED,
        'The password reset token has expired.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const passwordHash = await this.crypto.hashPassword(password);
    const now = new Date();
    await this.database.client.$transaction(async (transaction) => {
      await transaction.authToken.update({ data: { consumedAt: now }, where: { id: token.id } });
      await transaction.user.update({
        data: { failedLoginAttempts: 0, loginLockedUntil: null, passwordHash },
        where: { id: token.userId },
      });
      await transaction.session.updateMany({
        data: { revocationReason: 'PASSWORD_RESET', revokedAt: now },
        where: { revokedAt: null, userId: token.userId },
      });
      await transaction.devicePushToken.updateMany({
        data: { disabledAt: now, status: PushTokenStatus.DISABLED },
        where: { userId: token.userId, status: PushTokenStatus.ACTIVE },
      });
    });
    await this.events.record('PASSWORD_RESET_COMPLETED', { ...metadata, userId: token.userId });
  }

  async requestOtp(
    input: OtpRequestDto,
    metadata: RequestMetadata,
  ): Promise<{ challengeId?: string }> {
    const mobile = this.normalizeMobile(input.mobileNumber);
    const destinationHash = this.crypto.hashIdentifier(mobile);
    await this.rateLimits.assertAllowed(
      'otp-request',
      [metadata.ipAddress ?? 'unknown', mobile],
      5,
      3600,
    );
    const user = await this.database.client.user.findUnique({
      where: { normalizedMobileNumber: mobile },
    });
    if (!user) return { challengeId: randomUUID() };
    const recent = await this.database.client.otpChallenge.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { consumedAt: null, destinationHash, purpose: input.purpose },
    });
    if (recent && recent.resendAvailableAt > new Date()) {
      throw new ApplicationException(
        IdentityErrorCode.OTP_RESEND_LIMITED,
        'Please wait before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = this.crypto.randomOtp();
    const now = Date.now();
    const challenge = await this.database.client.$transaction(async (transaction) => {
      await transaction.otpChallenge.updateMany({
        data: { consumedAt: new Date(now) },
        where: { consumedAt: null, destinationHash, purpose: input.purpose },
      });
      return transaction.otpChallenge.create({
        data: {
          codeHash: this.crypto.hashToken(code),
          destinationHash,
          destinationLastFour: mobile.slice(-4),
          expiresAt: new Date(
            now + this.configuration.getOrThrow('OTP_TTL_MINUTES', { infer: true }) * 60_000,
          ),
          maxAttempts: this.configuration.getOrThrow('OTP_MAX_ATTEMPTS', { infer: true }),
          purpose: input.purpose,
          resendAvailableAt: new Date(
            now +
              this.configuration.getOrThrow('OTP_RESEND_COOLDOWN_SECONDS', { infer: true }) * 1000,
          ),
          userId: user.id,
        },
      });
    });
    await this.smsProvider.send({
      code,
      template: input.purpose === OtpPurpose.LOGIN ? 'LOGIN_OTP' : 'MOBILE_VERIFICATION_OTP',
      to: mobile,
    });
    return { challengeId: challenge.id };
  }

  async requestMobileVerification(
    userId: string,
    input: MobileVerificationRequestDto,
    metadata: RequestMetadata,
  ): Promise<{ challengeId?: string; mobileNumber: string }> {
    const mobile = this.normalizeMobile(input.mobileNumber);
    const [user, duplicate] = await Promise.all([
      this.database.client.user.findUniqueOrThrow({ where: { id: userId } }),
      this.database.client.user.findUnique({ where: { normalizedMobileNumber: mobile } }),
    ]);
    if (duplicate && duplicate.id !== userId) {
      throw new ApplicationException(
        IdentityErrorCode.MOBILE_ALREADY_EXISTS,
        'This mobile number is already registered.',
        HttpStatus.CONFLICT,
      );
    }
    if (user.normalizedMobileNumber !== mobile || !user.mobileNumber) {
      await this.database.client.user.update({
        data: {
          mobileNumber: mobile,
          mobileVerifiedAt: null,
          normalizedMobileNumber: mobile,
        },
        where: { id: userId },
      });
      await this.events.record('MOBILE_NUMBER_CHANGED', { ...metadata, userId });
    }
    if (user.normalizedMobileNumber === mobile && user.mobileVerifiedAt) {
      return { mobileNumber: mobile };
    }
    const challenge = await this.requestOtp(
      { ...input, mobileNumber: mobile, purpose: OtpPurpose.MOBILE_VERIFICATION },
      metadata,
    );
    return { ...challenge, mobileNumber: mobile };
  }

  async verifyOtp(
    input: OtpVerifyDto,
    metadata: RequestMetadata,
  ): Promise<AuthenticationResult | { verified: true }> {
    await this.rateLimits.assertAllowed(
      'otp-verify',
      [metadata.ipAddress ?? 'unknown', input.challengeId],
      10,
      900,
    );
    const challenge = await this.database.client.otpChallenge.findUnique({
      where: { id: input.challengeId },
      include: { user: { include: sessionUserInclude } },
    });
    if (!challenge || challenge.consumedAt) throw this.invalidOtp();
    if (challenge.expiresAt <= new Date()) {
      throw new ApplicationException(
        IdentityErrorCode.OTP_EXPIRED,
        'The code has expired.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (challenge.attemptCount >= challenge.maxAttempts) {
      throw new ApplicationException(
        IdentityErrorCode.OTP_ATTEMPTS_EXCEEDED,
        'The maximum number of attempts was reached.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!this.crypto.secureEqual(challenge.codeHash, this.crypto.hashToken(input.code))) {
      await this.database.client.otpChallenge.update({
        data: { attemptCount: { increment: 1 } },
        where: { id: challenge.id },
      });
      await this.events.record('OTP_FAILED', { ...metadata, userId: challenge.userId });
      throw this.invalidOtp();
    }
    await this.database.client.otpChallenge.update({
      data: { consumedAt: new Date() },
      where: { id: challenge.id },
    });
    if (challenge.purpose === OtpPurpose.MOBILE_VERIFICATION) {
      await this.database.client.user.update({
        data: { mobileVerifiedAt: new Date() },
        where: { id: challenge.userId },
      });
      return { verified: true };
    }
    this.assertAccountActive(challenge.user.status);
    return this.createSession(challenge.user, input, metadata);
  }

  publicUser(user: Prisma.UserGetPayload<{ include: typeof sessionUserInclude }>) {
    return {
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      id: user.id,
      mobileNumber: user.mobileNumber,
      mobileVerified: Boolean(user.mobileVerifiedAt),
      profile: user.profile,
      roles: user.roles.map(({ role }) => role.code),
      status: user.status,
    };
  }

  private async createSession(
    user: Prisma.UserGetPayload<{ include: typeof sessionUserInclude }>,
    device: DeviceDto,
    metadata: RequestMetadata,
  ): Promise<AuthenticationResult> {
    const sessionId = randomUUID();
    const refreshId = randomUUID();
    const refresh = this.tokens.opaqueToken(refreshId);
    const expiresAt = new Date(
      Date.now() +
        this.configuration.getOrThrow('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
    );
    await this.database.client.session.create({
      data: {
        ...(device.appVersion ? { appVersion: device.appVersion } : {}),
        ...(device.deviceIdentifier ? { deviceIdentifier: device.deviceIdentifier } : {}),
        ...(device.deviceName ? { deviceName: device.deviceName } : {}),
        ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 500) } : {}),
        expiresAt,
        id: sessionId,
        platform: device.platform as SessionPlatform,
        refreshTokens: {
          create: { expiresAt, id: refreshId, tokenHash: refresh.hash },
        },
        userId: user.id,
      },
    });
    const roles = user.roles.map(({ role }) => role.code);
    return {
      accessToken: await this.tokens.signAccessToken(user.id, sessionId, roles),
      accessTokenExpiresIn: this.configuration.getOrThrow('ACCESS_TOKEN_TTL_SECONDS', {
        infer: true,
      }),
      refreshToken: refresh.raw,
      sessionId,
      user: this.publicUser(user),
    };
  }

  private async issueEmailToken(userId: string, email: string, type: AuthTokenType): Promise<void> {
    const id = randomUUID();
    const token = this.tokens.opaqueToken(id);
    const minutes = this.configuration.getOrThrow(
      type === AuthTokenType.EMAIL_VERIFICATION
        ? 'EMAIL_VERIFICATION_TTL_MINUTES'
        : 'PASSWORD_RESET_TTL_MINUTES',
      { infer: true },
    );
    const issuedAt = new Date();
    await this.database.client.$transaction([
      this.database.client.authToken.updateMany({
        data: { consumedAt: issuedAt },
        where: { consumedAt: null, type, userId },
      }),
      this.database.client.authToken.create({
        data: {
          expiresAt: new Date(issuedAt.getTime() + minutes * 60_000),
          id,
          tokenHash: token.hash,
          type,
          userId,
        },
      }),
    ]);
    const publicUrl = this.configuration.getOrThrow('API_PUBLIC_URL', { infer: true });
    const actionBase = `${publicUrl}${
      type === AuthTokenType.EMAIL_VERIFICATION
        ? '/api/v1/auth/email-verification'
        : '/reset-password'
    }`;
    await this.emailProvider.send({
      actionUrl: `${actionBase}?token=${encodeURIComponent(token.raw)}`,
      template: type === AuthTokenType.EMAIL_VERIFICATION ? 'EMAIL_VERIFICATION' : 'PASSWORD_RESET',
      to: email,
      token: token.raw,
    });
  }

  private async findAuthToken(raw: string, type: AuthTokenType) {
    const id = this.tokens.parseOpaqueId(raw);
    if (!id)
      throw type === AuthTokenType.PASSWORD_RESET ? this.invalidReset() : this.invalidEmailToken();
    const token = await this.database.client.authToken.findUnique({ where: { id } });
    if (
      !token ||
      token.type !== type ||
      !this.crypto.secureEqual(token.tokenHash, this.tokens.hashOpaque(raw))
    ) {
      throw type === AuthTokenType.PASSWORD_RESET ? this.invalidReset() : this.invalidEmailToken();
    }
    return token;
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    const user = await this.database.client.user.findUniqueOrThrow({ where: { id: userId } });
    const attempts = user.failedLoginAttempts + 1;
    await this.database.client.user.update({
      data: {
        failedLoginAttempts: attempts,
        ...(attempts >= 5 ? { loginLockedUntil: new Date(Date.now() + 15 * 60_000) } : {}),
      },
      where: { id: userId },
    });
  }

  private async revokeFamily(sessionId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.database.client.$transaction([
      this.database.client.session.updateMany({
        data: { revocationReason: reason, revokedAt: now },
        where: { id: sessionId, revokedAt: null },
      }),
      this.database.client.refreshToken.updateMany({
        data: { revokedAt: now },
        where: { sessionId, revokedAt: null },
      }),
      this.database.client.devicePushToken.updateMany({
        data: { disabledAt: now, status: PushTokenStatus.DISABLED },
        where: { sessionId, status: PushTokenStatus.ACTIVE },
      }),
    ]);
  }

  private normalizeEmail(value: string): string {
    return value.trim().normalize('NFKC').toLowerCase();
  }

  private normalizeMobile(value: string): string {
    try {
      return normalizePhilippineMobile(value);
    } catch {
      throw new ApplicationException(
        'VALIDATION_ERROR',
        'Enter a valid Philippine mobile number.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private normalizeIdentifier(value: string): { kind: 'email' | 'mobile'; value: string } {
    return value.includes('@')
      ? { kind: 'email', value: this.normalizeEmail(value) }
      : { kind: 'mobile', value: this.normalizeMobile(value) };
  }

  private assertAccountActive(status: UserStatus): void {
    if (status === UserStatus.ACTIVE) return;
    const errors = {
      BLOCKED: [IdentityErrorCode.ACCOUNT_BLOCKED, 'This account is blocked.'],
      DEACTIVATED: [IdentityErrorCode.ACCOUNT_DEACTIVATED, 'This account is deactivated.'],
      SUSPENDED: [IdentityErrorCode.ACCOUNT_SUSPENDED, 'This account is suspended.'],
    } as const;
    const [code, message] = errors[status];
    throw new ApplicationException(code, message, HttpStatus.FORBIDDEN);
  }

  private invalidCredentials(): ApplicationException {
    return new ApplicationException(
      IdentityErrorCode.INVALID_CREDENTIALS,
      'Invalid credentials.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidRefresh(): ApplicationException {
    return new ApplicationException(
      IdentityErrorCode.INVALID_REFRESH_TOKEN,
      'The refresh token is invalid or expired.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidReset(): ApplicationException {
    return new ApplicationException(
      IdentityErrorCode.PASSWORD_RESET_TOKEN_INVALID,
      'The password reset token is invalid.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private invalidEmailToken(): ApplicationException {
    return new ApplicationException(
      IdentityErrorCode.EMAIL_VERIFICATION_TOKEN_INVALID,
      'The email verification token is invalid.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private invalidOtp(): ApplicationException {
    return new ApplicationException(
      IdentityErrorCode.OTP_INVALID,
      'The code is invalid.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
