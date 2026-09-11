const labels: Record<string, string> = {
  ACTIVE: 'Rental in progress',
  APPROVED: 'Approved',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  CUSTOMER_FUNDS_HELD: 'Customer funds held',
  DRIVER_LICENSE: "Driver's license",
  DRIVER_LICENSE_BACK: "Driver's license back",
  DRIVER_LICENSE_FRONT: "Driver's license front",
  DRIVER_SIDE: 'Driver side',
  EMAIL_VERIFIED: 'Email verified',
  FUEL_OR_BATTERY_DISPLAY: 'Fuel / battery display',
  IDENTITY: 'Identity verification',
  INTERIOR_DASHBOARD: 'Interior / dashboard',
  OTP_FAILED: 'Failed mobile verification attempt',
  OWNER_PAYABLE: 'Owner payable',
  PASSENGER_SIDE: 'Passenger side',
  PENDING_APPROVAL: 'Pending review',
  PLATFORM_COMMISSION: 'Platform commission',
  READY_FOR_PICKUP: 'Ready for pickup',
  RETURN_PENDING: 'Return awaiting confirmation',
  SESSION_REVOKED: 'Session signed out / revoked',
  SUBMITTED: 'Submitted',
  TOKEN_REFRESH: 'Session refreshed',
  UNDER_ADMIN_REVIEW: 'Under administrator review',
  UNDER_REVIEW: 'Under review',
};

export function adminLabel(value: string | null | undefined): string {
  if (!value) return 'Not available';
  return (
    labels[value] ??
    value
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (character) => character.toUpperCase())
  );
}

export function marketplaceRoleLabel(value: string): string {
  return value === 'OWNER' ? 'Vehicle Owner' : adminLabel(value);
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export function formatMoney(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-PH', {
    currency: 'PHP',
    style: 'currency',
  }).format((value ?? 0) / 100);
}

export function formatBasisPoints(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not recorded';
  return `${Math.round(value / 100)}%`;
}

export function evidenceLabel(value: string): string {
  return adminLabel(value);
}

export function visibilityReason(value: string): string {
  const reasons: Record<string, string> = {
    LISTING_NOT_APPROVED: 'Listing approval pending',
    OWNER_NOT_APPROVED: 'Owner verification incomplete',
    PRICING_POLICY_MISSING: 'Pricing is not configured',
    PUBLIC_COVER_PHOTO_MISSING: 'Public cover photo missing',
    REQUIRED_DOCUMENT_INVALID: 'Required vehicle document needs review',
    VEHICLE_NOT_OPERATIONAL: 'Vehicle is not operationally available',
  };
  return reasons[value] ?? adminLabel(value);
}
