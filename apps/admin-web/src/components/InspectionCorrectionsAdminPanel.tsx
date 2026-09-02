'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
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

export function InspectionCorrectionsAdminPanel({ accessToken }: { readonly accessToken: string }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<CorrectionStatus>('PENDING_REVIEW');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const openFile = async (fileId: string) => {
    const grant = await api<{ contentPath: string }>(`/files/${fileId}/access-grants`, {
      method: 'POST',
    });
    window.open(`${new URL(API_URL).origin}${grant.contentPath}`, '_blank', 'noopener,noreferrer');
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
      {queue.data?.length === 0 && <p>No {statusLabel(status).toLowerCase()} corrections.</p>}
      {queue.data?.map((item) => (
        <button
          className="review-row review-button"
          key={item.id}
          onClick={() => setSelectedId(item.id)}
        >
          <span>
            <strong>
              {item.inspection.booking.publicReference} · {vehicleLabel(item)}
            </strong>
            <span>
              {measurementNames(item)} · {item.inspection.type.toLowerCase()} inspection
            </span>
            <span>
              {personLabel(item.createdBy)} · {new Date(item.createdAt).toLocaleString()}
            </span>
          </span>
          <span className={`status-pill status-${item.status.toLowerCase()}`}>
            {statusLabel(item.status)}
          </span>
        </button>
      ))}
      {detail.isError && <p className="error-text">{detail.error.message}</p>}
      {correction && (
        <div className="vehicle-detail correction-detail">
          <div className="detail-heading">
            <div>
              <span className="eyebrow">INSPECTION CORRECTION REQUEST</span>
              <h3>{correction.inspection.booking.publicReference}</h3>
              <p>
                {vehicleLabel(correction)} · {correction.inspection.type.toLowerCase()} inspection v
                {correction.inspection.version}
              </p>
            </div>
            <button className="quiet" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
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
          <h4>Reason from owner</h4>
          <blockquote>{correction.reason}</blockquote>
          <p>
            Requested {new Date(correction.createdAt).toLocaleString()} by{' '}
            {personLabel(correction.createdBy)}
          </p>
          <h4>Supporting protected evidence</h4>
          <div className="actions">
            {correction.inspection.media.map((media) => (
              <button
                className="quiet"
                key={media.fileAsset.id}
                onClick={() => void openFile(media.fileAsset.id)}
              >
                {media.perspective} · {media.fileAsset.originalName}
              </button>
            ))}
          </div>
          <h4>Related inspection readings</h4>
          {correction.inspection.booking.inspections.map((item) => (
            <p key={item.id}>
              {item.type} v{item.version}: odometer {formatOdometer(item.odometerMeters)} · fuel{' '}
              {formatBasisPoints(item.fuelBasisPoints)} · SOC{' '}
              {formatBasisPoints(item.batterySocBasisPoints)} ·{' '}
              {item.finalizedAt ? new Date(item.finalizedAt).toLocaleString() : 'draft'}
            </p>
          ))}
          <h4>Amendment history</h4>
          {correction.inspection.amendments.map((item) => (
            <p key={item.id}>
              {statusLabel(item.status)} · {new Date(item.createdAt).toLocaleString()} ·{' '}
              {item.reason}
              {item.reviewReason ? ` · Review: ${item.reviewReason}` : ''}
            </p>
          ))}
          <h4>Booking timeline</h4>
          <ol className="history">
            {correction.inspection.booking.statusHistory.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.toStatus}</strong>
                <span>
                  {new Date(entry.occurredAt).toLocaleString()} ·{' '}
                  {entry.reasonCode ?? 'state transition'}
                </span>
              </li>
            ))}
          </ol>
          {correction.status === 'PENDING_REVIEW' ? (
            <>
              <label className="admin-field">
                Decision note/reason
                <textarea
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  placeholder="Explain the evidence and basis for the decision (minimum 10 characters)."
                />
              </label>
              <div className="actions">
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
              </div>
            </>
          ) : (
            <p>
              <strong>{statusLabel(correction.status)}</strong>{' '}
              {correction.reviewedAt ? new Date(correction.reviewedAt).toLocaleString() : ''} by{' '}
              {correction.reviewedBy ? personLabel(correction.reviewedBy) : '—'}
              <br />
              {correction.reviewReason}
            </p>
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
