export type OwnerStatus = 'DRAFT' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';

export interface OwnerWorkspace {
  readonly capacity: 'OWNER' | 'MANAGER' | 'STAFF';
  readonly membershipId?: string;
  readonly membershipStatus: 'OWNER' | 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  readonly ownerProfileId: string;
  readonly ownerProfileStatus: OwnerStatus;
  readonly permissions: readonly string[];
  readonly vehicleScopeMode: 'ALL_VEHICLES' | 'SELECTED_VEHICLES';
  readonly workspaceLabel: string | null;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly mobileNumber: string | null;
  readonly mobileVerified: boolean;
  readonly roles: readonly string[];
  readonly ownerWorkspaces: readonly OwnerWorkspace[];
  readonly status: string;
  readonly profile: {
    readonly initialMarketplacePersona: 'RENTER' | 'OWNER' | null;
    readonly ownerOnboardingFirstEnteredAt: string | null;
    readonly renterOnboardingCompletedAt: string | null;
  } | null;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly user: AuthUser;
}
