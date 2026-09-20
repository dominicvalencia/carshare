'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  AdminActionBar,
  AdminDefinitionList,
  AdminDetailHeader,
  AdminEvidenceCard,
  AdminSection,
  AdminSummaryCard,
  AdminSummaryGrid,
  AdminTechnicalDetails,
  AdminTimeline,
  DataTable,
  EmptyState,
  StatusBadge,
} from './AdminPrimitives';
import {
  adminLabel,
  evidenceLabel,
  formatBasisPoints,
  formatDate,
  formatMoney,
  marketplaceRoleLabel,
  visibilityReason,
} from './admin-presentation';
import { AdminUserDetail } from './AdminUserDetail';
import { Phase10AdminPanels } from './Phase10AdminPanels';
import { RenterVerificationAdminPanel } from './RenterVerificationAdminPanel';
import { OwnerVerificationAdminPanel } from './OwnerVerificationAdminPanel';
import { InspectionCorrectionsAdminPanel } from './InspectionCorrectionsAdminPanel';
import { useAdminSession } from './AdminSession';
import { StaffManagementPanel } from './StaffManagementPanel';
import { StaffCreatePanel } from './StaffCreatePanel';
import { StaffDetailPanel } from './StaffDetailPanel';
import { OwnerStaffActivityPanel } from './OwnerStaffActivityPanel';
import { AdminAuditPanel } from './AdminAuditPanel';
import { OwnerOverviewDashboard, type OwnerAnalyticsOverview } from './OwnerOverviewDashboard';
import {
  OwnerRevenueDashboard,
  type OwnerRevenueSummary,
  type OwnerRevenueTrends,
} from './OwnerRevenueDashboard';
import {
  OwnerMarketplaceReportsDashboard,
  type OwnerMarketplaceReport,
  type OwnerMarketplaceTrends,
} from './OwnerMarketplaceReportsDashboard';

import { API_URL, adminEnvironment } from './admin-environment';
interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { message: string };
}
interface Owner {
  readonly id: string;
  readonly status: string;
  readonly legalName: string | null;
  readonly submittedAt: string | null;
  readonly user: {
    readonly email: string | null;
    readonly profile: { readonly displayName: string | null } | null;
  };
}
interface User {
  readonly id: string;
  readonly email: string | null;
  readonly mobileNumber: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly profile: {
    readonly displayName: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
  } | null;
  readonly roles: readonly { readonly role: { readonly code: string } }[];
  readonly verifications?: readonly { readonly status: string; readonly type: string }[];
  readonly ownerProfile: { readonly status: string } | null;
  readonly _count: {
    readonly ownedVehicles: number;
    readonly ownerBookings: number;
    readonly renterBookings: number;
  };
}
interface VehicleSummary {
  readonly id: string;
  readonly status: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly submittedAt: string | null;
  readonly operationalStatus: string;
  readonly category: { readonly name: string } | null;
  readonly ownerProfile: {
    readonly status: string;
    readonly legalName: string | null;
    readonly user: { readonly email: string | null };
  };
}
interface VehicleDetail extends VehicleSummary {
  readonly knownIssues: readonly VehicleKnownIssue[];
  readonly publishedRating: { readonly averageRating: string | null; readonly reviewCount: number };
  readonly modelYear: number | null;
  readonly powertrain: string | null;
  readonly fuelType: string | null;
  readonly reviewReason: string | null;
  readonly location: {
    readonly latitude: string;
    readonly longitude: string;
    readonly city: string;
    readonly province: string;
  } | null;
  readonly documents: Array<{
    readonly id: string;
    readonly replacedAt: string | null;
    readonly definition: { readonly name: string };
    readonly fileAsset: { readonly id: string; readonly originalName: string };
  }>;
  readonly photos: Array<{
    readonly id: string;
    readonly perspective: string;
    readonly fileAsset: { readonly id: string; readonly originalName: string };
  }>;
  readonly policyVersions: Array<{
    readonly version: number;
    readonly dailyRateMinor: number;
    readonly mileagePolicy: string;
    readonly turnaroundMinutes: number;
  }>;
  readonly statusHistory: Array<{
    readonly id: string;
    readonly previousStatus: string | null;
    readonly newStatus: string;
    readonly reason: string | null;
    readonly occurredAt: string;
  }>;
  readonly auditLogs: Array<{
    readonly id: string;
    readonly action: string;
    readonly reason: string | null;
    readonly correlationId: string | null;
    readonly occurredAt: string;
  }>;
}
interface VehicleKnownIssue {
  readonly id: string;
  readonly category: string;
  readonly vehicleArea: string;
  readonly classification: string;
  readonly description: string;
  readonly status: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly evidence?: readonly { readonly fileAsset: { readonly id: string } }[];
}
interface PublicVisibility {
  readonly discoverable: boolean;
  readonly reasons: readonly string[];
  readonly previewVehicleId?: string;
}
interface AdminBooking {
  readonly bookingId: string;
  readonly publicReference: string;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly holdExpiresAt: string | null;
  readonly ownerResponseDeadlineAt: string | null;
  readonly vehicle: { make: string | null; model: string | null };
  readonly diagnostics: {
    canProgress: boolean;
    reason: string | null;
    occupancy: {
      active: boolean;
      occupiedStart: string;
      occupiedEnd: string;
      releaseReason: string | null;
    } | null;
  };
}
interface FinancialDetail {
  readonly bookingId: string;
  readonly payments: readonly {
    paymentId: string;
    provider: string;
    providerState: string | null;
    status: string;
    amountMinor: number;
    authorizedAmountMinor: number;
    capturedAmountMinor: number;
    reconciliationRequired: boolean;
  }[];
  readonly commission: {
    calculatedCommissionMinor: number;
    rateBasisPoints: number;
    scope: string;
  } | null;
  readonly earning: { netEarningAmountMinor: number; status: string } | null;
  readonly ledger: readonly {
    id: string;
    type: string;
    postedAt: string;
    entries: readonly { account: { code: string }; amountMinor: number }[];
  }[];
}
interface CommissionRule {
  readonly id: string;
  readonly scope: string;
  readonly version: number;
  readonly rateBasisPoints: number;
  readonly disabledAt: string | null;
  readonly reason: string;
}
interface OperationalRental {
  readonly overdueHandoverRecovery?: {
    readonly scope: string;
    readonly responseDeadlineAt: string;
    readonly reminders: readonly {
      readonly stage: string;
      readonly channel: string;
      readonly status: string;
      readonly scheduledAt: string;
      readonly submittedAt: string | null;
      readonly deliveredAt: string | null;
      readonly failureCategory: string | null;
      readonly safeFailureMessage: string | null;
    }[];
  } | null;
  readonly pickupHandoverReport?: {
    readonly reportedByUserId: string;
    readonly reportedPhysicalHandoverAt: string;
    readonly reportedAt: string;
    readonly response: {
      readonly respondedByUserId: string;
      readonly decision: string;
      readonly proposedPhysicalHandoverAt: string | null;
      readonly respondedAt: string;
    } | null;
  } | null;
  readonly handoverEvidenceWaivers?: readonly {
    phase: string;
    waivedByUserId: string;
    decidedAt: string;
    acknowledgementVersion: string;
  }[];
  readonly workflowCompliance?: {
    readonly workflow: string;
    readonly payoutBlocker: string | null;
    readonly start: {
      overdue: boolean;
      outstandingStep: string | null;
      custodyRecorded: boolean;
      evidenceOutcome?: string;
      graceBoundary: string | null;
    };
    readonly return: {
      overdue: boolean;
      outstandingStep: string | null;
      custodyRecorded: boolean;
      evidenceOutcome?: string;
      graceBoundary: string | null;
    };
  };
  readonly id: string;
  readonly publicReference: string;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly actualPickupAt: string | null;
  readonly actualReturnAt: string | null;
  readonly claimDeadlineAt: string | null;
  readonly operationalHold: boolean;
  readonly cancellation: { reasonCode: string; reasonText: string | null } | null;
  readonly cancellationSettlement: {
    capturedAmountMinor: string;
    commissionRetainedMinor: string;
    currency: string;
    deliveryCompleted: boolean;
    deliveryCompletionBasis: string;
    deliveryRefundedMinor: string;
    deliveryRetainedMinor: string;
    collectionRefundedMinor: string;
    refundAmountMinor: string;
    refund: { status: string } | null;
  } | null;
  readonly currentVehicleKnownIssues?: readonly VehicleKnownIssue[];
  readonly fulfillment: {
    readonly startMethod: string;
    readonly endMethod: string;
    readonly legacyCompatibility: boolean;
  };
  readonly handoverTravel: {
    readonly startStatus: string | null;
    readonly returnStatus: string | null;
    readonly events: readonly {
      actorUserId: string;
      phase: string;
      status: string;
      occurredAt: string;
    }[];
  };
  readonly vehicle: { make: string | null; model: string | null; powertrain: string | null };
  readonly inspections: readonly {
    id: string;
    type: string;
    odometerMeters: string | null;
    fuelBasisPoints: number | null;
    batterySocBasisPoints: number | null;
    media: readonly { perspective: string; fileAsset: { id: string; originalName: string } }[];
    conditionDisclosureState: string | null;
    conditionIssues: readonly {
      id: string;
      category: string;
      vehicleArea: string;
      classification: string;
      description: string;
      evidence: readonly { inspectionMedia: { fileAsset: { id: string } } }[];
    }[];
    confirmations: readonly {
      role: string;
      decision: string;
      reason: string | null;
      discrepancyResponse: {
        responseType: string;
        responseText: string;
        resolutionReview: {
          decision: string;
          reason: string | null;
          operationsResolution: { outcome: string; reason: string } | null;
        } | null;
      } | null;
      discrepancyResponses: readonly {
        roundNumber: number;
        responseType: string;
        responseText: string;
        respondedAt: string;
        resolutionReview: { decision: string; reason: string | null } | null;
      }[];
    }[];
  }[];
  readonly usageSummary: {
    distanceTravelledKm: number;
    includedDistanceKm: number | null;
    excessDistanceKm: number;
    fuelDeficiencyBasisPoints: number | null;
    socDeficiencyBasisPoints: number | null;
    lateDurationSeconds: number;
    returnDisputed: boolean;
  } | null;
  readonly postReturnClaims: readonly {
    id: string;
    category: string;
    status: string;
    submittedAt: string;
  }[];
  readonly rentalIncidents: readonly {
    id: string;
    category: string;
    severity: string;
    status: string;
    disputes: readonly { id: string; status: string; reason: string }[];
    pickupDiscrepancyResponse: {
      responseType: string;
      responseText: string;
      resolutionReview: { decision: string; reason: string | null } | null;
    } | null;
    pickupDiscrepancyResponses: readonly {
      roundNumber: number;
      responseType: string;
      responseText: string;
      resolutionReview: { decision: string; reason: string | null } | null;
    }[];
    pickupHandoverOperationsResolution: {
      outcome: string;
      reason: string;
      resolvedAt: string;
    } | null;
  }[];
  readonly statusHistory: readonly {
    id: string;
    toStatus: string;
    occurredAt: string;
    reasonCode: string | null;
  }[];
}
interface ClaimReview {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly status: string;
  readonly severity: string;
  readonly submittedAt: string;
  readonly responseDeadlineAt: string | null;
  readonly booking: OperationalRental & {
    readonly ownerEarning: {
      id: string;
      status: string;
      netEarningAmountMinor: number;
      additionalCompensationMinor: number;
      availableAt: string | null;
      holds: readonly { id: string; amountMinor: number; status: string; rationale: string }[];
    } | null;
    readonly payments: readonly { id: string; status: string; purpose: string }[];
  };
  readonly calculations: readonly {
    amountMinor: number;
    formulaVersion: string;
    inputs: Record<string, unknown>;
    quantity: number;
    unit: string;
    unitRateMinor: number;
  }[];
  readonly evidence: readonly {
    id: string;
    participantRole: string;
    evidenceType: string;
    fileAsset: { id: string; originalName: string };
  }[];
  readonly response: { decision: string; explanation: string | null } | null;
  readonly adjudications: readonly {
    id: string;
    outcome: string;
    approvedAmountMinor: number;
    reason: string;
  }[];
  readonly disputes: readonly { id: string; status: string; reason: string }[];
  readonly additionalCharge: {
    id: string;
    status: string;
    approvedAmountMinor: number;
    collectedAmountMinor: number;
    refundedAmountMinor: number;
  } | null;
}
interface ClaimQueue {
  readonly items: readonly ClaimReview[];
}
interface ClaimDetail {
  readonly claim: ClaimReview;
  readonly ledger: FinancialDetail['ledger'];
}
interface PayoutQueueItem {
  readonly availableEligibleMinor: number;
  readonly blockers: readonly string[];
  readonly destination: {
    readonly destinationChannel: string;
    readonly maskedAccountIdentifier: string;
    readonly status: string;
  } | null;
  readonly owner: {
    readonly displayName: string | null;
    readonly id: string;
    readonly status: string;
  };
  readonly payoutEligibility: string;
  readonly previousFailures: number;
  readonly provider: string;
}
interface AdminPayout {
  readonly amountMinor: number;
  readonly destination: {
    readonly channel: string;
    readonly maskedIdentifier: string;
  };
  readonly diagnostics: {
    readonly differenceMinor: number;
    readonly lastProviderRetrieval: string | null;
    readonly ledgerBalanced: boolean;
    readonly ledgerSettlementStatus: string;
    readonly problem: boolean;
    readonly providerReference: string | null;
  };
  readonly id: string;
  readonly items: readonly {
    readonly amountMinor: number;
    readonly bookingReference: string;
    readonly earningId: string;
  }[];
  readonly owner: { readonly displayName: string | null; readonly id: string };
  readonly provider: string;
  readonly providerState: string | null;
  readonly publicReference: string;
  readonly status: string;
}

export type AdminModule =
  | 'audit'
  | 'bookings'
  | 'claims'
  | 'commissions'
  | 'dashboard'
  | 'inspection-corrections'
  | 'owner-verification'
  | 'owner-overview'
  | 'owner-revenue'
  | 'owner-reports'
  | 'owner-staff-activity'
  | 'payouts'
  | 'renter-verification'
  | 'rentals'
  | 'support'
  | 'staff'
  | 'staff-new'
  | 'staff-detail'
  | 'trust-safety'
  | 'users'
  | 'vehicles';

const moduleTitles: Record<AdminModule, { eyebrow: string; title: string; description: string }> = {
  audit: {
    eyebrow: 'ACCOUNTABILITY',
    title: 'Administrative audit log',
    description: 'Review immutable attribution for sensitive administrative actions.',
  },
  dashboard: {
    eyebrow: 'OPERATIONS OVERVIEW',
    title: 'Dashboard',
    description: 'Actionable queues and marketplace operations at a glance.',
  },
  users: {
    eyebrow: 'USER OPERATIONS',
    title: 'Accounts',
    description: 'Look up renter and owner accounts without changing identity authority.',
  },
  'renter-verification': {
    eyebrow: 'VERIFICATION',
    title: 'Renter KYC',
    description: 'Review submitted identity evidence through audited, temporary access.',
  },
  'owner-verification': {
    eyebrow: 'VERIFICATION',
    title: 'Owner verification',
    description: 'Review owners waiting for operational approval.',
  },
  vehicles: {
    eyebrow: 'VEHICLE OPERATIONS',
    title: 'Vehicle review',
    description: 'Review listing evidence, configuration, and public eligibility.',
  },
  bookings: {
    eyebrow: 'BOOKINGS',
    title: 'Booking diagnostics',
    description: 'Inspect authoritative lifecycle, occupancy, and financial timelines.',
  },
  rentals: {
    eyebrow: 'RENTAL OPERATIONS',
    title: 'Pickup, active, and return queue',
    description: 'Investigate evidence and use audited intervention commands.',
  },
  claims: {
    eyebrow: 'CLAIMS & DISPUTES',
    title: 'Claims review',
    description: 'Review evidence, adjudication, disputes, and approved charges.',
  },
  payouts: {
    eyebrow: 'PAYMENTS & PAYOUTS',
    title: 'Owner payout operations',
    description: 'Control eligibility, submission, and provider reconciliation.',
  },
  support: {
    eyebrow: 'CUSTOMER OPERATIONS',
    title: 'Support',
    description: 'Manage customer cases and internal operational notes.',
  },
  'trust-safety': {
    eyebrow: 'TRUST & SAFETY',
    title: 'Moderation reports',
    description: 'Review reports through scoped moderation workflows.',
  },
  'inspection-corrections': {
    eyebrow: 'OPERATIONS',
    title: 'Inspection corrections',
    description: 'Review proposed corrections without mutating original evidence.',
  },
  commissions: {
    eyebrow: 'PLATFORM SETTINGS',
    title: 'Commission configuration',
    description: 'Manage prospective versioned rules; historical snapshots remain immutable.',
  },
  staff: {
    eyebrow: 'ACCESS MANAGEMENT',
    title: 'Staff management',
    description: 'Invite staff and manage explicitly scoped administrative access.',
  },
  'staff-new': {
    eyebrow: 'ACCESS MANAGEMENT',
    title: 'Invite a staff member',
    description: 'Choose an access level and start from reviewed permission recommendations.',
  },
  'staff-detail': {
    eyebrow: 'ACCESS MANAGEMENT',
    title: 'Staff access details',
    description: 'Review identity, access level, and explicit permission grants.',
  },
  'owner-overview': {
    eyebrow: 'CARSHARE OWNER',
    title: 'Business performance overview',
    description: 'Authoritative marketplace activity and financial performance at a glance.',
  },
  'owner-revenue': {
    eyebrow: 'OWNER FINANCE',
    title: 'Revenue & earnings',
    description:
      'Understand marketplace collections, CarShare earnings, owner liabilities and payout activity.',
  },
  'owner-reports': {
    eyebrow: 'OWNER REPORTING',
    title: 'Marketplace Performance',
    description:
      'Understand booking activity, rental progression, customer growth and marketplace supply.',
  },
  'owner-staff-activity': {
    eyebrow: 'OWNER OVERSIGHT',
    title: 'Staff activity',
    description: 'Review factual administrative actions from the immutable audit trail.',
  },
};

export function AdminConsole({
  activeModule,
  detailId,
}: {
  readonly activeModule: AdminModule;
  readonly detailId?: string;
}) {
  const { accessToken, admin, can, logout } = useAdminSession();
  const [query, setQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('ALL');
  const [userStatusFilter, setUserStatusFilter] = useState('ALL');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    activeModule === 'vehicles' ? (detailId ?? null) : null,
  );
  const [selectedFinanceReference, setSelectedFinanceReference] = useState<string | null>(
    activeModule === 'bookings' ? (detailId ?? null) : null,
  );
  const [selectedRentalReference, setSelectedRentalReference] = useState<string | null>(
    activeModule === 'rentals' ? (detailId ?? null) : null,
  );
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(
    activeModule === 'claims' ? (detailId ?? null) : null,
  );
  const [selectedPayoutId, setSelectedPayoutId] = useState<string | null>(
    activeModule === 'payouts' ? (detailId ?? null) : null,
  );
  const [claimStatus, setClaimStatus] = useState('');
  const [claimCategory, setClaimCategory] = useState('');
  const [claimSeverity, setClaimSeverity] = useState('');
  const [claimMinimumAgeHours, setClaimMinimumAgeHours] = useState('');
  const client = useQueryClient();
  const isActive = (...modules: AdminModule[]) => modules.includes(activeModule);
  const requiredPermission: Partial<Record<AdminModule, string>> = {
    audit: 'audit.read',
    bookings: 'vehicles.read',
    claims: 'claims.read',
    commissions: 'commissions.read',
    'inspection-corrections': 'inspections.read',
    'owner-verification': 'owners.read',
    payouts: 'payouts.read',
    'renter-verification': 'renters.verifications.read',
    rentals: 'rentals.read',
    staff: 'staff.view',
    'staff-new': 'staff.create',
    'staff-detail': 'staff.edit',
    support: 'support.read',
    'trust-safety': 'moderation.read',
    users: 'users.read',
    vehicles: 'vehicles.read',
  };
  const ownerOnlyModule = [
    'owner-overview',
    'owner-revenue',
    'owner-reports',
    'owner-staff-activity',
  ].includes(activeModule);
  const missingStaffDetailPermission =
    activeModule === 'staff-detail' && (!can('staff.edit') || !can('staff.permissions.manage'));
  const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
    const envelope = (await response.json()) as Envelope<T>;
    if (response.status === 401) {
      logout();
      throw new Error('Your administrative session expired. Sign in again.');
    }
    if (!response.ok || !envelope.success)
      throw new Error(envelope.error?.message ?? 'Request failed.');
    return envelope.data as T;
  };
  const owners = useQuery({
    queryKey: ['admin-owners'],
    queryFn: () => api<Owner[]>('/admin/owners?status=PENDING_VERIFICATION'),
    enabled: (activeModule === 'dashboard' && can('owners.read')) || isActive('owner-verification'),
  });
  const users = useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => api<User[]>(`/admin/users?query=${encodeURIComponent(query)}`),
    enabled: isActive('users'),
  });
  const vehicles = useQuery({
    queryKey: ['admin-vehicles'],
    queryFn: () => api<VehicleSummary[]>('/admin/vehicles?status=PENDING_APPROVAL'),
    enabled: (activeModule === 'dashboard' && can('vehicles.read')) || isActive('vehicles'),
  });
  const vehicle = useQuery({
    queryKey: ['admin-vehicle', selectedVehicleId],
    queryFn: () => api<VehicleDetail>(`/admin/vehicles/${selectedVehicleId}`),
    enabled: Boolean(isActive('vehicles') && selectedVehicleId),
  });
  const publicVisibility = useQuery({
    queryKey: ['admin-vehicle-public-visibility', selectedVehicleId],
    queryFn: () => api<PublicVisibility>(`/admin/vehicles/${selectedVehicleId}/public-visibility`),
    enabled: Boolean(isActive('vehicles') && selectedVehicleId),
  });
  const bookings = useQuery({
    queryKey: ['admin-bookings'],
    queryFn: () => api<AdminBooking[]>('/admin/bookings'),
    enabled: (activeModule === 'dashboard' && can('vehicles.read')) || isActive('bookings'),
  });
  const financialDetail = useQuery({
    queryKey: ['admin-finance-booking', selectedFinanceReference],
    queryFn: () => api<FinancialDetail>(`/admin/finance/bookings/${selectedFinanceReference}`),
    enabled: Boolean(isActive('bookings') && selectedFinanceReference),
  });
  const commissionRules = useQuery({
    queryKey: ['commission-rules'],
    queryFn: () => api<CommissionRule[]>('/admin/finance/commission-rules'),
    enabled: isActive('commissions'),
  });
  const rentalQueue = useQuery({
    queryKey: ['admin-rentals'],
    queryFn: () => api<OperationalRental[]>('/admin/rentals'),
    enabled: (activeModule === 'dashboard' && can('rentals.read')) || isActive('rentals'),
  });
  const rentalDetail = useQuery({
    queryKey: ['admin-rental', selectedRentalReference],
    queryFn: () => api<OperationalRental>(`/admin/rentals/${selectedRentalReference}`),
    enabled: Boolean(isActive('rentals') && selectedRentalReference),
  });
  const claimQueue = useQuery({
    queryKey: ['admin-claims', claimStatus, claimCategory, claimSeverity, claimMinimumAgeHours],
    queryFn: () => {
      const parameters = new URLSearchParams();
      if (claimStatus) parameters.set('status', claimStatus);
      if (claimCategory) parameters.set('category', claimCategory);
      if (claimSeverity) parameters.set('severity', claimSeverity);
      if (claimMinimumAgeHours) parameters.set('minimumAgeHours', claimMinimumAgeHours);
      const queryString = parameters.toString();
      return api<ClaimQueue>(`/admin/claims${queryString ? `?${queryString}` : ''}`);
    },
    enabled: (activeModule === 'dashboard' && can('claims.read')) || isActive('claims'),
  });
  const claimDetail = useQuery({
    queryKey: ['admin-claim', selectedClaimId],
    queryFn: () => api<ClaimDetail>(`/admin/claims/${selectedClaimId}`),
    enabled: Boolean(isActive('claims') && selectedClaimId),
  });
  const payoutQueue = useQuery({
    queryKey: ['admin-payout-queue'],
    queryFn: () => api<PayoutQueueItem[]>('/admin/payouts/queue'),
    enabled: (activeModule === 'dashboard' && can('payouts.read')) || isActive('payouts'),
  });
  const payouts = useQuery({
    queryKey: ['admin-payouts'],
    queryFn: () => api<AdminPayout[]>('/admin/payouts'),
    enabled: (activeModule === 'dashboard' && can('payouts.read')) || isActive('payouts'),
  });
  const payoutDetail = useQuery({
    queryKey: ['admin-payout', selectedPayoutId],
    queryFn: () => api<AdminPayout>(`/admin/payouts/${selectedPayoutId}`),
    enabled: Boolean(isActive('payouts') && selectedPayoutId),
  });
  const payoutAction = useMutation({
    mutationFn: ({ body, path }: { body?: Record<string, unknown>; path: string }) =>
      api(`/admin/${path}`, {
        ...(body ? { body: JSON.stringify(body) } : {}),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-payout-queue'] });
      void client.invalidateQueries({ queryKey: ['admin-payouts'] });
      void client.invalidateQueries({ queryKey: ['admin-payout', selectedPayoutId] });
    },
  });
  const claimAction = useMutation({
    mutationFn: ({
      id,
      outcome,
      reason,
      approvedAmountMinor,
    }: {
      id: string;
      outcome: string;
      reason: string;
      approvedAmountMinor?: number;
    }) =>
      api(`/admin/claims/${id}/adjudicate`, {
        body: JSON.stringify({
          outcome,
          reason,
          ...(approvedAmountMinor === undefined ? {} : { approvedAmountMinor }),
        }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-claims'] });
      void client.invalidateQueries({ queryKey: ['admin-claim', selectedClaimId] });
      void client.invalidateQueries({ queryKey: ['admin-rentals'] });
    },
  });
  const disputeAction = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) =>
      api(`/admin/disputes/${id}/resolve`, {
        body: JSON.stringify({ reason, status }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-claims'] });
      void client.invalidateQueries({ queryKey: ['admin-claim', selectedClaimId] });
    },
  });
  const chargeRefund = useMutation({
    mutationFn: ({
      id,
      amountMinor,
      reason,
    }: {
      id: string;
      amountMinor: number;
      reason: string;
    }) =>
      api(`/admin/additional-charges/${id}/refund`, {
        body: JSON.stringify({ amountMinor, reason }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-claims'] });
      void client.invalidateQueries({ queryKey: ['admin-claim', selectedClaimId] });
    },
  });
  const rentalHold = useMutation({
    mutationFn: ({
      hold,
      reference,
      reason,
    }: {
      hold: boolean;
      reference: string;
      reason: string;
    }) =>
      api(`/admin/rentals/${reference}/operational-hold`, {
        body: JSON.stringify({ hold, reason }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-rentals'] });
      void client.invalidateQueries({ queryKey: ['admin-rental', selectedRentalReference] });
    },
  });
  const handoverResolution = useMutation({
    mutationFn: ({
      action,
      reason,
      reference,
    }: {
      action: 'CONFIRM_PICKUP' | 'CONFIRM_RETURN';
      reason: string;
      reference: string;
    }) =>
      api(`/admin/rentals/${reference}/handover-resolution`, {
        body: JSON.stringify({ action, reason }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-rentals'] });
      void client.invalidateQueries({ queryKey: ['admin-rental', selectedRentalReference] });
    },
  });
  const pickupOperationsResolution = useMutation({
    mutationFn: ({
      disputeId,
      incidentId,
      outcome,
      reason,
      reference,
    }: {
      disputeId?: string;
      incidentId: string;
      outcome: string;
      reason: string;
      reference: string;
    }) =>
      api(`/admin/rentals/${reference}/pickup-handover-resolution`, {
        body: JSON.stringify({ disputeId, incidentId, outcome, reason }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-rentals'] });
      void client.invalidateQueries({ queryKey: ['admin-rental', selectedRentalReference] });
    },
  });
  const incidentAction = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) =>
      api(`/admin/rentals/incidents/${id}/status`, {
        body: JSON.stringify({ reason, status }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-rentals'] });
      void client.invalidateQueries({ queryKey: ['admin-rental', selectedRentalReference] });
    },
  });
  const commissionAction = useMutation({
    mutationFn: ({
      operation,
      id,
      body,
    }: {
      operation: 'create' | 'disable';
      id?: string;
      body: object;
    }) =>
      api(
        operation === 'create'
          ? '/admin/finance/commission-rules'
          : `/admin/finance/commission-rules/${id}/disable`,
        { body: JSON.stringify(body), method: 'POST' },
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['commission-rules'] }),
  });
  const vehicleAction = useMutation({
    mutationFn: ({ id, operation, reason }: { id: string; operation: string; reason?: string }) =>
      api(`/admin/vehicles/${id}/${operation}`, {
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-vehicles'] });
      void client.invalidateQueries({ queryKey: ['admin-vehicle', selectedVehicleId] });
      void client.invalidateQueries({
        queryKey: ['admin-vehicle-public-visibility', selectedVehicleId],
      });
    },
  });
  const grantFile = async (id: string) => {
    const grant = await api<{ contentPath: string; expiresAt: string; mimeType: string }>(
      `/files/${id}/access-grants`,
      { method: 'POST' },
    );
    return {
      expiresAt: grant.expiresAt,
      mimeType: grant.mimeType,
      url: `${new URL(API_URL).origin}${grant.contentPath}`,
    };
  };
  const heading = moduleTitles[activeModule];
  const visibleUsers = users.data?.filter(
    (user) =>
      (userRoleFilter === 'ALL' || user.roles.some(({ role }) => role.code === userRoleFilter)) &&
      (userStatusFilter === 'ALL' || user.status === userStatusFilter),
  );
  if (
    (ownerOnlyModule && admin.role !== 'OWNER') ||
    missingStaffDetailPermission ||
    (requiredPermission[activeModule] && !can(requiredPermission[activeModule]!))
  )
    return (
      <div className="admin-console">
        <EmptyState
          title="Access denied"
          description="Your staff account does not have permission to open this administrative module."
        />
      </div>
    );

  return (
    <div className="admin-console" data-module={activeModule}>
      <header className="page-heading">
        <div>
          <span className="eyebrow">{heading.eyebrow}</span>
          <h1>{heading.title}</h1>
          <p>{heading.description}</p>
        </div>
        <span className="environment">{adminEnvironment.label} operations</span>
      </header>
      {activeModule === 'dashboard' && (
        <section className="dashboard-grid" aria-label="Actionable operation counts">
          {can('owners.read') && (
            <MetricCard
              href="/admin/verification/owners"
              label="Pending owner verification"
              value={owners.data?.length}
            />
          )}
          {can('vehicles.read') && (
            <MetricCard
              href="/admin/vehicles"
              label="Pending vehicle listings"
              value={vehicles.data?.length}
            />
          )}
          {can('rentals.read') && (
            <MetricCard
              href="/admin/rentals"
              label="Active rental operations"
              value={rentalQueue.data?.length}
            />
          )}
          {can('claims.read') && (
            <MetricCard
              href="/admin/claims"
              label="Claims needing review"
              value={claimQueue.data?.items.length}
            />
          )}
          {can('payouts.read') && (
            <MetricCard
              href="/admin/payouts"
              label="Pending payout owners"
              value={payoutQueue.data?.length}
            />
          )}
          {can('vehicles.read') && (
            <MetricCard
              href="/admin/bookings"
              label="Booking records"
              value={bookings.data?.length}
            />
          )}
        </section>
      )}
      {activeModule === 'owner-overview' && (
        <OwnerOverviewDashboard requestOverview={(path) => api<OwnerAnalyticsOverview>(path)} />
      )}
      {activeModule === 'owner-revenue' && (
        <OwnerRevenueDashboard
          requestRevenue={(path) => api<OwnerRevenueSummary>(path)}
          requestTrends={(path) => api<OwnerRevenueTrends>(path)}
        />
      )}
      {activeModule === 'owner-reports' && (
        <OwnerMarketplaceReportsDashboard
          requestReport={(path) => api<OwnerMarketplaceReport>(path)}
          requestTrends={(path) => api<OwnerMarketplaceTrends>(path)}
        />
      )}
      {activeModule === 'owner-staff-activity' && <OwnerStaffActivityPanel />}
      {activeModule === 'staff-new' && <StaffCreatePanel />}
      {activeModule === 'staff-detail' && detailId && <StaffDetailPanel id={detailId} />}
      <div className="admin-grid">
        {activeModule === 'staff' && <StaffManagementPanel />}
        {activeModule === 'audit' && <AdminAuditPanel />}
        <section
          className={`admin-card vehicle-review-card module-section module-vehicles ${selectedVehicleId ? 'is-detail-route' : ''}`}
        >
          <span className="eyebrow">VEHICLE REVIEW</span>
          <h2>Pending listings</h2>
          {vehicles.isLoading && <p>Loading queue…</p>}
          {vehicles.data?.length === 0 && (
            <EmptyState
              title="No vehicles awaiting review"
              description="All submitted vehicle listings have been reviewed."
            />
          )}
          {vehicles.data && vehicles.data.length > 0 && (
            <DataTable label="Vehicle review queue">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Owner</th>
                  <th>Category</th>
                  <th>Submitted</th>
                  <th>Review state</th>
                  <th>Availability</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.data.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        {item.make && item.model ? `${item.make} ${item.model}` : 'Vehicle draft'}
                      </strong>
                    </td>
                    <td>{item.ownerProfile.legalName ?? item.ownerProfile.user.email}</td>
                    <td>{item.category?.name ?? '—'}</td>
                    <td>
                      {item.submittedAt
                        ? new Date(item.submittedAt).toLocaleString()
                        : 'Not submitted'}
                    </td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                    <td>
                      <StatusBadge value={item.operationalStatus} />
                    </td>
                    <td>
                      <Link
                        href={`/admin/vehicles/${item.id}`}
                        onClick={() => setSelectedVehicleId(item.id)}
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {selectedVehicleId && vehicle.data && (
            <div className="detail-page">
              <AdminDetailHeader
                backHref="/admin/vehicles"
                backLabel="Vehicle queue"
                eyebrow="Vehicle review workspace"
                title={
                  `${vehicle.data.modelYear ?? ''} ${vehicle.data.make ?? ''} ${vehicle.data.model ?? ''}`.trim() ||
                  'Vehicle listing'
                }
                status={vehicle.data.status}
                description={`Owner: ${vehicle.data.ownerProfile.legalName ?? vehicle.data.ownerProfile.user.email ?? 'Not available'}`}
              />
              <AdminSummaryGrid>
                <AdminSummaryCard
                  label="Owner verification"
                  value={adminLabel(vehicle.data.ownerProfile.status)}
                />
                <AdminSummaryCard
                  label="Location"
                  value={
                    vehicle.data.location
                      ? `${vehicle.data.location.city}, ${vehicle.data.location.province}`
                      : 'Not configured'
                  }
                />
                <AdminSummaryCard
                  label="Daily price"
                  value={
                    vehicle.data.policyVersions[0]
                      ? formatMoney(vehicle.data.policyVersions[0].dailyRateMinor)
                      : 'Not configured'
                  }
                />
                <AdminSummaryCard
                  label="Discovery"
                  value={publicVisibility.data?.discoverable ? 'Eligible' : 'Not eligible'}
                  detail={publicVisibility.isLoading ? 'Checking…' : undefined}
                />
                <AdminSummaryCard
                  label="Published rating"
                  value={
                    vehicle.data.publishedRating.averageRating
                      ? `★ ${vehicle.data.publishedRating.averageRating}`
                      : 'No rating'
                  }
                  detail={`${vehicle.data.publishedRating.reviewCount} published reviews`}
                />
              </AdminSummaryGrid>

              <AdminSection
                title="Vehicle details"
                description="Authoritative listing and operating configuration."
              >
                <AdminDefinitionList
                  items={[
                    { label: 'Category', value: vehicle.data.category?.name ?? 'Not configured' },
                    { label: 'Powertrain', value: adminLabel(vehicle.data.powertrain) },
                    { label: 'Fuel', value: adminLabel(vehicle.data.fuelType) },
                    {
                      label: 'Operational status',
                      value: <StatusBadge value={vehicle.data.operationalStatus} />,
                    },
                    {
                      label: 'Mileage policy',
                      value: adminLabel(vehicle.data.policyVersions[0]?.mileagePolicy),
                    },
                    {
                      label: 'Turnaround',
                      value: vehicle.data.policyVersions[0]
                        ? `${vehicle.data.policyVersions[0].turnaroundMinutes / 60} hours`
                        : 'Not configured',
                    },
                    {
                      label: 'Pricing version',
                      value: vehicle.data.policyVersions[0]
                        ? `Version ${vehicle.data.policyVersions[0].version}`
                        : 'Not configured',
                    },
                    { label: 'Submitted', value: formatDate(vehicle.data.submittedAt) },
                  ]}
                />
              </AdminSection>

              <AdminSection
                title="Known vehicle issues"
                description="Current private vehicle condition registry. This is separate from booking-specific inspection evidence."
              >
                <p>
                  Operational status: <StatusBadge value={vehicle.data.operationalStatus} />
                </p>
                {vehicle.data.knownIssues.length === 0 ? <p>No known issues recorded.</p> : null}
                {['ACTIVE', 'RESOLVED'].map((status) => (
                  <div key={status}>
                    <h3>{adminLabel(status)} known issues</h3>
                    {vehicle.data.knownIssues
                      .filter((issue) => issue.status === status)
                      .map((issue) => (
                        <article className="compact-panel" key={issue.id}>
                          <p>
                            <strong>{adminLabel(issue.category)}</strong> ·{' '}
                            {adminLabel(issue.vehicleArea)} ·{' '}
                            <StatusBadge value={issue.classification} />
                          </p>
                          <p>{issue.description}</p>
                          <p>
                            Created {formatDate(issue.createdAt)}
                            {issue.resolvedAt ? ` · Resolved ${formatDate(issue.resolvedAt)}` : ''}
                          </p>
                          {issue.evidence?.map(({ fileAsset }) => (
                            <AdminEvidenceCard
                              key={fileAsset.id}
                              label="Known-issue evidence"
                              note="Private temporary audited access"
                              requestAccess={() => grantFile(fileAsset.id)}
                            />
                          ))}
                        </article>
                      ))}
                  </div>
                ))}
              </AdminSection>

              <AdminSection
                title="Photo review"
                description="Open each protected image at full size to visually review the listing."
              >
                <div className="admin-evidence-grid">
                  {vehicle.data.photos.map((photo, index) => (
                    <AdminEvidenceCard
                      key={photo.id}
                      label={evidenceLabel(photo.perspective)}
                      {...(index === 0 ? { status: 'COVER' } : {})}
                      note="Temporary audited access"
                      displayMode="photo"
                      requestAccess={() => grantFile(photo.fileAsset.id)}
                    />
                  ))}
                </div>
              </AdminSection>

              <AdminSection
                title="Document review"
                description="Registration and insurance evidence remain protected by five-minute audited grants."
              >
                <div className="admin-evidence-grid">
                  {vehicle.data.documents
                    .filter((document) => !document.replacedAt)
                    .map((document) => (
                      <AdminEvidenceCard
                        key={document.id}
                        label={document.definition.name}
                        note="Temporary audited access"
                        requestAccess={() => grantFile(document.fileAsset.id)}
                      />
                    ))}
                </div>
              </AdminSection>

              <AdminSection
                title="Public listing eligibility"
                description="Reasons the vehicle can or cannot appear in renter discovery."
              >
                {publicVisibility.isLoading ? (
                  <p>Checking public eligibility…</p>
                ) : (
                  <ul className="eligibility-checklist">
                    <li
                      className={vehicle.data.ownerProfile.status === 'APPROVED' ? 'pass' : 'fail'}
                    >
                      Owner verified
                    </li>
                    <li className={vehicle.data.policyVersions[0] ? 'pass' : 'fail'}>
                      Pricing configured
                    </li>
                    <li className={vehicle.data.status === 'APPROVED' ? 'pass' : 'fail'}>
                      Listing approved
                    </li>
                    {publicVisibility.data?.reasons.map((reason) => (
                      <li className="fail" key={reason}>
                        {visibilityReason(reason)}
                      </li>
                    ))}
                    {publicVisibility.data?.discoverable && (
                      <li className="pass">Public projection is eligible</li>
                    )}
                  </ul>
                )}
              </AdminSection>

              <AdminSection title="Status history">
                <AdminTimeline
                  events={vehicle.data.statusHistory.map((entry) => ({
                    id: entry.id,
                    title: adminLabel(entry.newStatus),
                    occurredAt: entry.occurredAt,
                    detail:
                      entry.reason ??
                      (entry.previousStatus
                        ? `Previously ${adminLabel(entry.previousStatus)}`
                        : 'Listing created'),
                  }))}
                />
              </AdminSection>

              <AdminTechnicalDetails
                summary={`Administrative audit trail (${vehicle.data.auditLogs.length})`}
              >
                <DataTable label="Vehicle administrative audit trail">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Date/time</th>
                      <th>Reason</th>
                      <th>Correlation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicle.data.auditLogs.map((entry) => (
                      <tr key={entry.id}>
                        <td>{adminLabel(entry.action)}</td>
                        <td>{formatDate(entry.occurredAt)}</td>
                        <td>{entry.reason ?? '—'}</td>
                        <td>
                          <small>{entry.correlationId ?? '—'}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </AdminTechnicalDetails>

              <AdminActionBar description="Review commands retain existing authorization and audit behavior.">
                {vehicle.data.status === 'PENDING_APPROVAL' && (
                  <>
                    <button
                      onClick={() =>
                        vehicleAction.mutate({ id: vehicle.data.id, operation: 'approval' })
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="warning"
                      onClick={() => {
                        const reason = window.prompt('Required changes');
                        if (reason)
                          vehicleAction.mutate({
                            id: vehicle.data.id,
                            operation: 'change-request',
                            reason,
                          });
                      }}
                    >
                      Request changes
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        const reason = window.prompt('Rejection reason');
                        if (reason)
                          vehicleAction.mutate({
                            id: vehicle.data.id,
                            operation: 'rejection',
                            reason,
                          });
                      }}
                    >
                      Reject
                    </button>
                  </>
                )}
                {vehicle.data.status === 'APPROVED' && (
                  <button
                    className="danger"
                    onClick={() => {
                      const reason = window.prompt('Suspension reason');
                      if (reason)
                        vehicleAction.mutate({
                          id: vehicle.data.id,
                          operation: 'suspension',
                          reason,
                        });
                    }}
                  >
                    Suspend
                  </button>
                )}
                {vehicle.data.status === 'SUSPENDED' && (
                  <button
                    onClick={() => {
                      const reason = window.prompt('Restoration reason');
                      if (reason)
                        vehicleAction.mutate({
                          id: vehicle.data.id,
                          operation: 'restoration',
                          reason,
                        });
                    }}
                  >
                    Restore
                  </button>
                )}
              </AdminActionBar>
              {vehicleAction.error && <p className="error-text">{vehicleAction.error.message}</p>}
            </div>
          )}
        </section>
        {activeModule === 'renter-verification' && (
          <RenterVerificationAdminPanel
            accessToken={accessToken}
            {...(detailId ? { initialSelectedId: detailId } : {})}
            onUnauthorized={logout}
          />
        )}
        {activeModule === 'inspection-corrections' && (
          <InspectionCorrectionsAdminPanel
            accessToken={accessToken}
            {...(detailId ? { initialSelectedId: detailId } : {})}
            onUnauthorized={logout}
          />
        )}
        {activeModule === 'support' && (
          <Phase10AdminPanels
            accessToken={accessToken}
            {...(detailId ? { initialSelectedId: detailId } : {})}
            module="support"
            onUnauthorized={logout}
          />
        )}
        {activeModule === 'trust-safety' && (
          <Phase10AdminPanels
            accessToken={accessToken}
            {...(detailId ? { initialSelectedId: detailId } : {})}
            module="trust-safety"
            onUnauthorized={logout}
          />
        )}
        <section
          className={`admin-card module-section module-rentals ${selectedRentalReference ? 'is-detail-route' : ''}`}
        >
          <span className="eyebrow">RENTAL OPERATIONS</span>
          <h2>Pickup, active and return queue</h2>
          <p>Operational evidence is read-only. Holds require an explicit audited command.</p>
          {rentalQueue.isLoading && <p>Loading rental queue…</p>}
          {rentalQueue.data?.length === 0 && (
            <EmptyState
              title="No active rental operations"
              description="There are no pickup, active, or return cases requiring attention."
            />
          )}
          {rentalQueue.data && rentalQueue.data.length > 0 && (
            <DataTable label="Rental operations queue">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Vehicle</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Lifecycle</th>
                  <th>Attention</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rentalQueue.data.map((rental) => (
                  <tr key={rental.id}>
                    <td>
                      <strong>{rental.publicReference}</strong>
                    </td>
                    <td>
                      {rental.vehicle.make} {rental.vehicle.model}
                    </td>
                    <td>{new Date(rental.rentalStart).toLocaleString()}</td>
                    <td>{new Date(rental.rentalEnd).toLocaleString()}</td>
                    <td>
                      <StatusBadge value={rental.status} />
                    </td>
                    <td>
                      {rental.workflowCompliance?.start.overdue && (
                        <StatusBadge value="HANDOVER_OVERDUE" />
                      )}
                      {rental.workflowCompliance?.return.overdue && (
                        <StatusBadge value="RETURN_OVERDUE" />
                      )}
                      {rental.operationalHold ? (
                        <StatusBadge value="OPERATIONAL_HOLD" />
                      ) : rental.rentalIncidents.length ? (
                        `${rental.rentalIncidents.length} incident(s)`
                      ) : (
                        'None'
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/admin/rentals/${rental.publicReference}`}
                        onClick={() => setSelectedRentalReference(rental.publicReference)}
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {selectedRentalReference && rentalDetail.data && (
            <div className="detail-page">
              <AdminDetailHeader
                backHref="/admin/rentals"
                backLabel="Rental queue"
                eyebrow="Rental operations"
                title={selectedRentalReference}
                status={rentalDetail.data.status}
                description={`${rentalDetail.data.vehicle.make ?? ''} ${rentalDetail.data.vehicle.model ?? ''}`.trim()}
              />
              <AdminSummaryGrid>
                <AdminSummaryCard
                  label="Scheduled pickup"
                  value={formatDate(rentalDetail.data.rentalStart)}
                />
                <AdminSummaryCard
                  label="Actual pickup"
                  value={formatDate(rentalDetail.data.actualPickupAt)}
                />
                <AdminSummaryCard
                  label="Scheduled return"
                  value={formatDate(rentalDetail.data.rentalEnd)}
                />
                <AdminSummaryCard
                  label="Actual return"
                  value={formatDate(rentalDetail.data.actualReturnAt)}
                />
              </AdminSummaryGrid>

              {rentalDetail.data.workflowCompliance && (
                <AdminSection
                  title="Handover workflow compliance"
                  description="Overdue is a reminder and compliance boundary, not evidence of custody. Late normal workflow completion remains available."
                >
                  <p>Workflow: {adminLabel(rentalDetail.data.workflowCompliance.workflow)}</p>
                  <p>
                    Start evidence outcome:{' '}
                    {adminLabel(
                      rentalDetail.data.workflowCompliance.start.evidenceOutcome ?? 'PENDING',
                    )}
                  </p>
                  <p>
                    Return evidence outcome:{' '}
                    {adminLabel(
                      rentalDetail.data.workflowCompliance.return.evidenceOutcome ?? 'PENDING',
                    )}
                  </p>
                  {(rentalDetail.data.handoverEvidenceWaivers ?? []).map((waiver) => (
                    <p key={waiver.phase}>
                      {adminLabel(waiver.phase)} inspection evidence waived · Participant:{' '}
                      {waiver.waivedByUserId} · {formatDate(waiver.decidedAt)} · Acknowledgement:{' '}
                      {waiver.acknowledgementVersion} · Reduced handover evidence; no automatic
                      liability decision.
                    </p>
                  ))}
                  {rentalDetail.data.pickupHandoverReport && (
                    <>
                      <p>
                        Owner-reported physical handover:{' '}
                        {formatDate(
                          rentalDetail.data.pickupHandoverReport.reportedPhysicalHandoverAt,
                        )}{' '}
                        · Reported by {rentalDetail.data.pickupHandoverReport.reportedByUserId} at{' '}
                        {formatDate(rentalDetail.data.pickupHandoverReport.reportedAt)}. This is a
                        participant assertion, not the authoritative pickup timestamp.
                      </p>
                      <p>
                        Renter response:{' '}
                        {rentalDetail.data.pickupHandoverReport.response
                          ? `${adminLabel(rentalDetail.data.pickupHandoverReport.response.decision)} · ${formatDate(rentalDetail.data.pickupHandoverReport.response.respondedAt)}`
                          : 'Pending'}
                        {rentalDetail.data.pickupHandoverReport.response?.proposedPhysicalHandoverAt
                          ? ` · Proposed time: ${formatDate(rentalDetail.data.pickupHandoverReport.response.proposedPhysicalHandoverAt)}`
                          : ''}
                      </p>
                    </>
                  )}
                  {rentalDetail.data.overdueHandoverRecovery && (
                    <div>
                      <p>
                        Recovery reminder history · Scope:{' '}
                        {adminLabel(rentalDetail.data.overdueHandoverRecovery.scope)} · Response
                        deadline:{' '}
                        {formatDate(rentalDetail.data.overdueHandoverRecovery.responseDeadlineAt)}
                      </p>
                      {rentalDetail.data.overdueHandoverRecovery.reminders.map((reminder) => (
                        <p key={`${reminder.stage}:${reminder.channel}`}>
                          {adminLabel(reminder.stage)} {adminLabel(reminder.channel)} ·{' '}
                          {adminLabel(reminder.status)} · Scheduled{' '}
                          {formatDate(reminder.scheduledAt)}
                          {reminder.submittedAt
                            ? ` · Submitted ${formatDate(reminder.submittedAt)}`
                            : ''}
                          {reminder.deliveredAt
                            ? ` · Delivered ${formatDate(reminder.deliveredAt)}`
                            : ''}
                          {reminder.failureCategory
                            ? ` · ${adminLabel(reminder.failureCategory)}`
                            : ''}
                          {reminder.safeFailureMessage ? ` — ${reminder.safeFailureMessage}` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                  <p>
                    {rentalDetail.data.workflowCompliance.start.overdue
                      ? 'Handover overdue'
                      : 'Start handover'}{' '}
                    · Grace boundary:{' '}
                    {formatDate(rentalDetail.data.workflowCompliance.start.graceBoundary)}
                  </p>
                  <p>
                    Outstanding step:{' '}
                    {adminLabel(
                      rentalDetail.data.workflowCompliance.start.outstandingStep ?? 'COMPLETE',
                    )}{' '}
                    · Custody recorded:{' '}
                    {rentalDetail.data.workflowCompliance.start.custodyRecorded ? 'Yes' : 'No'}
                  </p>
                  <p>
                    {rentalDetail.data.workflowCompliance.return.overdue
                      ? 'Return overdue'
                      : 'Return process'}{' '}
                    · Grace boundary:{' '}
                    {formatDate(rentalDetail.data.workflowCompliance.return.graceBoundary)}
                  </p>
                  <p>
                    Outstanding step:{' '}
                    {adminLabel(
                      rentalDetail.data.workflowCompliance.return.outstandingStep ?? 'COMPLETE',
                    )}{' '}
                    · Return recorded:{' '}
                    {rentalDetail.data.workflowCompliance.return.custodyRecorded ? 'Yes' : 'No'}
                  </p>
                  <p>
                    Workflow payout blocker:{' '}
                    {adminLabel(rentalDetail.data.workflowCompliance.payoutBlocker ?? 'NONE')} ·
                    Other financial holds and payout schedule still apply.
                  </p>
                </AdminSection>
              )}

              <AdminSection
                title="Rental lifecycle"
                description="Only persisted server-authoritative transitions are shown as completed."
              >
                <AdminTimeline
                  events={rentalDetail.data.statusHistory.map((entry) => ({
                    id: entry.id,
                    title: adminLabel(entry.toStatus),
                    occurredAt: entry.occurredAt,
                    detail: entry.reasonCode
                      ? adminLabel(entry.reasonCode)
                      : 'Lifecycle transition',
                  }))}
                />
              </AdminSection>

              <AdminSection
                title="Fulfillment and travel"
                description="Travel milestones are immutable logistics history and do not transfer custody."
              >
                <p>
                  Start: {adminLabel(rentalDetail.data.fulfillment.startMethod)} · Return:{' '}
                  {adminLabel(rentalDetail.data.fulfillment.endMethod)}
                </p>
                {rentalDetail.data.handoverTravel.events.length ? (
                  <AdminTimeline
                    events={rentalDetail.data.handoverTravel.events.map((entry, index) => ({
                      id: `${entry.phase}-${entry.status}-${index}`,
                      title: `${adminLabel(entry.phase)} · ${adminLabel(entry.status)}`,
                      occurredAt: entry.occurredAt,
                      detail: 'Owner logistics milestone',
                    }))}
                  />
                ) : (
                  <p>No Owner travel has started.</p>
                )}
              </AdminSection>

              {rentalDetail.data.inspections.map((inspection, inspectionIndex) => (
                <AdminSection
                  key={inspection.id}
                  title={`${adminLabel(inspection.type)} inspection${inspectionIndex > 1 ? ` ${inspectionIndex + 1}` : ''}`}
                  description={
                    inspection.type === 'PICKUP'
                      ? 'Vehicle condition recorded before handover.'
                      : inspectionIndex === 1
                        ? 'Return condition submitted by the participant.'
                        : 'Additional receipt or corrected return evidence.'
                  }
                >
                  <AdminDefinitionList
                    items={[
                      {
                        label: 'Odometer',
                        value: inspection.odometerMeters
                          ? `${Number(inspection.odometerMeters).toLocaleString()} metres`
                          : 'Not recorded',
                      },
                      { label: 'Fuel level', value: formatBasisPoints(inspection.fuelBasisPoints) },
                      {
                        label: 'Battery level',
                        value: formatBasisPoints(inspection.batterySocBasisPoints),
                      },
                      { label: 'Evidence files', value: String(inspection.media.length) },
                    ]}
                  />
                  <div className="admin-evidence-grid">
                    {inspection.media.map((media) => (
                      <AdminEvidenceCard
                        key={media.fileAsset.id}
                        displayMode="photo"
                        label={evidenceLabel(media.perspective)}
                        note="Protected inspection evidence"
                        requestAccess={() => grantFile(media.fileAsset.id)}
                      />
                    ))}
                  </div>
                </AdminSection>
              ))}

              {rentalDetail.data.usageSummary && (
                <AdminSection
                  title="Return usage summary"
                  description={
                    rentalDetail.data.usageSummary.returnDisputed
                      ? 'The submitted measurements are disputed.'
                      : 'Calculated from persisted pickup and return measurements.'
                  }
                >
                  <AdminSummaryGrid>
                    <AdminSummaryCard
                      label="Distance travelled"
                      value={`${rentalDetail.data.usageSummary.distanceTravelledKm} km`}
                    />
                    <AdminSummaryCard
                      label="Included distance"
                      value={
                        rentalDetail.data.usageSummary.includedDistanceKm === null
                          ? 'Unlimited'
                          : `${rentalDetail.data.usageSummary.includedDistanceKm} km`
                      }
                    />
                    <AdminSummaryCard
                      label="Excess distance"
                      value={`${rentalDetail.data.usageSummary.excessDistanceKm} km`}
                    />
                    <AdminSummaryCard
                      label="Late duration"
                      value={`${Math.ceil(rentalDetail.data.usageSummary.lateDurationSeconds / 60)} minutes`}
                    />
                  </AdminSummaryGrid>
                </AdminSection>
              )}

              <AdminSection
                title="Incidents and claims"
                description="Each record remains separate and immutable even when multiple reports concern the same rental."
              >
                {rentalDetail.data.currentVehicleKnownIssues?.length ? (
                  <article className="compact-panel">
                    <h3>Current vehicle known issues</h3>
                    <p>
                      Current mutable vehicle state—not the historical booking Start-condition
                      evidence.
                    </p>
                    {rentalDetail.data.currentVehicleKnownIssues.map((issue) => (
                      <p key={issue.id}>
                        <StatusBadge value={issue.status} /> {adminLabel(issue.category)} ·{' '}
                        {adminLabel(issue.vehicleArea)} · {adminLabel(issue.classification)} —{' '}
                        {issue.description}
                      </p>
                    ))}
                  </article>
                ) : null}
                {rentalDetail.data.inspections
                  .filter(({ type }) => type === 'PICKUP')
                  .map((inspection) => (
                    <article className="compact-panel" key={inspection.id}>
                      <h3>Start inspection and participant review</h3>
                      <p>
                        Condition declaration:{' '}
                        {adminLabel(inspection.conditionDisclosureState ?? 'LEGACY_NOT_RECORDED')}
                      </p>
                      {inspection.conditionIssues.map((issue) => (
                        <p key={issue.id}>
                          <strong>{adminLabel(issue.category)}</strong> ·{' '}
                          {adminLabel(issue.vehicleArea)} · {adminLabel(issue.classification)} —{' '}
                          {issue.description}
                        </p>
                      ))}
                      {inspection.confirmations.map((confirmation) => (
                        <div key={confirmation.role}>
                          <p>
                            {adminLabel(confirmation.role)}: {adminLabel(confirmation.decision)}
                            {confirmation.reason ? ` — ${confirmation.reason}` : ''}
                          </p>
                          {confirmation.discrepancyResponses.length ? (
                            <h4>Participant resolution timeline</h4>
                          ) : null}
                          {confirmation.discrepancyResponses.map((response) => (
                            <div className="compact-panel" key={response.roundNumber}>
                              <p>
                                <strong>Owner response {response.roundNumber}</strong>:{' '}
                                {adminLabel(response.responseType)} — {response.responseText}
                              </p>
                              {response.resolutionReview ? (
                                <p>
                                  Renter resolution review:{' '}
                                  {adminLabel(response.resolutionReview.decision)}
                                  {response.resolutionReview.reason
                                    ? ` — ${response.resolutionReview.reason}`
                                    : ''}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ))}
                    </article>
                  ))}
                {rentalDetail.data.postReturnClaims.map((claim) => (
                  <p key={claim.id}>
                    <Link href={`/admin/claims/${claim.id}`}>{adminLabel(claim.category)}</Link> ·{' '}
                    <StatusBadge value={claim.status} /> · submitted {formatDate(claim.submittedAt)}
                  </p>
                ))}
                {rentalDetail.data.rentalIncidents.map((incident, index) => (
                  <article className="compact-panel" key={incident.id}>
                    <h3>
                      {adminLabel(incident.category)} <small>Incident {index + 1}</small>
                    </h3>
                    <p>
                      <StatusBadge value={incident.severity} />{' '}
                      <StatusBadge value={incident.status} />
                    </p>
                    <AdminTechnicalDetails summary="Incident identifier">
                      <small>{incident.id}</small>
                    </AdminTechnicalDetails>
                    {incident.pickupDiscrepancyResponse ? (
                      <p>
                        {incident.disputes.length
                          ? 'Escalated to CarShare'
                          : 'Participants resolving'}
                      </p>
                    ) : null}
                    {incident.pickupHandoverOperationsResolution ? (
                      <p>
                        Operations outcome:{' '}
                        <StatusBadge value={incident.pickupHandoverOperationsResolution.outcome} />{' '}
                        — {incident.pickupHandoverOperationsResolution.reason}
                      </p>
                    ) : null}
                    {incident.pickupDiscrepancyResponse?.resolutionReview?.decision ===
                      'STILL_DISAGREES' &&
                    incident.disputes.length > 0 &&
                    !incident.pickupHandoverOperationsResolution ? (
                      <div className="actions">
                        {(
                          [
                            ['HANDOVER_MAY_RESUME', 'Allow handover to resume'],
                            ['BOOKING_CANCELLATION_REQUIRED', 'Booking must be cancelled'],
                            ['MAINTENANCE_REQUIRED', 'Vehicle requires maintenance'],
                            ['SUPPORT_FOLLOW_UP_REQUIRED', 'Further support follow-up required'],
                          ] as const
                        ).map(([outcome, label]) => (
                          <button
                            className={outcome === 'HANDOVER_MAY_RESUME' ? 'primary' : 'quiet'}
                            key={outcome}
                            onClick={() => {
                              const reason = window.prompt(`Reason: ${label}`);
                              if (reason && reason.trim().length >= 10)
                                pickupOperationsResolution.mutate({
                                  ...(incident.disputes[0]
                                    ? { disputeId: incident.disputes[0].id }
                                    : {}),
                                  incidentId: incident.id,
                                  outcome,
                                  reason,
                                  reference: selectedRentalReference,
                                });
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {['OPEN', 'ACKNOWLEDGED'].includes(incident.status) && (
                      <div className="actions">
                        {incident.status === 'OPEN' && (
                          <button
                            className="quiet"
                            onClick={() => {
                              const reason = window.prompt('Acknowledgement reason');
                              if (reason)
                                incidentAction.mutate({
                                  id: incident.id,
                                  reason,
                                  status: 'ACKNOWLEDGED',
                                });
                            }}
                          >
                            Acknowledge
                          </button>
                        )}
                        <button
                          className="quiet"
                          onClick={() => {
                            const reason = window.prompt('Resolution reason');
                            if (reason)
                              incidentAction.mutate({
                                id: incident.id,
                                reason,
                                status: 'RESOLVED',
                              });
                          }}
                        >
                          Resolve
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {rentalDetail.data.cancellationSettlement ? (
                  <article className="compact-panel">
                    <h3>Cancelled before handover</h3>
                    <p>
                      Reason: {adminLabel(rentalDetail.data.cancellation?.reasonCode ?? 'UNKNOWN')}
                      {rentalDetail.data.cancellation?.reasonText
                        ? ` — ${rentalDetail.data.cancellation.reasonText}`
                        : ''}
                    </p>
                    <p>
                      Delivery authority:{' '}
                      {rentalDetail.data.cancellationSettlement.deliveryCompleted
                        ? 'Start delivery ARRIVED'
                        : 'Delivery not completed'}
                    </p>
                    <p>
                      Commission retained:{' '}
                      {rentalDetail.data.cancellationSettlement.commissionRetainedMinor}{' '}
                      {rentalDetail.data.cancellationSettlement.currency}
                    </p>
                    <p>
                      Delivery retained/refunded:{' '}
                      {rentalDetail.data.cancellationSettlement.deliveryRetainedMinor} /{' '}
                      {rentalDetail.data.cancellationSettlement.deliveryRefundedMinor}
                    </p>
                    <p>
                      Collection refunded:{' '}
                      {rentalDetail.data.cancellationSettlement.collectionRefundedMinor}
                    </p>
                    <p>
                      Renter refund: {rentalDetail.data.cancellationSettlement.refundAmountMinor} ·{' '}
                      {rentalDetail.data.cancellationSettlement.refund?.status ?? 'PENDING'}
                    </p>
                    <p>
                      Actual pickup: {rentalDetail.data.actualPickupAt ?? 'Not recorded'} ·{' '}
                      {'Custody never transferred'}
                    </p>
                  </article>
                ) : null}
                {rentalDetail.data.postReturnClaims.length === 0 &&
                  rentalDetail.data.rentalIncidents.length === 0 && (
                    <EmptyState
                      title="No incidents or claims"
                      description="No operational exceptions are recorded for this rental."
                    />
                  )}
              </AdminSection>

              <AdminActionBar
                title="Administrative intervention"
                description="Use only after reviewing participant reports, timestamps, inspection evidence, and the effect on the rental lifecycle."
                danger
              >
                {rentalDetail.data.status === 'READY_FOR_PICKUP' && (
                  <p>
                    Pickup custody transfer requires the normal participant six-digit code.
                    Operations may remove an eligible handover hold but cannot confirm pickup.
                  </p>
                )}
                {rentalDetail.data.status === 'RETURN_PENDING' &&
                  rentalDetail.data.inspections.some(({ type }) => type === 'RETURN') && (
                    <button
                      className="danger"
                      onClick={() => {
                        const reason = window.prompt(
                          'Reason for administratively confirming physical return after reviewing all participant evidence',
                        );
                        if (reason && reason.trim().length >= 10)
                          handoverResolution.mutate({
                            action: 'CONFIRM_RETURN',
                            reason,
                            reference: selectedRentalReference,
                          });
                      }}
                    >
                      Resolve physical return
                    </button>
                  )}
                {handoverResolution.error && (
                  <p className="error-text">{handoverResolution.error.message}</p>
                )}
                {pickupOperationsResolution.error && (
                  <p className="error-text">{pickupOperationsResolution.error.message}</p>
                )}
                <button
                  onClick={() => {
                    const reason = window.prompt(
                      rentalDetail.data.operationalHold
                        ? 'Reason to release hold'
                        : 'Reason to place hold',
                    );
                    if (reason)
                      rentalHold.mutate({
                        hold: !rentalDetail.data.operationalHold,
                        reason,
                        reference: selectedRentalReference,
                      });
                  }}
                >
                  {rentalDetail.data.operationalHold
                    ? 'Release operational hold'
                    : 'Place operational hold'}
                </button>
              </AdminActionBar>
            </div>
          )}
        </section>
        <section
          className={`admin-card module-section module-claims ${selectedClaimId ? 'is-detail-route' : ''}`}
        >
          <span className="eyebrow">CLAIMS &amp; DISPUTES</span>
          <h2>Structured post-return review</h2>
          <p>
            Review inspections, measurements, evidence, renter response, financial exposure, holds,
            and ledger history in one workspace. Owners cannot set charge amounts.
          </p>
          <div className="filter-toolbar">
            <label>
              Status
              <select value={claimStatus} onChange={(event) => setClaimStatus(event.target.value)}>
                <option value="">All statuses</option>
                {[
                  'RENTER_REVIEW',
                  'UNDER_ADMIN_REVIEW',
                  'PAYMENT_PENDING',
                  'WITHDRAWN',
                  'RESOLVED',
                ].map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                value={claimCategory}
                onChange={(event) => setClaimCategory(event.target.value)}
              >
                <option value="">All categories</option>
                {[
                  'EXCESS_MILEAGE',
                  'FUEL_DEFICIENCY',
                  'EV_BATTERY_DEFICIENCY',
                  'LATE_RETURN',
                  'CLEANING',
                  'DAMAGE',
                  'OTHER',
                ].map((category) => (
                  <option key={category} value={category}>
                    {category.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select
                value={claimSeverity}
                onChange={(event) => setClaimSeverity(event.target.value)}
              >
                <option value="">All severities</option>
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minimum age (hours)
              <input
                min="0"
                type="number"
                value={claimMinimumAgeHours}
                onChange={(event) => setClaimMinimumAgeHours(event.target.value)}
              />
            </label>
          </div>
          {claimQueue.isLoading && <p>Loading claim queue…</p>}
          {claimQueue.data?.items.length === 0 && (
            <EmptyState
              title="No matching claims"
              description="No claim or dispute records match the selected operational filters."
            />
          )}
          {claimQueue.data && claimQueue.data.items.length > 0 && (
            <DataTable label="Claims and disputes queue">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Submitted</th>
                  <th>Renter response</th>
                  <th>Exposure</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {claimQueue.data.items.map((claim) => (
                  <tr key={claim.id}>
                    <td>
                      <strong>{claim.booking.publicReference}</strong>
                    </td>
                    <td>{claim.category.replaceAll('_', ' ')}</td>
                    <td>
                      <StatusBadge value={claim.severity} />
                    </td>
                    <td>{new Date(claim.submittedAt).toLocaleString()}</td>
                    <td>{claim.response?.decision?.replaceAll('_', ' ') ?? 'Awaiting response'}</td>
                    <td>
                      ₱{((claim.calculations.at(-1)?.amountMinor ?? 0) / 100).toLocaleString()}
                    </td>
                    <td>
                      <StatusBadge value={claim.status} />
                    </td>
                    <td>
                      <Link
                        href={`/admin/claims/${claim.id}`}
                        onClick={() => setSelectedClaimId(claim.id)}
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {selectedClaimId && claimDetail.data && (
            <div className="detail-page">
              <AdminDetailHeader
                backHref="/admin/claims"
                backLabel="Claims queue"
                eyebrow="Claim case management"
                title={`${claimDetail.data.claim.booking.publicReference} · ${adminLabel(claimDetail.data.claim.category)}`}
                status={claimDetail.data.claim.status}
                description={`Submitted ${formatDate(claimDetail.data.claim.submittedAt)}`}
              />
              <AdminSummaryGrid>
                <AdminSummaryCard
                  label="Category"
                  value={adminLabel(claimDetail.data.claim.category)}
                />
                {(claimDetail.data.claim.booking.handoverEvidenceWaivers?.length ?? 0) > 0 && (
                  <AdminSummaryCard
                    label="Evidence quality"
                    value="Reduced handover evidence"
                    detail="Inspection evidence waived. Review all available evidence; no automatic fault or liability decision."
                  />
                )}
                <AdminSummaryCard
                  label="Severity"
                  value={<StatusBadge value={claimDetail.data.claim.severity} />}
                />
                <AdminSummaryCard
                  label="Calculated exposure"
                  value={formatMoney(claimDetail.data.claim.calculations.at(-1)?.amountMinor)}
                />
                <AdminSummaryCard
                  label="Renter response"
                  value={
                    claimDetail.data.claim.response
                      ? adminLabel(claimDetail.data.claim.response.decision)
                      : 'Awaiting response'
                  }
                  detail={
                    claimDetail.data.claim.responseDeadlineAt
                      ? `Deadline ${formatDate(claimDetail.data.claim.responseDeadlineAt)}`
                      : undefined
                  }
                />
              </AdminSummaryGrid>

              <AdminSection title="Claim summary">
                <AdminDefinitionList
                  items={[
                    { label: 'Issue description', value: claimDetail.data.claim.description },
                    {
                      label: 'Booking',
                      value: (
                        <Link
                          href={`/admin/rentals/${claimDetail.data.claim.booking.publicReference}`}
                        >
                          {claimDetail.data.claim.booking.publicReference}
                        </Link>
                      ),
                    },
                    {
                      label: 'Vehicle',
                      value:
                        `${claimDetail.data.claim.booking.vehicle.make ?? ''} ${claimDetail.data.claim.booking.vehicle.model ?? ''}`.trim() ||
                        'Not available',
                    },
                    { label: 'Submitted', value: formatDate(claimDetail.data.claim.submittedAt) },
                    {
                      label: 'Renter explanation',
                      value:
                        claimDetail.data.claim.response?.explanation ?? 'No explanation submitted',
                    },
                  ]}
                />
              </AdminSection>

              {claimDetail.data.claim.booking.usageSummary && (
                <AdminSection
                  title="Usage & calculation"
                  description="Persisted inspection measurements used by the server calculation."
                >
                  <AdminSummaryGrid>
                    <AdminSummaryCard
                      label="Distance used"
                      value={`${claimDetail.data.claim.booking.usageSummary.distanceTravelledKm} km`}
                    />
                    <AdminSummaryCard
                      label="Excess mileage"
                      value={`${claimDetail.data.claim.booking.usageSummary.excessDistanceKm} km`}
                    />
                    <AdminSummaryCard
                      label="Fuel deficiency"
                      value={formatBasisPoints(
                        claimDetail.data.claim.booking.usageSummary.fuelDeficiencyBasisPoints,
                      )}
                    />
                    <AdminSummaryCard
                      label="Late duration"
                      value={`${Math.ceil(claimDetail.data.claim.booking.usageSummary.lateDurationSeconds / 60)} minutes`}
                    />
                  </AdminSummaryGrid>
                  <AdminTechnicalDetails summary="Calculation formula details">
                    <AdminDefinitionList
                      items={claimDetail.data.claim.calculations.flatMap((calculation, index) => [
                        {
                          label: `Calculation ${index + 1}`,
                          value: `${calculation.quantity} ${adminLabel(calculation.unit)} × ${formatMoney(calculation.unitRateMinor)} = ${formatMoney(calculation.amountMinor)}`,
                        },
                        {
                          label: `Formula version ${index + 1}`,
                          value: calculation.formulaVersion,
                        },
                      ])}
                    />
                  </AdminTechnicalDetails>
                </AdminSection>
              )}

              <AdminSection
                title="Evidence"
                description="Open protected claim evidence through the existing audited temporary grant."
              >
                <div className="admin-evidence-grid">
                  {claimDetail.data.claim.evidence.map((evidence) => (
                    <AdminEvidenceCard
                      key={evidence.id}
                      displayMode={evidence.evidenceType === 'PHOTO' ? 'photo' : 'document'}
                      label={evidenceLabel(evidence.evidenceType)}
                      note={`Submitted by ${adminLabel(evidence.participantRole)}`}
                      requestAccess={() => grantFile(evidence.fileAsset.id)}
                    />
                  ))}
                </div>
                {claimDetail.data.claim.evidence.length === 0 && (
                  <EmptyState
                    title="No claim evidence"
                    description="No additional evidence files are attached to this claim."
                  />
                )}
              </AdminSection>

              {claimDetail.data.claim.booking.ownerEarning && (
                <AdminSection title="Financial exposure">
                  <AdminSummaryGrid>
                    <AdminSummaryCard
                      label="Calculated amount"
                      value={formatMoney(claimDetail.data.claim.calculations.at(-1)?.amountMinor)}
                    />
                    <AdminSummaryCard
                      label="Owner earning"
                      value={formatMoney(
                        claimDetail.data.claim.booking.ownerEarning.netEarningAmountMinor,
                      )}
                      detail={adminLabel(claimDetail.data.claim.booking.ownerEarning.status)}
                    />
                    <AdminSummaryCard
                      label="Active holds"
                      value={String(
                        claimDetail.data.claim.booking.ownerEarning.holds.filter(
                          (hold) => hold.status === 'ACTIVE',
                        ).length,
                      )}
                    />
                    <AdminSummaryCard
                      label="Additional compensation"
                      value={formatMoney(
                        claimDetail.data.claim.booking.ownerEarning.additionalCompensationMinor,
                      )}
                    />
                  </AdminSummaryGrid>
                </AdminSection>
              )}
              <AdminSection
                title="Decision history"
                description="Adjudications are immutable operational decisions."
              >
                {claimDetail.data.claim.adjudications.map((decision) => (
                  <article className="compact-panel" key={decision.id}>
                    <strong>{adminLabel(decision.outcome)}</strong>
                    <p>
                      {formatMoney(decision.approvedAmountMinor)} · {decision.reason}
                    </p>
                  </article>
                ))}
                {claimDetail.data.claim.adjudications.length === 0 && (
                  <EmptyState
                    title="No decision recorded"
                    description="This claim has not yet received an immutable adjudication."
                  />
                )}
              </AdminSection>
              {claimDetail.data.claim.status === 'UNDER_ADMIN_REVIEW' && (
                <AdminActionBar
                  title="Claim decision"
                  description="Review the evidence and financial effect before recording an immutable decision."
                >
                  <button
                    onClick={() => {
                      const amount = window.prompt(
                        'Approved amount in centavos. Leave blank for the full server formula.',
                      );
                      const reason = window.prompt('Approval reason');
                      if (reason)
                        claimAction.mutate({
                          id: selectedClaimId,
                          outcome: 'APPROVED',
                          reason,
                          ...(amount ? { approvedAmountMinor: Number(amount) } : {}),
                        });
                    }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      const amount = window.prompt('Partially approved amount in centavos');
                      const reason = window.prompt('Partial approval reason');
                      if (amount && reason)
                        claimAction.mutate({
                          approvedAmountMinor: Number(amount),
                          id: selectedClaimId,
                          outcome: 'PARTIALLY_APPROVED',
                          reason,
                        });
                    }}
                  >
                    Partial approval
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      const reason = window.prompt('Rejection reason');
                      if (reason)
                        claimAction.mutate({ id: selectedClaimId, outcome: 'REJECTED', reason });
                    }}
                  >
                    Reject
                  </button>
                  <button
                    className="quiet"
                    onClick={() => {
                      const reason = window.prompt('Evidence request');
                      if (reason)
                        claimAction.mutate({
                          id: selectedClaimId,
                          outcome: 'REQUEST_MORE_EVIDENCE',
                          reason,
                        });
                    }}
                  >
                    Request evidence
                  </button>
                  <button
                    className="quiet"
                    onClick={() => {
                      const reason = window.prompt('Dispute escalation reason');
                      if (reason)
                        claimAction.mutate({
                          id: selectedClaimId,
                          outcome: 'ESCALATED_TO_DISPUTE',
                          reason,
                        });
                    }}
                  >
                    Escalate dispute
                  </button>
                </AdminActionBar>
              )}
              {claimDetail.data.claim.disputes.map((dispute) => (
                <AdminSection key={dispute.id} title="Dispute" description={dispute.reason}>
                  <p>
                    <StatusBadge value={dispute.status} />
                  </p>
                  {['OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'].includes(dispute.status) && (
                    <div className="actions">
                      {(
                        ['RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED'] as const
                      ).map((status) => (
                        <button
                          className="quiet"
                          key={status}
                          onClick={() => {
                            const reason = window.prompt(`Reason for ${status}`);
                            if (reason) disputeAction.mutate({ id: dispute.id, reason, status });
                          }}
                        >
                          {adminLabel(status)}
                        </button>
                      ))}
                    </div>
                  )}
                </AdminSection>
              ))}
              {claimDetail.data.claim.additionalCharge && (
                <p>
                  Additional charge · {claimDetail.data.claim.additionalCharge.status} · approved ₱
                  {(
                    claimDetail.data.claim.additionalCharge.approvedAmountMinor / 100
                  ).toLocaleString()}
                  {' · '}collected ₱
                  {(
                    claimDetail.data.claim.additionalCharge.collectedAmountMinor / 100
                  ).toLocaleString()}
                  {claimDetail.data.claim.additionalCharge.status === 'PAID' && (
                    <button
                      className="quiet"
                      onClick={() => {
                        const amount = window.prompt('Refund amount in centavos');
                        const reason = window.prompt('Refund reason');
                        if (amount && reason)
                          chargeRefund.mutate({
                            amountMinor: Number(amount),
                            id: claimDetail.data.claim.additionalCharge!.id,
                            reason,
                          });
                      }}
                    >
                      Provider-aware refund
                    </button>
                  )}
                </p>
              )}
              <AdminTechnicalDetails
                summary={`Technical ledger details (${claimDetail.data.ledger.length})`}
              >
                <DataTable label="Claim technical ledger entries">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Posted</th>
                      <th>Account</th>
                      <th>Minor units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claimDetail.data.ledger.flatMap((entry) =>
                      entry.entries.map((line, index) => (
                        <tr key={`${entry.id}-${index}`}>
                          <td>{adminLabel(entry.type)}</td>
                          <td>{formatDate(entry.postedAt)}</td>
                          <td>{line.account.code}</td>
                          <td>{line.amountMinor}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </DataTable>
              </AdminTechnicalDetails>
              {(claimAction.error || disputeAction.error || chargeRefund.error) && (
                <p className="error-text">
                  {claimAction.error?.message ??
                    disputeAction.error?.message ??
                    chargeRefund.error?.message}
                </p>
              )}
            </div>
          )}
        </section>
        <section className="admin-card module-section module-payouts">
          <span className="eyebrow">OWNER PAYOUT OPERATIONS</span>
          <h2>Admin-controlled payout queue</h2>
          <p>
            Only eligible AVAILABLE earnings are shown. Approval is separate from provider
            submission, and provider confirmation is required before PAID.
          </p>
          {payoutQueue.isLoading && <p>Loading payout readiness…</p>}
          {payoutQueue.data?.length === 0 && (
            <EmptyState
              title="No owners ready for payout"
              description="There are currently no eligible owner earnings requiring payout action."
            />
          )}
          {payoutQueue.data && payoutQueue.data.length > 0 && (
            <DataTable label="Payout readiness queue">
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Eligibility</th>
                  <th>Eligible earnings</th>
                  <th>Destination</th>
                  <th>Provider</th>
                  <th>Attention</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payoutQueue.data.map((item) => (
                  <tr key={item.owner.id}>
                    <td>
                      <strong>{item.owner.displayName ?? item.owner.id}</strong>
                      <small>{item.owner.status}</small>
                    </td>
                    <td>
                      <StatusBadge value={item.payoutEligibility} />
                    </td>
                    <td>₱{(item.availableEligibleMinor / 100).toLocaleString()}</td>
                    <td>
                      {item.destination
                        ? `${item.destination.destinationChannel} ${item.destination.maskedAccountIdentifier}`
                        : 'Missing'}
                    </td>
                    <td>{item.provider}</td>
                    <td>
                      {item.blockers.length
                        ? item.blockers.join(', ')
                        : item.previousFailures
                          ? `${item.previousFailures} previous failure(s)`
                          : 'None'}
                    </td>
                    <td>
                      <div className="table-actions">
                        {item.payoutEligibility !== 'ELIGIBLE' && (
                          <button
                            className="quiet compact"
                            onClick={() => {
                              const reason = window.prompt('Eligibility review reason');
                              if (reason)
                                payoutAction.mutate({
                                  body: { reason, status: 'ELIGIBLE' },
                                  path: `owners/${item.owner.id}/payout-eligibility`,
                                });
                            }}
                          >
                            Mark eligible
                          </button>
                        )}
                        <button
                          className="compact"
                          disabled={item.blockers.length > 0 || item.availableEligibleMinor <= 0}
                          onClick={() =>
                            payoutAction.mutate({
                              body: { ownerProfileId: item.owner.id },
                              path: 'payouts',
                            })
                          }
                        >
                          Create payout
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <h3>Payout history and reconciliation</h3>
          {payouts.data?.length === 0 && (
            <EmptyState
              title="No payout history"
              description="No payout records have been created in this environment."
            />
          )}
          {payouts.data?.map((payout) => (
            <article className="review-row" key={payout.id}>
              <div>
                <strong>
                  {payout.publicReference} · ₱{(payout.amountMinor / 100).toLocaleString()}
                </strong>
                <span>
                  {payout.owner.displayName ?? payout.owner.id} · {payout.status} ·{' '}
                  {payout.destination.channel} {payout.destination.maskedIdentifier}
                </span>
                <span>
                  Provider {payout.providerState ?? 'not submitted'} · settlement{' '}
                  {payout.diagnostics.ledgerSettlementStatus}
                  {payout.diagnostics.problem ? ' · diagnostic problem' : ''}
                </span>
              </div>
              <div className="actions">
                <button className="quiet" onClick={() => setSelectedPayoutId(payout.id)}>
                  Diagnostics
                </button>
                {payout.status === 'PENDING_APPROVAL' && (
                  <button
                    onClick={() => {
                      const note = window.prompt('Approval note');
                      if (note)
                        payoutAction.mutate({
                          body: { note },
                          path: `payouts/${payout.id}/approve`,
                        });
                    }}
                  >
                    Approve
                  </button>
                )}
                {payout.status === 'APPROVED' && (
                  <button
                    onClick={() => payoutAction.mutate({ path: `payouts/${payout.id}/submit` })}
                  >
                    Submit
                  </button>
                )}
                {['PENDING_APPROVAL', 'APPROVED'].includes(payout.status) && (
                  <button
                    className="danger"
                    onClick={() => {
                      const reason = window.prompt('Cancellation reason');
                      if (reason)
                        payoutAction.mutate({
                          body: { reason },
                          path: `payouts/${payout.id}/cancel`,
                        });
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </article>
          ))}
          {selectedPayoutId && payoutDetail.data && (
            <div className="vehicle-detail">
              <div className="detail-heading">
                <h3>Reconciliation · {payoutDetail.data.publicReference}</h3>
                <button className="quiet" onClick={() => setSelectedPayoutId(null)}>
                  Close
                </button>
              </div>
              <p>
                Internal {payoutDetail.data.status} · provider{' '}
                {payoutDetail.data.providerState ?? 'unknown'} · reference{' '}
                {payoutDetail.data.diagnostics.providerReference ?? 'not acknowledged'}
              </p>
              <p>
                Ledger {payoutDetail.data.diagnostics.ledgerSettlementStatus} · balanced{' '}
                {payoutDetail.data.diagnostics.ledgerBalanced ? 'yes' : 'no'} · difference{' '}
                {payoutDetail.data.diagnostics.differenceMinor}
              </p>
              <ol className="history">
                {payoutDetail.data.items.map((item) => (
                  <li key={item.earningId}>
                    <strong>{item.bookingReference}</strong>
                    <span>
                      earning {item.earningId} · {item.amountMinor}
                    </span>
                  </li>
                ))}
              </ol>
              {['SUBMITTING', 'PROCESSING'].includes(payoutDetail.data.status) && (
                <button
                  onClick={() =>
                    payoutAction.mutate({ path: `payouts/${payoutDetail.data.id}/reconcile` })
                  }
                >
                  Retrieve provider truth
                </button>
              )}
            </div>
          )}
          {payoutAction.error && <p className="error-text">{payoutAction.error.message}</p>}
        </section>
        <section
          className={`admin-card module-section module-bookings ${selectedFinanceReference ? 'is-detail-route' : ''}`}
        >
          <span className="eyebrow">BOOKING DIAGNOSTICS</span>
          <h2>Authoritative holds</h2>
          <p>
            Read-only lifecycle and occupancy visibility. No financial or arbitrary status controls.
          </p>
          {bookings.isLoading && <p>Loading bookings…</p>}
          {bookings.data?.length === 0 && (
            <EmptyState
              title="No booking records"
              description="No authoritative booking lifecycle records are available yet."
            />
          )}
          {bookings.data && bookings.data.length > 0 && (
            <DataTable label="Admin bookings">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Vehicle</th>
                  <th>Rental period</th>
                  <th>Lifecycle</th>
                  <th>Occupancy</th>
                  <th>Financial attention</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {bookings.data.map((booking) => (
                  <tr key={booking.bookingId}>
                    <td>
                      <strong>{booking.publicReference}</strong>
                    </td>
                    <td>
                      {booking.vehicle.make} {booking.vehicle.model}
                    </td>
                    <td>
                      {new Date(booking.rentalStart).toLocaleDateString()} –{' '}
                      {new Date(booking.rentalEnd).toLocaleDateString()}
                    </td>
                    <td>
                      <StatusBadge value={booking.status} />
                    </td>
                    <td>
                      <StatusBadge
                        value={booking.diagnostics.occupancy?.active ? 'BLOCKING' : 'RELEASED'}
                      />
                    </td>
                    <td>{booking.diagnostics.reason?.replaceAll('_', ' ') ?? 'None'}</td>
                    <td>
                      <Link
                        href={`/admin/bookings/${booking.publicReference}`}
                        onClick={() => setSelectedFinanceReference(booking.publicReference)}
                      >
                        Open detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {selectedFinanceReference && (
            <div className="detail-page">
              <AdminDetailHeader
                backHref="/admin/bookings"
                backLabel="Booking queue"
                eyebrow="Booking & financial operations"
                title={selectedFinanceReference}
                {...(() => {
                  const status = bookings.data?.find(
                    (booking) => booking.publicReference === selectedFinanceReference,
                  )?.status;
                  return status ? { status } : {};
                })()}
                description={(() => {
                  const booking = bookings.data?.find(
                    (item) => item.publicReference === selectedFinanceReference,
                  );
                  return booking
                    ? `${booking.vehicle.make ?? ''} ${booking.vehicle.model ?? ''} · ${formatDate(booking.rentalStart)} to ${formatDate(booking.rentalEnd)}`
                    : 'Authoritative booking finance records';
                })()}
              />
              {financialDetail.isLoading && <p>Loading authoritative finance records…</p>}
              {financialDetail.data && (
                <>
                  <AdminSection title="Payment summary">
                    <AdminSummaryGrid>
                      <AdminSummaryCard
                        label="Total payment"
                        value={formatMoney(
                          financialDetail.data.payments.reduce(
                            (sum, payment) => sum + payment.amountMinor,
                            0,
                          ),
                        )}
                      />
                      <AdminSummaryCard
                        label="Captured"
                        value={formatMoney(
                          financialDetail.data.payments.reduce(
                            (sum, payment) => sum + payment.capturedAmountMinor,
                            0,
                          ),
                        )}
                      />
                      <AdminSummaryCard
                        label="Payment status"
                        value={
                          financialDetail.data.payments[0]
                            ? adminLabel(financialDetail.data.payments[0].status)
                            : 'No payment'
                        }
                      />
                      <AdminSummaryCard
                        label="Provider"
                        value={financialDetail.data.payments[0]?.provider ?? 'Not assigned'}
                        detail={
                          financialDetail.data.payments.some(
                            (payment) => payment.reconciliationRequired,
                          )
                            ? 'Reconciliation required'
                            : 'No reconciliation flag'
                        }
                      />
                    </AdminSummaryGrid>
                  </AdminSection>

                  <AdminSection
                    title="Financial breakdown"
                    description="Human-readable allocation from immutable financial records."
                  >
                    <AdminDefinitionList
                      items={[
                        {
                          label: 'Rental total',
                          value: formatMoney(
                            financialDetail.data.payments.reduce(
                              (sum, payment) => sum + payment.capturedAmountMinor,
                              0,
                            ),
                          ),
                        },
                        {
                          label: 'Platform commission',
                          value: formatMoney(
                            financialDetail.data.commission?.calculatedCommissionMinor,
                          ),
                        },
                        {
                          label: 'Owner earning',
                          value: formatMoney(financialDetail.data.earning?.netEarningAmountMinor),
                        },
                        {
                          label: 'Commission rate',
                          value: financialDetail.data.commission
                            ? `${financialDetail.data.commission.rateBasisPoints / 100}%`
                            : 'Not calculated',
                        },
                      ]}
                    />
                  </AdminSection>

                  <AdminSection
                    title="Financial timeline"
                    description="Business events are shown first; accounting lines remain available below for audit."
                  >
                    <AdminTimeline
                      events={financialDetail.data.ledger.map((entry) => ({
                        id: entry.id,
                        title: adminLabel(entry.type),
                        occurredAt: entry.postedAt,
                        detail: `${entry.entries.length} balanced accounting line${entry.entries.length === 1 ? '' : 's'}`,
                      }))}
                    />
                  </AdminSection>

                  <AdminTechnicalDetails
                    summary={`Technical ledger details (${financialDetail.data.ledger.length})`}
                  >
                    <DataTable label="Booking technical ledger">
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Posted</th>
                          <th>Account</th>
                          <th>Minor units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {financialDetail.data.ledger.flatMap((entry) =>
                          entry.entries.map((line, index) => (
                            <tr key={`${entry.id}-${index}`}>
                              <td>{adminLabel(entry.type)}</td>
                              <td>{formatDate(entry.postedAt)}</td>
                              <td>{line.account.code}</td>
                              <td>{line.amountMinor}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </DataTable>
                  </AdminTechnicalDetails>
                </>
              )}
            </div>
          )}
        </section>
        <section className="admin-card module-section module-commissions">
          <span className="eyebrow">COMMISSION CONFIGURATION</span>
          <h2>Versioned rules</h2>
          <p>
            Historical booking snapshots never change. New rules take precedence owner → category →
            platform.
          </p>
          <button
            onClick={() => {
              const bps = window.prompt('New platform default basis points', '1500');
              const reason = window.prompt('Reason for this new version');
              if (bps && reason)
                commissionAction.mutate({
                  operation: 'create',
                  body: { scope: 'PLATFORM_DEFAULT', rateBasisPoints: Number(bps), reason },
                });
            }}
          >
            Add platform-default version
          </button>
          {commissionRules.data && commissionRules.data.length > 0 && (
            <DataTable label="Commission rule versions">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Version</th>
                  <th>Rate</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {commissionRules.data.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <strong>{rule.scope}</strong>
                    </td>
                    <td>v{rule.version}</td>
                    <td>{rule.rateBasisPoints / 100}%</td>
                    <td>{rule.reason}</td>
                    <td>
                      <StatusBadge value={rule.disabledAt ? 'DISABLED' : 'ACTIVE'} />
                    </td>
                    <td>
                      {!rule.disabledAt && (
                        <button
                          className="danger compact"
                          onClick={() => {
                            const reason = window.prompt('Reason for disabling this rule');
                            if (reason)
                              commissionAction.mutate({
                                operation: 'disable',
                                id: rule.id,
                                body: { reason },
                              });
                          }}
                        >
                          Disable
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
        {activeModule === 'owner-verification' && (
          <OwnerVerificationAdminPanel
            accessToken={accessToken}
            {...(detailId ? { initialSelectedId: detailId } : {})}
            onUnauthorized={logout}
          />
        )}
        <section className="admin-card module-section module-users">
          {detailId ? (
            <AdminUserDetail accessToken={accessToken} onUnauthorized={logout} userId={detailId} />
          ) : (
            <>
              <span className="eyebrow">USER LOOKUP</span>
              <h2>Accounts</h2>
              <div className="filter-toolbar">
                <label>
                  Search
                  <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Email or mobile"
                    value={query}
                  />
                </label>
                <label>
                  Role
                  <select
                    onChange={(event) => setUserRoleFilter(event.target.value)}
                    value={userRoleFilter}
                  >
                    <option value="ALL">All roles</option>
                    <option value="RENTER">Renter</option>
                    <option value="OWNER">Vehicle Owner</option>
                  </select>
                </label>
                <label>
                  Status
                  <select
                    onChange={(event) => setUserStatusFilter(event.target.value)}
                    value={userStatusFilter}
                  >
                    <option value="ALL">All states</option>
                    <option value="ACTIVE">Active</option>
                    <option value="SUSPENDED">Suspended</option>
                    <option value="DISABLED">Disabled</option>
                  </select>
                </label>
              </div>
              {users.isLoading && <div className="state-panel">Loading accounts…</div>}
              {users.error && <div className="state-panel error-text">{users.error.message}</div>}
              {visibleUsers?.length ? (
                <DataTable label="User accounts">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Contact</th>
                      <th>Roles</th>
                      <th>Verification</th>
                      <th>Status</th>
                      <th>Joined</th>
                      <th>Activity</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => {
                      const roles = user.roles.map(({ role }) => role.code);
                      const verification =
                        user.verifications?.[0]?.status ??
                        user.ownerProfile?.status ??
                        'NOT_SUBMITTED';
                      return (
                        <tr key={user.id}>
                          <td>
                            <strong>
                              {(user.profile?.displayName ??
                                [user.profile?.firstName, user.profile?.lastName]
                                  .filter(Boolean)
                                  .join(' ')) ||
                                'Unnamed account'}
                            </strong>
                          </td>
                          <td>{user.email ?? user.mobileNumber ?? 'No contact'}</td>
                          <td>{roles.map(marketplaceRoleLabel).join(' • ') || '—'}</td>
                          <td>
                            <StatusBadge value={verification} />
                          </td>
                          <td>
                            <StatusBadge value={user.status} />
                          </td>
                          <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                          <td>
                            {user._count.renterBookings} renter · {user._count.ownedVehicles}{' '}
                            vehicles · {user._count.ownerBookings} owner
                          </td>
                          <td>
                            <Link href={`/admin/users/${user.id}`}>View account</Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              ) : !users.isLoading && !users.error ? (
                <EmptyState
                  title="No matching accounts"
                  description="Adjust the search or filters to find another account."
                />
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  href,
  label,
  value,
}: {
  readonly href: string;
  readonly label: string;
  readonly value: number | undefined;
}) {
  return (
    <Link className="metric-card" href={href}>
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
      <small>Open queue →</small>
    </Link>
  );
}
