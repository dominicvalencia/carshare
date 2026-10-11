import type {
  AdminRole,
  AdminStatus,
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  RoleCode,
  UserStatus,
} from '@carrental/database';

export interface OwnerAccessContext {
  readonly capacity: 'OWNER' | 'MANAGER' | 'STAFF';
  readonly membershipId?: string;
  readonly membershipStatus: 'OWNER' | OwnerStaffStatus;
  readonly ownerProfileId: string;
  readonly permissions: readonly string[];
  readonly vehicleScopeMode: OwnerStaffVehicleScopeMode;
}

export interface RequestPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly roles: readonly RoleCode[];
  readonly permissions: readonly string[];
  readonly status: UserStatus;
  readonly adminUserId?: string;
  readonly adminRole?: AdminRole;
  readonly adminStatus?: AdminStatus;
  readonly ownerAccess?: OwnerAccessContext;
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
