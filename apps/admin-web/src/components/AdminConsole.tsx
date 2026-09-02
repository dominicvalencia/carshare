'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Phase10AdminPanels } from './Phase10AdminPanels';
import { RenterVerificationAdminPanel } from './RenterVerificationAdminPanel';
import { InspectionCorrectionsAdminPanel } from './InspectionCorrectionsAdminPanel';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
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
  readonly ownerProfile: { readonly status: string } | null;
}
interface VehicleSummary {
  readonly id: string;
  readonly status: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly submittedAt: string | null;
  readonly ownerProfile: {
    readonly status: string;
    readonly legalName: string | null;
    readonly user: { readonly email: string | null };
  };
}
interface VehicleDetail extends VehicleSummary {
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
  readonly id: string;
  readonly publicReference: string;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly actualPickupAt: string | null;
  readonly actualReturnAt: string | null;
  readonly claimDeadlineAt: string | null;
  readonly operationalHold: boolean;
  readonly vehicle: { make: string | null; model: string | null; powertrain: string | null };
  readonly inspections: readonly {
    id: string;
    type: string;
    odometerMeters: string | null;
    fuelBasisPoints: number | null;
    batterySocBasisPoints: number | null;
    media: readonly { perspective: string; fileAsset: { id: string; originalName: string } }[];
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

export function AdminConsole() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedFinanceReference, setSelectedFinanceReference] = useState<string | null>(null);
  const [selectedRentalReference, setSelectedRentalReference] = useState<string | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [selectedPayoutId, setSelectedPayoutId] = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState('');
  const [claimCategory, setClaimCategory] = useState('');
  const [claimSeverity, setClaimSeverity] = useState('');
  const [claimMinimumAgeHours, setClaimMinimumAgeHours] = useState('');
  const client = useQueryClient();
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
    if (!response.ok || !envelope.success)
      throw new Error(envelope.error?.message ?? 'Request failed.');
    return envelope.data as T;
  };
  const owners = useQuery({
    queryKey: ['admin-owners'],
    queryFn: () => api<Owner[]>('/admin/owners?status=PENDING_VERIFICATION'),
    enabled: Boolean(accessToken),
  });
  const users = useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => api<User[]>(`/admin/users?query=${encodeURIComponent(query)}`),
    enabled: Boolean(accessToken),
  });
  const vehicles = useQuery({
    queryKey: ['admin-vehicles'],
    queryFn: () => api<VehicleSummary[]>('/admin/vehicles?status=PENDING_APPROVAL'),
    enabled: Boolean(accessToken),
  });
  const vehicle = useQuery({
    queryKey: ['admin-vehicle', selectedVehicleId],
    queryFn: () => api<VehicleDetail>(`/admin/vehicles/${selectedVehicleId}`),
    enabled: Boolean(accessToken && selectedVehicleId),
  });
  const publicVisibility = useQuery({
    queryKey: ['admin-vehicle-public-visibility', selectedVehicleId],
    queryFn: () => api<PublicVisibility>(`/admin/vehicles/${selectedVehicleId}/public-visibility`),
    enabled: Boolean(accessToken && selectedVehicleId),
  });
  const bookings = useQuery({
    queryKey: ['admin-bookings'],
    queryFn: () => api<AdminBooking[]>('/admin/bookings'),
    enabled: Boolean(accessToken),
  });
  const financialDetail = useQuery({
    queryKey: ['admin-finance-booking', selectedFinanceReference],
    queryFn: () => api<FinancialDetail>(`/admin/finance/bookings/${selectedFinanceReference}`),
    enabled: Boolean(accessToken && selectedFinanceReference),
  });
  const commissionRules = useQuery({
    queryKey: ['commission-rules'],
    queryFn: () => api<CommissionRule[]>('/admin/finance/commission-rules'),
    enabled: Boolean(accessToken),
  });
  const rentalQueue = useQuery({
    queryKey: ['admin-rentals'],
    queryFn: () => api<OperationalRental[]>('/admin/rentals'),
    enabled: Boolean(accessToken),
  });
  const rentalDetail = useQuery({
    queryKey: ['admin-rental', selectedRentalReference],
    queryFn: () => api<OperationalRental>(`/admin/rentals/${selectedRentalReference}`),
    enabled: Boolean(accessToken && selectedRentalReference),
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
    enabled: Boolean(accessToken),
  });
  const claimDetail = useQuery({
    queryKey: ['admin-claim', selectedClaimId],
    queryFn: () => api<ClaimDetail>(`/admin/claims/${selectedClaimId}`),
    enabled: Boolean(accessToken && selectedClaimId),
  });
  const payoutQueue = useQuery({
    queryKey: ['admin-payout-queue'],
    queryFn: () => api<PayoutQueueItem[]>('/admin/payouts/queue'),
    enabled: Boolean(accessToken),
  });
  const payouts = useQuery({
    queryKey: ['admin-payouts'],
    queryFn: () => api<AdminPayout[]>('/admin/payouts'),
    enabled: Boolean(accessToken),
  });
  const payoutDetail = useQuery({
    queryKey: ['admin-payout', selectedPayoutId],
    queryFn: () => api<AdminPayout>(`/admin/payouts/${selectedPayoutId}`),
    enabled: Boolean(accessToken && selectedPayoutId),
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
  const action = useMutation({
    mutationFn: ({ id, operation, reason }: { id: string; operation: string; reason?: string }) =>
      api(`/admin/owners/${id}/${operation}`, {
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        method: 'POST',
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin-owners'] }),
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
  const openFile = async (id: string) => {
    const grant = await api<{ contentPath: string }>(`/files/${id}/access-grants`, {
      method: 'POST',
    });
    window.open(`${new URL(API_URL).origin}${grant.contentPath}`, '_blank', 'noopener,noreferrer');
  };
  if (!accessToken) return <AdminLogin onAuthenticated={setAccessToken} />;
  return (
    <div className="admin-grid">
      <section className="admin-card vehicle-review-card">
        <span className="eyebrow">VEHICLE REVIEW</span>
        <h2>Pending listings</h2>
        {vehicles.isLoading && <p>Loading queue…</p>}
        {vehicles.data?.map((item) => (
          <button
            className="review-row review-button"
            key={item.id}
            onClick={() => setSelectedVehicleId(item.id)}
          >
            <span>
              <strong>
                {item.make && item.model ? `${item.make} ${item.model}` : 'Vehicle draft'}
              </strong>
              <span>{item.ownerProfile.legalName ?? item.ownerProfile.user.email}</span>
            </span>
            <span>Review →</span>
          </button>
        ))}
        {selectedVehicleId && vehicle.data && (
          <div className="vehicle-detail">
            <div className="detail-heading">
              <div>
                <span className="eyebrow">SECURE REVIEW WORKSPACE</span>
                <h3>
                  {vehicle.data.make} {vehicle.data.model} · {vehicle.data.modelYear}
                </h3>
              </div>
              <button className="quiet" onClick={() => setSelectedVehicleId(null)}>
                Close
              </button>
            </div>
            <p>
              {vehicle.data.powertrain} · {vehicle.data.fuelType} · owner{' '}
              {vehicle.data.ownerProfile.status}
            </p>
            <h4>Public discovery diagnostic</h4>
            {publicVisibility.isLoading ? (
              <p>Checking public eligibility…</p>
            ) : publicVisibility.data?.discoverable ? (
              <p>Discoverable · public projection is eligible</p>
            ) : (
              <p>
                Not discoverable ·{' '}
                {publicVisibility.data?.reasons.join(', ') ?? 'diagnostic unavailable'}
              </p>
            )}
            {vehicle.data.location && (
              <p>
                Private location: {vehicle.data.location.latitude},{' '}
                {vehicle.data.location.longitude} · {vehicle.data.location.city},{' '}
                {vehicle.data.location.province}
              </p>
            )}
            <h4>Photos</h4>
            <div className="file-grid">
              {vehicle.data.photos.map((photo) => (
                <button
                  className="file-button"
                  key={photo.id}
                  onClick={() => void openFile(photo.fileAsset.id)}
                >
                  {photo.perspective}
                  <small>{photo.fileAsset.originalName}</small>
                </button>
              ))}
            </div>
            <h4>Sensitive documents</h4>
            <div className="file-grid">
              {vehicle.data.documents
                .filter((document) => !document.replacedAt)
                .map((document) => (
                  <button
                    className="file-button sensitive"
                    key={document.id}
                    onClick={() => void openFile(document.fileAsset.id)}
                  >
                    {document.definition.name}
                    <small>Open with 5-minute grant</small>
                  </button>
                ))}
            </div>
            <h4>Current configuration</h4>
            {vehicle.data.policyVersions[0] ? (
              <p>
                ₱{(vehicle.data.policyVersions[0].dailyRateMinor / 100).toLocaleString()} / day ·{' '}
                {vehicle.data.policyVersions[0].mileagePolicy} ·{' '}
                {vehicle.data.policyVersions[0].turnaroundMinutes / 60}h turnaround · version{' '}
                {vehicle.data.policyVersions[0].version}
              </p>
            ) : (
              <p>Missing policy</p>
            )}
            <h4>Status history</h4>
            <ol className="history">
              {vehicle.data.statusHistory.map((entry) => (
                <li key={entry.id}>
                  <strong>
                    {entry.previousStatus ?? 'START'} → {entry.newStatus}
                  </strong>
                  <span>
                    {new Date(entry.occurredAt).toLocaleString()}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </span>
                </li>
              ))}
            </ol>
            <h4>Administrative audit trail</h4>
            <ol className="history">
              {vehicle.data.auditLogs.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.action}</strong>
                  <span>
                    {new Date(entry.occurredAt).toLocaleString()}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                    {entry.correlationId ? ` · ${entry.correlationId}` : ''}
                  </span>
                </li>
              ))}
            </ol>
            <div className="actions">
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
            </div>
            {vehicleAction.error && <p className="error-text">{vehicleAction.error.message}</p>}
          </div>
        )}
      </section>
      <RenterVerificationAdminPanel accessToken={accessToken} />
      <InspectionCorrectionsAdminPanel accessToken={accessToken} />
      <Phase10AdminPanels accessToken={accessToken} />
      <section className="admin-card">
        <span className="eyebrow">RENTAL OPERATIONS</span>
        <h2>Pickup, active and return queue</h2>
        <p>Operational evidence is read-only. Holds require an explicit audited command.</p>
        {rentalQueue.isLoading && <p>Loading rental queue…</p>}
        {rentalQueue.data?.map((rental) => (
          <article className="review-row" key={rental.id}>
            <div>
              <strong>
                {rental.publicReference} · {rental.vehicle.make} {rental.vehicle.model}
              </strong>
              <span>
                {rental.status}
                {rental.operationalHold ? ' · operational hold' : ''}
              </span>
              <span>
                {new Date(rental.rentalStart).toLocaleString()} →{' '}
                {new Date(rental.rentalEnd).toLocaleString()}
              </span>
              {rental.claimDeadlineAt && (
                <span>Claim deadline {new Date(rental.claimDeadlineAt).toLocaleString()}</span>
              )}
            </div>
            <button
              className="quiet"
              onClick={() => setSelectedRentalReference(rental.publicReference)}
            >
              Inspect operations
            </button>
          </article>
        ))}
        {selectedRentalReference && rentalDetail.data && (
          <div className="vehicle-detail">
            <div className="detail-heading">
              <h3>Operational timeline · {selectedRentalReference}</h3>
              <button className="quiet" onClick={() => setSelectedRentalReference(null)}>
                Close
              </button>
            </div>
            <p>
              Actual pickup{' '}
              {rentalDetail.data.actualPickupAt
                ? new Date(rentalDetail.data.actualPickupAt).toLocaleString()
                : '—'}{' '}
              · Actual return{' '}
              {rentalDetail.data.actualReturnAt
                ? new Date(rentalDetail.data.actualReturnAt).toLocaleString()
                : '—'}
            </p>
            {rentalDetail.data.inspections.map((inspection) => (
              <div key={inspection.id}>
                <h4>{inspection.type} inspection</h4>
                <p>
                  Odometer {inspection.odometerMeters ?? '—'} m · fuel{' '}
                  {inspection.fuelBasisPoints ?? 'N/A'} bp · SOC{' '}
                  {inspection.batterySocBasisPoints ?? 'N/A'} bp
                </p>
                <div className="actions">
                  {inspection.media.map((media) => (
                    <button
                      className="quiet"
                      key={media.fileAsset.id}
                      onClick={() => void openFile(media.fileAsset.id)}
                    >
                      {media.perspective}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {rentalDetail.data.usageSummary && (
              <p>
                Travelled {rentalDetail.data.usageSummary.distanceTravelledKm} km · included{' '}
                {rentalDetail.data.usageSummary.includedDistanceKm ?? 'unlimited'} · excess{' '}
                {rentalDetail.data.usageSummary.excessDistanceKm} km · late{' '}
                {Math.ceil(rentalDetail.data.usageSummary.lateDurationSeconds / 60)} minutes
                {rentalDetail.data.usageSummary.returnDisputed ? ' · measurements disputed' : ''}
              </p>
            )}
            {rentalDetail.data.postReturnClaims.map((claim) => (
              <p key={claim.id}>
                Claim · {claim.category} · {claim.status}
              </p>
            ))}
            {rentalDetail.data.rentalIncidents.map((incident) => (
              <div key={incident.id}>
                <p>
                  Incident · {incident.category} · {incident.severity} · {incident.status}
                </p>
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
                          incidentAction.mutate({ id: incident.id, reason, status: 'RESOLVED' });
                      }}
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            ))}
            <ol className="history">
              {rentalDetail.data.statusHistory.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.toStatus}</strong>
                  <span>
                    {new Date(entry.occurredAt).toLocaleString()} ·{' '}
                    {entry.reasonCode ?? 'state transition'}
                  </span>
                </li>
              ))}
            </ol>
            {rentalDetail.data.status === 'READY_FOR_PICKUP' &&
              rentalDetail.data.inspections.some(({ type }) => type === 'PICKUP') && (
                <button
                  className="danger"
                  onClick={() => {
                    const reason = window.prompt(
                      'Reason for administratively confirming physical pickup after reviewing inspection, code activity, timestamps, participant reports, and evidence',
                    );
                    if (reason && reason.trim().length >= 10)
                      handoverResolution.mutate({
                        action: 'CONFIRM_PICKUP',
                        reason,
                        reference: selectedRentalReference,
                      });
                  }}
                >
                  Resolve physical pickup
                </button>
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
          </div>
        )}
      </section>
      <section className="admin-card">
        <span className="eyebrow">CLAIMS &amp; DISPUTES</span>
        <h2>Structured post-return review</h2>
        <p>
          Review inspections, measurements, evidence, renter response, financial exposure, holds,
          and ledger history in one workspace. Owners cannot set charge amounts.
        </p>
        <div className="form-grid">
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
        {claimQueue.data?.items.map((claim) => (
          <article className="review-row" key={claim.id}>
            <div>
              <strong>
                {claim.booking.publicReference} · {claim.category.replaceAll('_', ' ')}
              </strong>
              <span>
                {claim.status.replaceAll('_', ' ')} · {claim.severity} severity · submitted{' '}
                {new Date(claim.submittedAt).toLocaleString()}
              </span>
              <span>
                Calculated ₱{((claim.calculations.at(-1)?.amountMinor ?? 0) / 100).toLocaleString()}{' '}
                · renter {claim.response?.decision ?? 'awaiting response'}
              </span>
            </div>
            <button className="quiet" onClick={() => setSelectedClaimId(claim.id)}>
              Review claim
            </button>
          </article>
        ))}
        {selectedClaimId && claimDetail.data && (
          <div className="vehicle-detail">
            <div className="detail-heading">
              <h3>
                {claimDetail.data.claim.booking.publicReference} ·{' '}
                {claimDetail.data.claim.category.replaceAll('_', ' ')}
              </h3>
              <button className="quiet" onClick={() => setSelectedClaimId(null)}>
                Close
              </button>
            </div>
            <p>{claimDetail.data.claim.description}</p>
            {claimDetail.data.claim.booking.usageSummary && (
              <p>
                Usage: {claimDetail.data.claim.booking.usageSummary.distanceTravelledKm} km · excess{' '}
                {claimDetail.data.claim.booking.usageSummary.excessDistanceKm} km · fuel deficiency{' '}
                {claimDetail.data.claim.booking.usageSummary.fuelDeficiencyBasisPoints ?? 0} bp · EV
                deficiency{' '}
                {claimDetail.data.claim.booking.usageSummary.socDeficiencyBasisPoints ?? 0} bp ·
                late{' '}
                {Math.ceil(claimDetail.data.claim.booking.usageSummary.lateDurationSeconds / 60)}{' '}
                min
              </p>
            )}
            {claimDetail.data.claim.calculations.map((calculation) => (
              <p key={calculation.formulaVersion}>
                Formula {calculation.formulaVersion} · {calculation.quantity} {calculation.unit} × ₱
                {(calculation.unitRateMinor / 100).toLocaleString()} = ₱
                {(calculation.amountMinor / 100).toLocaleString()}
              </p>
            ))}
            <p>
              Renter response: {claimDetail.data.claim.response?.decision ?? 'NO RESPONSE'} ·{' '}
              {claimDetail.data.claim.response?.explanation ?? 'No explanation submitted.'}
            </p>
            <div className="actions">
              {claimDetail.data.claim.evidence.map((evidence) => (
                <button
                  className="quiet"
                  key={evidence.id}
                  onClick={() => void openFile(evidence.fileAsset.id)}
                >
                  {evidence.participantRole} · {evidence.evidenceType}
                </button>
              ))}
            </div>
            {claimDetail.data.claim.booking.ownerEarning && (
              <p>
                Owner earning {claimDetail.data.claim.booking.ownerEarning.status} · ₱
                {(
                  claimDetail.data.claim.booking.ownerEarning.netEarningAmountMinor / 100
                ).toLocaleString()}
                {' · '}active holds{' '}
                {
                  claimDetail.data.claim.booking.ownerEarning.holds.filter(
                    (hold) => hold.status === 'ACTIVE',
                  ).length
                }
              </p>
            )}
            {claimDetail.data.claim.adjudications.map((decision) => (
              <p key={decision.id}>
                Immutable decision · {decision.outcome} · ₱
                {(decision.approvedAmountMinor / 100).toLocaleString()} · {decision.reason}
              </p>
            ))}
            {claimDetail.data.claim.status === 'UNDER_ADMIN_REVIEW' && (
              <div className="actions">
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
              </div>
            )}
            {claimDetail.data.claim.disputes.map((dispute) => (
              <div key={dispute.id}>
                <p>
                  Dispute · {dispute.status} · {dispute.reason}
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
                        {status.replaceAll('_', ' ')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
            <ol className="history">
              {claimDetail.data.ledger.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.type}</strong>
                  <span>
                    {entry.entries
                      .map((line) => `${line.account.code} ${line.amountMinor}`)
                      .join(' / ')}
                  </span>
                </li>
              ))}
            </ol>
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
      <section className="admin-card">
        <span className="eyebrow">OWNER PAYOUT OPERATIONS</span>
        <h2>Admin-controlled payout queue</h2>
        <p>
          Only eligible AVAILABLE earnings are shown. Approval is separate from provider submission,
          and provider confirmation is required before PAID.
        </p>
        {payoutQueue.isLoading && <p>Loading payout readiness…</p>}
        {payoutQueue.data?.map((item) => (
          <article className="review-row" key={item.owner.id}>
            <div>
              <strong>{item.owner.displayName ?? item.owner.id}</strong>
              <span>
                Owner {item.owner.status} · payout {item.payoutEligibility} · {item.provider}
              </span>
              <span>
                Eligible ₱{(item.availableEligibleMinor / 100).toLocaleString()} · destination{' '}
                {item.destination
                  ? `${item.destination.destinationChannel} ${item.destination.maskedAccountIdentifier}`
                  : 'missing'}
              </span>
              {item.blockers.length > 0 && <span>Blockers: {item.blockers.join(', ')}</span>}
              {item.previousFailures > 0 && (
                <span>Previous payout failures: {item.previousFailures}</span>
              )}
            </div>
            <div className="actions">
              {item.payoutEligibility !== 'ELIGIBLE' && (
                <button
                  className="quiet"
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
          </article>
        ))}
        <h3>Payout history and reconciliation</h3>
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
      <section className="admin-card">
        <span className="eyebrow">BOOKING DIAGNOSTICS</span>
        <h2>Authoritative holds</h2>
        <p>
          Read-only lifecycle and occupancy visibility. No financial or arbitrary status controls.
        </p>
        {bookings.isLoading && <p>Loading bookings…</p>}
        {bookings.data?.length === 0 && <p>No booking holds yet.</p>}
        {bookings.data?.map((booking) => (
          <article className="review-row" key={booking.bookingId}>
            <div>
              <strong>
                {booking.publicReference} · {booking.vehicle.make} {booking.vehicle.model}
              </strong>
              <span>
                {booking.status} · occupancy{' '}
                {booking.diagnostics.occupancy?.active ? 'blocking' : 'released'}
              </span>
              <span>
                {new Date(booking.rentalStart).toLocaleString()} →{' '}
                {new Date(booking.rentalEnd).toLocaleString()}
              </span>
              {booking.diagnostics.reason && <span>{booking.diagnostics.reason}</span>}
              <button
                className="quiet"
                onClick={() => setSelectedFinanceReference(booking.publicReference)}
              >
                Financial timeline
              </button>
            </div>
          </article>
        ))}
        {selectedFinanceReference && (
          <div className="vehicle-detail">
            <div className="detail-heading">
              <h3>Financial timeline · {selectedFinanceReference}</h3>
              <button className="quiet" onClick={() => setSelectedFinanceReference(null)}>
                Close
              </button>
            </div>
            {financialDetail.isLoading && <p>Loading authoritative finance records…</p>}
            {financialDetail.data?.payments.map((payment) => (
              <div key={payment.paymentId}>
                <h4>
                  {payment.provider} payment · {payment.status}
                </h4>
                <p>
                  ₱{(payment.amountMinor / 100).toLocaleString()} · provider{' '}
                  {payment.providerState ?? 'pending'}
                  {payment.reconciliationRequired ? ' · reconciliation required' : ''}
                </p>
              </div>
            ))}
            {financialDetail.data?.commission && (
              <p>
                Commission {financialDetail.data.commission.rateBasisPoints / 100}% · ₱
                {(financialDetail.data.commission.calculatedCommissionMinor / 100).toLocaleString()}{' '}
                · {financialDetail.data.commission.scope}
              </p>
            )}
            {financialDetail.data?.earning && (
              <p>
                Owner earning ₱
                {(financialDetail.data.earning.netEarningAmountMinor / 100).toLocaleString()} ·{' '}
                {financialDetail.data.earning.status}
              </p>
            )}
            <ol className="history">
              {financialDetail.data?.ledger.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.type}</strong>
                  <span>
                    {new Date(entry.postedAt).toLocaleString()} ·{' '}
                    {entry.entries
                      .map((line) => `${line.account.code} ${line.amountMinor}`)
                      .join(' / ')}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
      <section className="admin-card">
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
        {commissionRules.data?.map((rule) => (
          <article className="review-row" key={rule.id}>
            <div>
              <strong>
                {rule.scope} · v{rule.version} · {rule.rateBasisPoints / 100}%
              </strong>
              <span>
                {rule.disabledAt ? 'Disabled' : 'Active'} · {rule.reason}
              </span>
            </div>
            {!rule.disabledAt && (
              <button
                className="danger"
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
          </article>
        ))}
      </section>
      <section className="admin-card">
        <span className="eyebrow">OWNER VERIFICATION</span>
        <h2>Pending review</h2>
        {owners.isLoading && <p>Loading queue…</p>}
        {owners.data?.map((owner) => (
          <article className="review-row" key={owner.id}>
            <div>
              <strong>
                {owner.legalName ?? owner.user.profile?.displayName ?? owner.user.email}
              </strong>
              <span>{owner.status}</span>
            </div>
            <div className="actions">
              <button onClick={() => action.mutate({ id: owner.id, operation: 'approval' })}>
                Approve
              </button>
              <button
                className="danger"
                onClick={() => {
                  const reason = window.prompt('Rejection reason');
                  if (reason) action.mutate({ id: owner.id, operation: 'rejection', reason });
                }}
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="admin-card">
        <span className="eyebrow">USER LOOKUP</span>
        <h2>Accounts</h2>
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Email or mobile"
          value={query}
        />
        {users.data?.map((user) => (
          <article className="review-row" key={user.id}>
            <div>
              <strong>{user.email ?? user.mobileNumber}</strong>
              <span>
                {user.status}
                {user.ownerProfile ? ` · Owner ${user.ownerProfile.status}` : ''}
              </span>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function AdminLogin({ onAuthenticated }: { readonly onAuthenticated: (token: string) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${API_URL}/admin/auth/login`, {
        body: JSON.stringify({ identifier, password, platform: 'WEB' }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as Envelope<{ accessToken: string }>;
      if (!response.ok || !envelope.data)
        throw new Error(envelope.error?.message ?? 'Login failed.');
      return envelope.data.accessToken;
    },
    onSuccess: onAuthenticated,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };
  return (
    <form className="login-card" onSubmit={submit}>
      <span className="eyebrow">PROTECTED ADMINISTRATION</span>
      <h2>Administrator sign in</h2>
      <label>
        Email or mobile
        <input
          autoComplete="username"
          onChange={(event) => setIdentifier(event.target.value)}
          value={identifier}
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </label>
      <button disabled={login.isPending} type="submit">
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </button>
      {login.error && <p className="error-text">{login.error.message}</p>}
    </form>
  );
}
