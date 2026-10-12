export const API_VERSION = 'v1' as const;
export const API_PREFIX = `api/${API_VERSION}` as const;
export const CORRELATION_ID_HEADER = 'x-correlation-id' as const;

export type ApiMeta = Readonly<Record<string, unknown>>;

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: ApiMeta;
}

export interface ApiErrorDetail {
  readonly field?: string;
  readonly issue: string;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: readonly ApiErrorDetail[];
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: ApiError;
}

export type OwnerStaffRole = 'MANAGER' | 'STAFF';
export type OwnerStaffStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type OwnerStaffVehicleScopeMode = 'ALL_VEHICLES' | 'SELECTED_VEHICLES';
export type OwnerStaffPreset = 'MANAGER' | 'OPERATIONS_STAFF' | 'SUPPORT_STAFF' | 'CUSTOM';
export type OwnerStaffInvitationState = 'PENDING' | 'EXPIRED' | 'REVOKED' | 'CONSUMED';
export type OwnerStaffInvitationChannel = 'SMS' | 'EMAIL';

export interface OwnerStaffVehicleSummary {
  readonly id: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
}

export interface OwnerStaffListItem {
  readonly activatedAt: string | null;
  readonly assignedVehicleCount: number;
  readonly disabledAt: string | null;
  readonly displayName: string;
  readonly email: string | null;
  readonly id: string;
  readonly invitation: {
    readonly channel: OwnerStaffInvitationChannel;
    readonly consumedAt: string | null;
    readonly destination: string;
    readonly expiresAt: string;
    readonly revokedAt: string | null;
    readonly state: OwnerStaffInvitationState;
  } | null;
  readonly invitedAt: string;
  readonly permissions: readonly string[];
  readonly preset: OwnerStaffPreset;
  readonly role: OwnerStaffRole;
  readonly status: OwnerStaffStatus;
  readonly suspendedAt: string | null;
  readonly vehicleScopeMode: OwnerStaffVehicleScopeMode;
}

export interface OwnerStaffDetail extends OwnerStaffListItem {
  readonly assignedVehicles: readonly OwnerStaffVehicleSummary[];
  readonly suspensionReason: string | null;
}

export interface InviteOwnerStaffRequest {
  readonly displayName: string;
  /** @deprecated Existing clients only. New invitations use mobileNumber. */
  readonly email?: string;
  readonly mobileNumber?: string;
  readonly permissions?: readonly string[];
  readonly preset: OwnerStaffPreset;
  readonly role: OwnerStaffRole;
  readonly vehicleIds?: readonly string[];
  readonly vehicleScopeMode: OwnerStaffVehicleScopeMode;
}

export interface UpdateOwnerStaffPermissionsRequest {
  readonly permissions: readonly string[];
}

export interface UpdateOwnerStaffRequest {
  readonly displayName: string;
}

export interface UpdateOwnerStaffVehicleScopeRequest {
  readonly vehicleIds?: readonly string[];
  readonly vehicleScopeMode: OwnerStaffVehicleScopeMode;
}

export interface OwnerStaffReasonRequest {
  readonly reason: string;
}

export interface OwnerStaffInvitationActionResponse {
  readonly id: string;
  readonly status: OwnerStaffStatus;
}

export interface AcceptOwnerStaffInvitationRequest {
  readonly token: string;
}

export interface AcceptOwnerStaffInvitationResponse {
  readonly accepted: true;
  readonly ownerProfileId: string;
  readonly role: OwnerStaffRole;
}

export interface OwnerStaffInvitationPreview {
  readonly channel: OwnerStaffInvitationChannel;
  readonly expiresAt: string;
  readonly role: OwnerStaffRole;
  readonly roleLabel: string;
  readonly state: OwnerStaffInvitationState;
  readonly workspaceLabel: string;
}

export interface OwnerStaffAccessLinkResponse {
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly url: string;
  readonly version: number;
}

export interface OwnerStaffAccessLinkResolution {
  readonly type: 'STAFF_ACCESS';
  readonly valid: boolean;
}

export interface OwnerStaffAccessAuthorization {
  readonly capacity: OwnerStaffRole;
  readonly membershipId: string;
  readonly membershipStatus: 'ACTIVE';
  readonly ownerProfileId: string;
  readonly ownerProfileStatus:
    'DRAFT' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';
  readonly permissions: readonly string[];
  readonly vehicleScopeMode: OwnerStaffVehicleScopeMode;
  readonly workspaceLabel: string | null;
}

export interface OwnerStaffAccessLoginRequest {
  readonly appVersion?: string;
  readonly deviceIdentifier?: string;
  readonly deviceName?: string;
  readonly mobileNumber: string;
  readonly password: string;
  readonly platform?: 'IOS' | 'ANDROID' | 'WEB' | 'UNKNOWN';
}

export interface OwnerStaffAccessLoginResponse<TUser = unknown> {
  readonly accessToken: string;
  readonly accessTokenExpiresIn: number;
  readonly authorizedWorkspace: OwnerStaffAccessAuthorization;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly user: TUser;
}

export interface RequestStaffPasswordResetResponse {
  readonly challengeId: string;
  readonly message: string;
}

export interface VerifyStaffPasswordResetResponse {
  readonly resetToken: string;
}

export interface BeginOwnerStaffInvitationSetupRequest {
  readonly confirmPassword: string;
  readonly password: string;
  readonly token: string;
}

export interface BeginOwnerStaffInvitationSetupResponse {
  readonly challengeId: string;
  readonly expiresAt: string;
}

export interface CompleteOwnerStaffInvitationSetupRequest {
  readonly challengeId: string;
  readonly code: string;
  readonly token: string;
}

export type CompleteOwnerStaffInvitationSetupResponse<TUser = unknown> =
  OwnerStaffAccessLoginResponse<TUser>;

export const SystemErrorCode = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export const IdentityErrorCode = {
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  EMAIL_VERIFICATION_TOKEN_EXPIRED: 'EMAIL_VERIFICATION_TOKEN_EXPIRED',
  EMAIL_VERIFICATION_TOKEN_INVALID: 'EMAIL_VERIFICATION_TOKEN_INVALID',
  INVALID_ACCESS_TOKEN: 'INVALID_ACCESS_TOKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  MOBILE_ALREADY_EXISTS: 'MOBILE_ALREADY_EXISTS',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_RESEND_LIMITED: 'OTP_RESEND_LIMITED',
  OWNER_ALREADY_VERIFIED: 'OWNER_ALREADY_VERIFIED',
  OWNER_PROFILE_NOT_FOUND: 'OWNER_PROFILE_NOT_FOUND',
  OWNER_VERIFICATION_REQUIRED: 'OWNER_VERIFICATION_REQUIRED',
  PASSWORD_POLICY_VIOLATION: 'PASSWORD_POLICY_VIOLATION',
  PASSWORD_RESET_TOKEN_EXPIRED: 'PASSWORD_RESET_TOKEN_EXPIRED',
  PASSWORD_RESET_TOKEN_INVALID: 'PASSWORD_RESET_TOKEN_INVALID',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  ROLE_REQUIRED: 'ROLE_REQUIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
} as const;

export type IdentityErrorCode = (typeof IdentityErrorCode)[keyof typeof IdentityErrorCode];

export const VehicleErrorCode = {
  BLOCKED_PERIOD_OVERLAP: 'BLOCKED_PERIOD_OVERLAP',
  DOCUMENT_REPLACEMENT_REQUIRED: 'DOCUMENT_REPLACEMENT_REQUIRED',
  DUPLICATE_VEHICLE_IDENTIFIER: 'DUPLICATE_VEHICLE_IDENTIFIER',
  INVALID_AVAILABILITY: 'INVALID_AVAILABILITY',
  INVALID_BLOCKED_PERIOD: 'INVALID_BLOCKED_PERIOD',
  INVALID_CATEGORY: 'INVALID_CATEGORY',
  INVALID_EV_POLICY: 'INVALID_EV_POLICY',
  INVALID_FEATURE: 'INVALID_FEATURE',
  INVALID_FUEL_POLICY: 'INVALID_FUEL_POLICY',
  INVALID_FULFILLMENT_POLICY: 'INVALID_FULFILLMENT_POLICY',
  INVALID_LOCATION: 'INVALID_LOCATION',
  INVALID_MILEAGE_POLICY: 'INVALID_MILEAGE_POLICY',
  INVALID_PHOTO_ORDER: 'INVALID_PHOTO_ORDER',
  INVALID_PRICING: 'INVALID_PRICING',
  SECURITY_DEPOSIT_AMOUNT_NOT_ALLOWED: 'SECURITY_DEPOSIT_AMOUNT_NOT_ALLOWED',
  SECURITY_DEPOSIT_CURRENCY_UNSUPPORTED: 'SECURITY_DEPOSIT_CURRENCY_UNSUPPORTED',
  SECURITY_DEPOSIT_INVALID_CONFIGURATION: 'SECURITY_DEPOSIT_INVALID_CONFIGURATION',
  INVALID_TURNAROUND: 'INVALID_TURNAROUND',
  INVALID_VEHICLE_FILE: 'INVALID_VEHICLE_FILE',
  INVALID_VEHICLE_SPECIFICATION: 'INVALID_VEHICLE_SPECIFICATION',
  INVALID_VEHICLE_STATE: 'INVALID_VEHICLE_STATE',
  VEHICLE_DELETE_BLOCKED: 'VEHICLE_DELETE_BLOCKED',
  VEHICLE_INCOMPLETE: 'VEHICLE_INCOMPLETE',
  VEHICLE_NOT_FOUND: 'VEHICLE_NOT_FOUND',
  VEHICLE_OWNER_APPROVAL_ALREADY_PENDING: 'VEHICLE_OWNER_APPROVAL_ALREADY_PENDING',
  VEHICLE_OWNER_APPROVAL_FORBIDDEN: 'VEHICLE_OWNER_APPROVAL_FORBIDDEN',
  VEHICLE_OWNER_APPROVAL_NOT_PENDING: 'VEHICLE_OWNER_APPROVAL_NOT_PENDING',
  VEHICLE_OWNER_APPROVAL_STALE: 'VEHICLE_OWNER_APPROVAL_STALE',
  VEHICLE_NOT_READY_FOR_OWNER_APPROVAL: 'VEHICLE_NOT_READY_FOR_OWNER_APPROVAL',
} as const;

export type VehicleErrorCode = (typeof VehicleErrorCode)[keyof typeof VehicleErrorCode];

export const VehicleRemovalReason = {
  CARSHARE_EXPERIENCE: 'CARSHARE_EXPERIENCE',
  MAINTENANCE_OR_REPAIRS: 'MAINTENANCE_OR_REPAIRS',
  NO_LONGER_RENTING: 'NO_LONGER_RENTING',
  OTHER: 'OTHER',
  REPLACING_VEHICLE: 'REPLACING_VEHICLE',
  SOLD_VEHICLE: 'SOLD_VEHICLE',
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
} as const;

export type VehicleRemovalReason = (typeof VehicleRemovalReason)[keyof typeof VehicleRemovalReason];

export const VEHICLE_REMOVAL_OTHER_REASON_MAX_LENGTH = 500 as const;

export interface SecurityDepositTerms {
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly required: boolean;
}

export interface SecurityDepositPolicyCatalog {
  readonly allowedTiersByCurrency: Readonly<Record<string, readonly number[]>>;
  readonly enabledForConfiguration: boolean;
  readonly executionAvailable: boolean;
  readonly leadHours: number;
  readonly supportedCurrencies: readonly string[];
}

export interface BookingSecurityDepositReadModel extends SecurityDepositTerms {
  readonly actionRequired: boolean;
  readonly eligibleAt: string | null;
  readonly isEligibleNow: boolean;
  readonly blockingPickup: boolean;
  readonly capturedMinor: number;
  readonly executionAvailable: boolean;
  readonly heldMinor: number;
  readonly leadHours: number;
  readonly releasedMinor: number;
  readonly status: string;
  readonly availableAt: string | null;
}

export const DiscoveryErrorCode = {
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_RENTAL_PERIOD: 'INVALID_RENTAL_PERIOD',
  INVALID_SEARCH_LOCATION: 'INVALID_SEARCH_LOCATION',
  MAXIMUM_RENTAL_EXCEEDED: 'MAXIMUM_RENTAL_EXCEEDED',
  MINIMUM_RENTAL_NOT_MET: 'MINIMUM_RENTAL_NOT_MET',
  QUOTE_CONFIGURATION_CHANGED: 'QUOTE_CONFIGURATION_CHANGED',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  SEARCH_RADIUS_EXCEEDED: 'SEARCH_RADIUS_EXCEEDED',
  TOO_MANY_FEATURE_FILTERS: 'TOO_MANY_FEATURE_FILTERS',
  VEHICLE_NOT_PUBLIC: 'VEHICLE_NOT_PUBLIC',
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
  FULFILLMENT_METHOD_UNSUPPORTED: 'FULFILLMENT_METHOD_UNSUPPORTED',
  FULFILLMENT_OUTSIDE_SERVICE_RADIUS: 'FULFILLMENT_OUTSIDE_SERVICE_RADIUS',
  FULFILLMENT_INSUFFICIENT_NOTICE: 'FULFILLMENT_INSUFFICIENT_NOTICE',
  FULFILLMENT_INVALID_DESTINATION: 'FULFILLMENT_INVALID_DESTINATION',
  FULFILLMENT_POLICY_UNAVAILABLE: 'FULFILLMENT_POLICY_UNAVAILABLE',
} as const;

export type DiscoveryErrorCode = (typeof DiscoveryErrorCode)[keyof typeof DiscoveryErrorCode];

export interface PublicVehicleMapPosition {
  readonly mapLatitude: number;
  readonly mapLongitude: number;
  readonly precision: 'APPROXIMATE_CELL';
}

export interface VehicleMapSearchMetadata {
  readonly candidateLimit: number;
  readonly locationPrivacy: 'APPROXIMATE_CELL_AND_WHOLE_KILOMETER_DISTANCE';
  readonly mode: 'MAP';
  readonly resultCount: number;
  readonly resultLimit: number;
}

export const HANDOVER_EVIDENCE_WAIVER_ACKNOWLEDGEMENT_VERSION = 'HANDOVER_EVIDENCE_WAIVER_V1';

export const BookingErrorCode = {
  AMENDMENT_ALREADY_PENDING: 'AMENDMENT_ALREADY_PENDING',
  AMENDMENT_PREVIEW_INVALID: 'AMENDMENT_PREVIEW_INVALID',
  BOOKING_ALREADY_CANCELLED: 'BOOKING_ALREADY_CANCELLED',
  BOOKING_CONFLICT: 'BOOKING_CONFLICT',
  BOOKING_FINANCIAL_AUTHORITY_UNAVAILABLE: 'BOOKING_FINANCIAL_AUTHORITY_UNAVAILABLE',
  BOOKING_HOLD_EXPIRED: 'BOOKING_HOLD_EXPIRED',
  BOOKING_INVALID_STATE: 'BOOKING_INVALID_STATE',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  BOOKING_NOT_OWNED: 'BOOKING_NOT_OWNED',
  BOOKING_OWNER_RESPONSE_EXPIRED: 'BOOKING_OWNER_RESPONSE_EXPIRED',
  BOOKING_STATE_CHANGED: 'BOOKING_STATE_CHANGED',
  DATES_UNAVAILABLE: 'DATES_UNAVAILABLE',
  DESTINATION_NOT_SERVICEABLE: 'DESTINATION_NOT_SERVICEABLE',
  FULFILLMENT_UNAVAILABLE: 'FULFILLMENT_UNAVAILABLE',
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  OWNER_CANNOT_BOOK_OWN_VEHICLE: 'OWNER_CANNOT_BOOK_OWN_VEHICLE',
  OWNER_DECISION_NOT_ALLOWED: 'OWNER_DECISION_NOT_ALLOWED',
  NO_CHANGES: 'NO_CHANGES',
  PREPARATION_TIME_CONFLICT: 'PREPARATION_TIME_CONFLICT',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_NOT_OWNED: 'QUOTE_NOT_OWNED',
  QUOTE_REQUIRED: 'QUOTE_REQUIRED',
  QUOTE_VEHICLE_UNAVAILABLE: 'QUOTE_VEHICLE_UNAVAILABLE',
  RENTER_VERIFICATION_REQUIRED: 'RENTER_VERIFICATION_REQUIRED',
  SECURITY_DEPOSIT_SNAPSHOT_INCONSISTENT: 'SECURITY_DEPOSIT_SNAPSHOT_INCONSISTENT',
  UNSUPPORTED_CHANGE: 'UNSUPPORTED_CHANGE',
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
} as const;

export type BookingErrorCode = (typeof BookingErrorCode)[keyof typeof BookingErrorCode];

export const PaymentErrorCode = {
  PAYMENT_ALREADY_IN_PROGRESS: 'PAYMENT_ALREADY_IN_PROGRESS',
  PAYMENT_CONFIGURATION_INVALID: 'PAYMENT_CONFIGURATION_INVALID',
  PAYMENT_INVALID_STATE: 'PAYMENT_INVALID_STATE',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',
  PAYMENT_RECONCILIATION_REQUIRED: 'PAYMENT_RECONCILIATION_REQUIRED',
  SECURITY_DEPOSIT_AUTH_WINDOW_UNSUPPORTED: 'SECURITY_DEPOSIT_AUTH_WINDOW_UNSUPPORTED',
  SECURITY_DEPOSIT_EXECUTION_DISABLED: 'SECURITY_DEPOSIT_EXECUTION_DISABLED',
  SECURITY_DEPOSIT_NOT_ELIGIBLE: 'SECURITY_DEPOSIT_NOT_ELIGIBLE',
  WEBHOOK_INVALID: 'WEBHOOK_INVALID',
} as const;

export type PaymentErrorCode = (typeof PaymentErrorCode)[keyof typeof PaymentErrorCode];

export const PayoutMethodErrorCode = {
  DUPLICATE: 'PAYOUT_METHOD_DUPLICATE',
  IN_USE: 'PAYOUT_METHOD_IN_USE',
  NOT_FOUND: 'PAYOUT_METHOD_NOT_FOUND',
  NOT_READY: 'PAYOUT_METHOD_NOT_READY',
  UNSUPPORTED: 'PAYOUT_METHOD_UNSUPPORTED',
} as const;

export type PayoutMethodErrorCode =
  (typeof PayoutMethodErrorCode)[keyof typeof PayoutMethodErrorCode];

export const OwnerPayoutMethodStatus = {
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  READY: 'READY',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;

export type OwnerPayoutMethodStatus =
  (typeof OwnerPayoutMethodStatus)[keyof typeof OwnerPayoutMethodStatus];

export type OwnerPayoutMethodType = 'BANK_ACCOUNT' | 'E_WALLET';

export interface OwnerPayoutMethodInstitution {
  readonly code: string;
  readonly displayName: string;
}

export interface OwnerPayoutMethodActions {
  readonly canEdit: false;
  readonly canRemove: boolean;
  readonly canSetPrimary: boolean;
  readonly removalBlockedReason: 'PAYOUT_IN_PROGRESS' | null;
}

export interface OwnerPayoutMethodListItem {
  readonly createdAt: string;
  readonly id: string;
  readonly institution: OwnerPayoutMethodInstitution;
  readonly isPrimary: boolean;
  readonly maskedAccountIdentifier: string;
  readonly status: OwnerPayoutMethodStatus;
  readonly type: OwnerPayoutMethodType;
  readonly updatedAt: string;
}

export interface OwnerPayoutMethodList {
  readonly items: readonly OwnerPayoutMethodListItem[];
}

export interface OwnerPayoutMethodDetail extends OwnerPayoutMethodListItem {
  readonly accountHolderName: string;
  readonly actions: OwnerPayoutMethodActions;
  readonly disabledAt: string | null;
  readonly verifiedAt: string | null;
}

export interface OwnerPayoutMethodCatalogField {
  readonly key: 'ACCOUNT_HOLDER_NAME' | 'ACCOUNT_IDENTIFIER';
  readonly label: string;
  readonly maxLength: number;
  readonly minLength: number;
}

export interface OwnerPayoutMethodCatalogItem {
  readonly code: string;
  readonly displayName: string;
  readonly fields: readonly OwnerPayoutMethodCatalogField[];
  readonly supportsPrimary: true;
  readonly supportsRemoval: true;
  readonly type: OwnerPayoutMethodType;
}

export interface OwnerPayoutMethodCatalog {
  readonly country: 'PH';
  readonly currency: 'PHP';
  readonly methods: readonly OwnerPayoutMethodCatalogItem[];
}

export const OwnerFinancialErrorCode = {
  AUTHORITY_INCONSISTENT: 'OWNER_FINANCIAL_AUTHORITY_INCONSISTENT',
  EARNING_NOT_FOUND: 'OWNER_EARNING_NOT_FOUND',
} as const;

export type OwnerFinancialErrorCode =
  (typeof OwnerFinancialErrorCode)[keyof typeof OwnerFinancialErrorCode];

export const OwnerFinancialActivityScope = {
  ADJUSTMENTS: 'ADJUSTMENTS',
  PAID: 'PAID',
  UPCOMING: 'UPCOMING',
} as const;

export type OwnerFinancialActivityScope =
  (typeof OwnerFinancialActivityScope)[keyof typeof OwnerFinancialActivityScope];

export type OwnerFinancialActivityType =
  'ADJUSTMENT' | 'COMPENSATION' | 'EARNING' | 'PAYOUT' | 'PENALTY' | 'REVERSAL';

export interface OwnerFinancialMethodSummary {
  readonly channel: string;
  readonly maskedIdentifier: string;
}

export interface OwnerUpcomingPayout {
  readonly amountMinor: number;
  readonly currency: string;
  readonly expectedAt: null;
  readonly id: string;
  readonly method: OwnerFinancialMethodSummary;
  readonly publicReference: string;
  readonly status: string;
}

export interface OwnerEarningsSummary {
  readonly availableMinor: number;
  readonly currency: string;
  readonly heldMinor: number;
  readonly payoutReadyMinor: number;
  readonly pendingMinor: number;
  readonly upcomingPayout: OwnerUpcomingPayout | null;
}

export interface OwnerFinancialActivityItem {
  readonly amountMinor: number;
  readonly bookingReference?: string;
  readonly currency: string;
  readonly detailTarget: { readonly id: string; readonly resource: 'EARNING' | 'PAYOUT' } | null;
  readonly id: string;
  readonly occurredAt: string;
  readonly payoutReference?: string;
  readonly reasonCode?: string;
  readonly status: string;
  readonly subtitle: string;
  readonly title: string;
  readonly type: OwnerFinancialActivityType;
  readonly vehicleSummary?: string;
}

export interface OwnerFinancialActivityPage {
  readonly items: readonly OwnerFinancialActivityItem[];
  readonly nextPage: number | null;
  readonly page: number;
  readonly pageSize: number;
}

export interface OwnerEarningDetail {
  readonly additionalCompensationMinor: number;
  readonly adjustmentAmountMinor: number;
  readonly booking: {
    readonly publicReference: string;
    readonly renterDisplayName: string;
    readonly rentalEnd: string;
    readonly rentalStart: string;
    readonly vehicleSummary: string;
  };
  readonly collectionEarningMinor: number;
  readonly commissionAmountMinor: number;
  readonly currency: string;
  readonly deliveryEarningMinor: number;
  readonly grossRentalAmountMinor: number;
  readonly heldAmountMinor: number;
  readonly holds: readonly {
    readonly amountMinor: number;
    readonly reason: string;
    readonly status: string;
  }[];
  readonly id: string;
  readonly netEarningAmountMinor: number;
  readonly payout: {
    readonly id: string;
    readonly publicReference: string;
    readonly status: string;
  } | null;
  readonly projectedTotalMinor: number;
  readonly status: string;
}

export interface OwnerPayoutDetail {
  readonly adjustmentAmountMinor: number;
  readonly amountMinor: number;
  readonly approvedAt: string | null;
  readonly cancellationPenaltyRecoveryMinor: number;
  readonly createdAt: string;
  readonly currency: string;
  readonly destination: OwnerFinancialMethodSummary;
  readonly failedAt: string | null;
  readonly grossEligibleEarningsMinor: number;
  readonly id: string;
  readonly includedEarnings: readonly {
    readonly amountMinor: number;
    readonly bookingReference: string;
    readonly earningId: string;
  }[];
  readonly paidAt: string | null;
  readonly publicReference: string;
  readonly status: string;
  readonly submittedAt: string | null;
}

export const RentalErrorCode = {
  CLAIM_DEADLINE_PASSED: 'CLAIM_DEADLINE_PASSED',
  EVIDENCE_FILE_INVALID: 'EVIDENCE_FILE_INVALID',
  INSPECTION_MEDIA_INCOMPLETE: 'INSPECTION_MEDIA_INCOMPLETE',
  INSPECTION_MEASUREMENT_REQUIRED: 'INSPECTION_MEASUREMENT_REQUIRED',
  INSPECTION_MEASUREMENT_NOT_APPLICABLE: 'INSPECTION_MEASUREMENT_NOT_APPLICABLE',
  PICKUP_CODE_ATTEMPTS_EXCEEDED: 'PICKUP_CODE_ATTEMPTS_EXCEEDED',
  PICKUP_CODE_EXPIRED: 'PICKUP_CODE_EXPIRED',
  PICKUP_CODE_INVALID: 'PICKUP_CODE_INVALID',
  PICKUP_CODE_REUSED: 'PICKUP_CODE_REUSED',
  PICKUP_CONFIRMATIONS_REQUIRED: 'PICKUP_CONFIRMATIONS_REQUIRED',
  PICKUP_INSPECTION_REQUIRED: 'PICKUP_INSPECTION_REQUIRED',
  PICKUP_WINDOW_CLOSED: 'PICKUP_WINDOW_CLOSED',
  PICKUP_WINDOW_NOT_OPEN: 'PICKUP_WINDOW_NOT_OPEN',
  RENTAL_STATE_INVALID: 'RENTAL_STATE_INVALID',
  RETURN_CONFIRMATION_IMMUTABLE: 'RETURN_CONFIRMATION_IMMUTABLE',
  RETURN_ODOMETER_INVALID: 'RETURN_ODOMETER_INVALID',
} as const;

export type RentalErrorCode = (typeof RentalErrorCode)[keyof typeof RentalErrorCode];

export const ClaimErrorCode = {
  ADDITIONAL_CHARGE_INVALID_STATE: 'ADDITIONAL_CHARGE_INVALID_STATE',
  ADDITIONAL_CHARGE_NOT_FOUND: 'ADDITIONAL_CHARGE_NOT_FOUND',
  CLAIM_ALREADY_RESPONDED: 'CLAIM_ALREADY_RESPONDED',
  CLAIM_AMOUNT_EXCEEDS_POLICY: 'CLAIM_AMOUNT_EXCEEDS_POLICY',
  CLAIM_DEADLINE_PASSED: 'CLAIM_DEADLINE_PASSED',
  CLAIM_EVIDENCE_REQUIRED: 'CLAIM_EVIDENCE_REQUIRED',
  CLAIM_FORMULA_NOT_APPLICABLE: 'CLAIM_FORMULA_NOT_APPLICABLE',
  CLAIM_INVALID_STATE: 'CLAIM_INVALID_STATE',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  CLAIM_PAYMENT_FAILED: 'CLAIM_PAYMENT_FAILED',
  CLAIM_RESPONSE_DEADLINE_PASSED: 'CLAIM_RESPONSE_DEADLINE_PASSED',
  DISPUTE_INVALID_STATE: 'DISPUTE_INVALID_STATE',
  DISPUTE_NOT_FOUND: 'DISPUTE_NOT_FOUND',
  REFUND_INVALID_STATE: 'REFUND_INVALID_STATE',
} as const;

export type ClaimErrorCode = (typeof ClaimErrorCode)[keyof typeof ClaimErrorCode];

export type SystemErrorCode = (typeof SystemErrorCode)[keyof typeof SystemErrorCode];
/** Immutable booking policy metadata. Null denotes legacy/unclassified; never custody evidence. */
export const HANDOVER_WORKFLOW_VERSION_B4 = 1 as const;
