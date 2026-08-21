export type OwnerStatus = 'DRAFT' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';

export interface AuthUser {
  readonly id: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly mobileNumber: string | null;
  readonly mobileVerified: boolean;
  readonly roles: readonly string[];
  readonly status: string;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly user: AuthUser;
}
