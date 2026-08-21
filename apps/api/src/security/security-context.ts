import type { RoleCode, UserStatus } from '@carrental/database';

export interface RequestPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly roles: readonly RoleCode[];
  readonly permissions: readonly string[];
  readonly status: UserStatus;
}

declare global {
  // Express exposes request augmentation through its global namespace contract.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: RequestPrincipal;
    }
  }
}

export interface RequestMetadata {
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly correlationId?: string;
}
