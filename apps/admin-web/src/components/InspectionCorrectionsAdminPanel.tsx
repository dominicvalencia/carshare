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
  AdminTimeline,
  DataTable,
  EmptyState,
  StatusBadge,
} from './AdminPrimitives';

import { API_URL } from './admin-environment';
type CorrectionStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'LEGACY_RECORDED';
interface Person {
  readonly id: string;
  readonly email?: string | null;
  readonly profile: { readonly displayName: string | null } | null;
}
interface InspectionCorrection {
  readonly id: string;
  readonly status: CorrectionStatus;
  readonly reason: string;
  readonly reviewReason: string | null;
  readonly proposedOdometerMeters: string | null;
  readonly proposedFuelBasisPoints: number | null;
  readonly proposedBatterySocBasisPoints: number | null;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
  readonly createdBy: Person;
  readonly reviewedBy: Person | null;
  readonly inspection: {
    readonly id: string;
    readonly type: string;
    readonly version: number;
    readonly odometerMeters: string | null;
    readonly fuelBasisPoints: number | null;
    readonly batterySocBasisPoints: number | null;
    readonly finalizedAt: string | null;
    readonly media: readonly {
      perspective: string;
      fileAsset: { id: string; originalName: string };
    }[];
    readonly amendments: readonly InspectionCorrection[];
    readonly booking: {
      readonly publicReference: string;
      readonly status: string;
      readonly vehicle: { make: string | null; model: string | null; modelYear: number | null };
      readonly owner: Person;
      readonly renter: Person;
      readonly inspections: readonly {
        id: string;
        type: string;
        version: number;
        odometerMeters: string | null;
        fuelBasisPoints: number | null;
        batterySocBasisPoints: number | null;
        finalizedAt: string | null;
      }[];
      readonly statusHistory: readonly {
        id: string;
        toStatus: string;
        occurredAt: string;
        reasonCode: string | null;
      }[];
    };
  };
}
interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { message: string };
}

export function InspectionCorrectionsAdminPanel({
  accessToken,
  initialSelectedId,
  onUnauthorized,
}: {
  readonly accessToken: string;
  readonly initialSelectedId?: string;
  readonly onUnauthorized: () => void;
}) {
  const client = useQueryClient();
  const [status, setStatus] = useState<CorrectionStatus>('PENDING_REVIEW');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [reviewReason, setReviewReason] = useState('');
  const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
    const envelope = (await response.json()) as Envelope<T>;
    if (response.status === 401) {
      onUnauthorized();
      throw new Error('Your administrative session expired. Sign in again.');
    }
    if (!response.ok || !envelope.success)
      throw new Error(envelope.error?.message ?? 'Request failed.');
    return envelope.data as T;
  };
  const queue = useQuery({
    queryKey: ['admin-inspection-corrections', status],
    queryFn: () =>
      api<InspectionCorrection[]>(`/admin/rentals/inspection-corrections?status=${status}`),
    refetchInterval: status === 'PENDING_REVIEW' ? 10_000 : false,
  });
  const detail = useQuery({
    enabled: Boolean(selectedId),
    queryKey: ['admin-inspection-correction', selectedId],
    queryFn: () => api<InspectionCorrection>(`/admin/rentals/inspection-corrections/${selectedId}`),
  });
  const review = useMutation({
    mutationFn: ({ approved }: { approved: boolean }) =>
      api(`/admin/rentals/inspection-corrections/${selectedId}/review`, {
        body: JSON.stringify({ approved, reason: reviewReason.trim() }),
        method: 'POST',
      }),
    onSuccess: () => {
      setReviewReason('');
      void client.invalidateQueries({ queryKey: ['admin-inspection-corrections'] });
      void client.invalidateQueries({ queryKey: ['admin-inspection-correction', selectedId] });
      void client.invalidateQueries({ queryKey: ['admin-rentals'] });
    },
  });
  const grantFile = async (fileId: string) => {
    const grant = await api<{ contentPath: string; expiresAt: string; mimeType: string }>(
      `/files/${fileId}/access-grants`,
      {
        method: 'POST',
      },
    );
    return {
      url: `${new URL(API_URL).origin}${grant.contentPath}`,
      mimeType: grant.mimeType,
      expiresAt: grant.expiresAt,
    };
  };
  const decide = (approved: boolean) => {
    if (reviewReason.trim().length < 10) return;
    const message = approved
      ? 'Approving this correction will make the proposed value effective for applicable rental validation. The original inspection remains unchanged in audit history.'
      : 'Reject this correction? The original inspection value will remain authoritative.';
    if (window.confirm(message)) review.mutate({ approved });
  };
  const correction = detail.data;
  return (
    <section className="admin-card vehicle-review-card">
      <span className="eyebrow">RENTAL EVIDENCE</span>
      <h2>Inspection corrections</h2>
      <p>
        Review owner-proposed measurement amendments. Submitted inspections and photos remain
        immutable.
      </p>
      <label className="admin-field">
        Status
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as CorrectionStatus);
            setSelectedId(null);
          }}
        >
          <option value="PENDING_REVIEW">Pending review</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      {queue.isLoading && <p>Loading correction queue…</p>}
      {queue.isError && <p className="error-text">{queue.error.message}</p>}
      {queue.data?.length === 0 && (
        <EmptyState
          title={`No ${statusLabel(status).toLowerCase()} corrections`}
          description="No inspection amendment records match the selected review state."
        />
      )}
      {queue.data && queue.data.length > 0 && (
        <DataTable label="Inspection correction queue">
          <thead>
            <tr>
              <th>Booking</th>
              <th>Vehicle</th>
              <th>Inspection</th>
              <th>Requested by</th>
              <th>Created</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {queue.data.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.inspection.booking.publicReference}</strong>
                </td>
                <td>{vehicleLabel(item)}</td>
                <td>
                  {measurementNames(item)}
                  <small>{item.inspection.type.toLowerCase()} inspection</small>
                </td>
                <td>{personLabel(item.createdBy)}</td>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>
                  <StatusBadge value={item.status} />
                </td>
                <td>
                  <Link
                    href={`/admin/operations/inspection-corrections/${item.id}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {detail.isError && <p className="error-text">{detail.error.message}</p>}
      {correction && (
        <div className="detail-page correction-detail">
          <AdminDetailHeader
            backHref="/admin/operations/inspection-corrections"
            backLabel="Inspection correction queue"
            eyebrow="Inspection correction request"
            title={correction.inspection.booking.publicReference}
            status={correction.status}
            description={`${vehicleLabel(correction)} · ${correction.inspection.type.toLowerCase()} inspection v${correction.inspection.version}`}
          />
          <AdminSummaryGrid>
            <AdminSummaryCard
              label="Requested by"
              value={personLabel(correction.createdBy)}
              detail={new Date(correction.createdAt).toLocaleString()}
            />
            <AdminSummaryCard
              label="Inspection"
              value={`${correction.inspection.type} v${correction.inspection.version}`}
              detail={
                correction.inspection.finalizedAt
                  ? `Finalized ${new Date(correction.inspection.finalizedAt).toLocaleString()}`
                  : 'Draft inspection'
              }
            />
            <AdminSummaryCard
              label="Vehicle"
              value={vehicleLabel(correction)}
              detail="Original evidence remains immutable"
            />
          </AdminSummaryGrid>
          <AdminSection
            title="Requested measurement changes"
            description="Approval changes the effective reading only; the submitted inspection remains preserved."
          >
            <div className="correction-comparison">
              {measurements(correction).map((field) => (
                <div className="comparison-field" key={field.label}>
                  <h4>{field.label}</h4>
                  <div>
                    <span>Original recorded value</span>
                    <strong>{field.original}</strong>
                  </div>
                  <div className="proposed-value">
                    <span>Proposed correction</span>
                    <strong>{field.proposed}</strong>
                  </div>
                </div>
              ))}
            </div>
            <AdminDefinitionList items={[{ label: 'Owner reason', value: correction.reason }]} />
          </AdminSection>
          <AdminSection
            title="Supporting protected evidence"
            description="Previewing or opening a file creates a five-minute audited access grant."
          >
            <div className="admin-evidence-grid">
              {correction.inspection.media.map((media) => (
                <AdminEvidenceCard
                  key={media.fileAsset.id}
                  displayMode="photo"
                  label={`${media.perspective} · ${media.fileAsset.originalName}`}
                  note="Original inspection evidence"
                  requestAccess={() => grantFile(media.fileAsset.id)}
                />
              ))}
            </div>
            {correction.inspection.media.length === 0 && (
              <EmptyState
                title="No supporting media"
                description="This request relies on the recorded measurements and owner explanation."
              />
            )}
          </AdminSection>
          <AdminSection title="Review history">
            <AdminTimeline
              events={[
                ...correction.inspection.booking.statusHistory.map((entry) => ({
                  id: entry.id,
                  title: entry.toStatus,
                  occurredAt: entry.occurredAt,
                  detail: entry.reasonCode ?? 'Booking state transition',
                })),
                ...correction.inspection.amendments.map((item) => ({
                  id: item.id,
                  title: statusLabel(item.status),
                  occurredAt: item.reviewedAt ?? item.createdAt,
                  detail: item.reviewReason ?? item.reason,
                })),
              ]}
            />
          </AdminSection>
          {correction.status === 'PENDING_REVIEW' ? (
            <AdminActionBar
              title="Correction decision"
              description="A decision note of at least 10 characters is required. Original evidence is never overwritten."
            >
              <label className="admin-field">
                Decision note/reason
                <textarea
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  placeholder="Explain the evidence and basis for the decision (minimum 10 characters)."
                />
              </label>
              <button
                disabled={review.isPending || reviewReason.trim().length < 10}
                onClick={() => decide(true)}
              >
                Approve correction
              </button>
              <button
                className="danger"
                disabled={review.isPending || reviewReason.trim().length < 10}
                onClick={() => decide(false)}
              >
                Reject correction
              </button>
            </AdminActionBar>
          ) : (
            <AdminSection title="Recorded decision">
              <AdminDefinitionList
                items={[
                  { label: 'Outcome', value: <StatusBadge value={correction.status} /> },
                  {
                    label: 'Reviewed',
                    value: correction.reviewedAt
                      ? new Date(correction.reviewedAt).toLocaleString()
                      : 'Not recorded',
                  },
                  {
                    label: 'Reviewer',
                    value: correction.reviewedBy
                      ? personLabel(correction.reviewedBy)
                      : 'Not recorded',
                  },
                  { label: 'Reason', value: correction.reviewReason ?? 'Not recorded' },
                ]}
              />
            </AdminSection>
          )}
          {review.isError && <p className="error-text">{review.error.message}</p>}
        </div>
      )}
    </section>
  );
}

function personLabel(person: Person) {
  return person.profile?.displayName ?? person.email ?? person.id;
}
function vehicleLabel(item: InspectionCorrection) {
  const vehicle = item.inspection.booking.vehicle;
  return `${vehicle.modelYear ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? 'Vehicle'}`.trim();
}
function statusLabel(status: CorrectionStatus) {
  return {
    PENDING_REVIEW: 'Pending review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    LEGACY_RECORDED: 'Historical record',
  }[status];
}
function formatOdometer(value: string | null) {
  return value ? `${(Number(value) / 1000).toLocaleString()} km` : 'Not recorded';
}
function formatBasisPoints(value: number | null) {
  return value === null ? 'Not recorded' : `${value / 100}%`;
}
function measurements(item: InspectionCorrection) {
  return [
    item.proposedOdometerMeters !== null
      ? {
          label: `${item.inspection.type === 'PICKUP' ? 'Pickup' : 'Return'} odometer`,
          original: formatOdometer(item.inspection.odometerMeters),
          proposed: formatOdometer(item.proposedOdometerMeters),
        }
      : null,
    item.proposedFuelBasisPoints !== null
      ? {
          label: 'Fuel level',
          original: formatBasisPoints(item.inspection.fuelBasisPoints),
          proposed: formatBasisPoints(item.proposedFuelBasisPoints),
        }
      : null,
    item.proposedBatterySocBasisPoints !== null
      ? {
          label: 'EV battery SOC',
          original: formatBasisPoints(item.inspection.batterySocBasisPoints),
          proposed: formatBasisPoints(item.proposedBatterySocBasisPoints),
        }
      : null,
  ].filter((value): value is { label: string; original: string; proposed: string } =>
    Boolean(value),
  );
}
function measurementNames(item: InspectionCorrection) {
  return measurements(item)
    .map(({ label }) => label)
    .join(', ');
}
