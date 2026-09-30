'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import {
  AdminDefinitionList,
  AdminDetailHeader,
  AdminSection,
  AdminSummaryCard,
  AdminSummaryGrid,
  AdminTechnicalDetails,
  AdminTimeline,
  DataTable,
  EmptyState,
  StatusBadge,
} from './AdminPrimitives';
import { adminLabel, formatDate, formatMoney } from './admin-presentation';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
interface Person {
  readonly email: string | null;
  readonly id: string;
  readonly profile: {
    readonly displayName: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
  } | null;
}
interface AmendmentListItem {
  readonly acceptedAt: string | null;
  readonly booking: {
    readonly owner: Person;
    readonly publicReference: string;
    readonly renter: Person;
    readonly status: string;
    readonly vehicle: {
      readonly id: string;
      readonly make: string | null;
      readonly model: string | null;
      readonly modelYear: number | null;
    };
  };
  readonly createdAt: string;
  readonly id: string;
  readonly operationallyExpiredAt: string | null;
  readonly scope: string;
  readonly settlement: {
    readonly direction: string;
    readonly reconciliationRequired: boolean;
    readonly status: string;
  } | null;
  readonly status: string;
}
interface AmendmentPage {
  readonly items: readonly AmendmentListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}
interface MoneySnapshot {
  readonly currency: string;
  readonly currentCommissionMinor: string;
  readonly currentOwnerEarningsMinor: string;
  readonly currentTotalMinor: string;
  readonly ownerEarningsDeltaMinor: string;
  readonly policyVersion?: string;
  readonly proposedCommissionMinor: string;
  readonly proposedOwnerEarningsMinor: string;
  readonly proposedTotalMinor: string;
  readonly renterFinancialDeltaMinor: string;
  readonly pricingEngineVersion: string;
}
interface PaymentRecord {
  readonly amountMinor: string;
  readonly capturedAmountMinor: string;
  readonly currency: string;
  readonly externalPaymentId: string | null;
  readonly id: string;
  readonly purpose: string;
  readonly provider: string;
  readonly reconciliationRequired: boolean;
  readonly reconcileAfter: string | null;
  readonly status: string;
  readonly unknownExpiresAt: string | null;
}
interface RefundRecord {
  readonly amountMinor: string;
  readonly completedAt: string | null;
  readonly currency: string;
  readonly externalRefundId: string | null;
  readonly id: string;
  readonly payment: PaymentRecord;
  readonly status: string;
}
interface AmendmentDetail {
  readonly additionalPayment: PaymentRecord | null;
  readonly amendment: AmendmentListItem & {
    readonly appliedAt: string | null;
    readonly declinedAt: string | null;
    readonly expiredAt: string | null;
    readonly failureCode: string | null;
    readonly paymentDeadlineAt: string | null;
    readonly proposedRentalEnd: string;
    readonly proposedRentalStart: string;
    readonly proposedStartMethod: string;
    readonly proposedEndMethod: string;
    readonly policyVersion: string;
    readonly booking: AmendmentListItem['booking'] & {
      readonly cancellationSettlement: {
        readonly amendmentRefundObligationOffsetMinor: string;
        readonly currency: string;
      } | null;
      readonly fulfillmentSnapshot: {
        readonly startMethod: string;
        readonly endMethod: string;
        readonly destinationSnapshot: unknown;
      } | null;
      readonly ownerEarning: {
        readonly adjustmentAmountMinor: string;
        readonly currency: string;
        readonly netEarningAmountMinor: string;
        readonly status: string;
        readonly holds: readonly {
          readonly id: string;
          readonly reason: string;
          readonly status: string;
        }[];
        readonly payoutItems: readonly {
          readonly payout: { readonly publicReference: string; readonly status: string };
        }[];
      } | null;
      readonly pricingSnapshot: { readonly currency: string; readonly totalMinor: string } | null;
      readonly rentalStart: string;
      readonly rentalEnd: string;
    };
    readonly fulfillmentSnapshot: {
      readonly currentEndMethod: string;
      readonly currentStartMethod: string;
      readonly destinationSnapshot: unknown;
      readonly proposedEndMethod: string;
      readonly proposedStartMethod: string;
    } | null;
    readonly holds: readonly {
      readonly id: string;
      readonly protectedStart: string;
      readonly protectedEnd: string;
      readonly releaseReason: string | null;
      readonly status: string;
    }[];
    readonly pricingSnapshot: MoneySnapshot | null;
    readonly settlement: {
      readonly id: string;
      readonly status: string;
      readonly direction: string;
      readonly currency: string;
      readonly financialDeltaMinor: string;
      readonly reconciliationRequired: boolean;
      readonly refund: RefundRecord | null;
      readonly refundResolutionEvidence: readonly {
        readonly createdAt: string;
        readonly evidenceAt: string;
        readonly evidenceType: string;
        readonly externalReference: string;
        readonly id: string;
        readonly outcome: string;
        readonly resolutionNote: string;
      }[];
    } | null;
    readonly statusHistory: readonly {
      readonly actorType: string;
      readonly id: string;
      readonly occurredAt: string;
      readonly reasonCode: string | null;
      readonly toStatus: string;
    }[];
  };
  readonly ledger: readonly {
    readonly description: string;
    readonly entries: readonly {
      readonly account: { readonly code: string; readonly name: string };
      readonly amountMinor: string;
      readonly id: string;
    }[];
    readonly id: string;
    readonly postedAt: string;
    readonly type: string;
  }[];
  readonly manualResolutionEligible: boolean;
}

const statuses = [
  '',
  'PENDING_OWNER',
  'OWNER_ACCEPTED_PAYMENT_PENDING',
  'OWNER_ACCEPTED_PROCESSING',
  'FINANCIAL_RECOVERY_PENDING',
  'APPLIED',
  'DECLINED',
  'WITHDRAWN',
  'EXPIRED',
  'FAILED',
];
const directions = ['', 'NONE', 'ADDITIONAL_PAYMENT', 'REFUND'];
const scopes = ['', 'PRE_TRIP', 'ACTIVE_EXTENSION'];
const bookingStatuses = [
  '',
  'PAYMENT_PENDING',
  'PENDING_OWNER',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
  'CANCELLED',
];
const personName = (person: Person) =>
  (person.profile?.displayName ??
    [person.profile?.firstName, person.profile?.lastName].filter(Boolean).join(' ')) ||
  person.email ||
  person.id;
const money = (minor?: string | null, currency = 'PHP') =>
  `${formatMoney(minor === undefined || minor === null ? undefined : Number(minor))}${currency === 'PHP' ? '' : ` ${currency}`}`;
const directionLabel = (value?: string | null) =>
  value === 'NONE' ? 'Zero delta' : value ? adminLabel(value) : 'Not calculated';

export function BookingAmendmentsAdminPanel({
  can,
  detailId,
  request,
}: {
  readonly can: (permission: string) => boolean;
  readonly detailId?: string;
  readonly request: Request;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [scope, setScope] = useState('');
  const [bookingStatus, setBookingStatus] = useState('');
  const [reconciliation, setReconciliation] = useState('');
  const [page, setPage] = useState(1);
  const parameters = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (query) parameters.set('query', query);
  if (status) parameters.set('status', status);
  if (direction) parameters.set('direction', direction);
  if (scope) parameters.set('scope', scope);
  if (bookingStatus) parameters.set('bookingStatus', bookingStatus);
  if (reconciliation) parameters.set('reconciliationRequired', reconciliation);
  const list = useQuery({
    queryKey: [
      'admin-booking-amendments',
      query,
      status,
      direction,
      scope,
      bookingStatus,
      reconciliation,
      page,
    ],
    queryFn: () => request<AmendmentPage>(`/admin/bookings/amendments?${parameters}`),
    enabled: !detailId,
  });
  const detail = useQuery({
    queryKey: ['admin-booking-amendment', detailId],
    queryFn: () => request<AmendmentDetail>(`/admin/bookings/amendments/${detailId}`),
    enabled: Boolean(detailId),
  });

  if (detailId)
    return (
      <AmendmentDetailView
        can={can}
        data={detail.data}
        error={detail.error}
        loading={detail.isLoading}
        onRefresh={() =>
          void client.invalidateQueries({ queryKey: ['admin-booking-amendment', detailId] })
        }
        request={request}
      />
    );
  return (
    <section className="admin-card module-section module-booking-amendments">
      <div className="filter-grid" aria-label="Change Booking filters">
        <label>
          Search
          <input
            aria-label="Search amendments"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Booking, amendment, renter, Owner, vehicle"
            value={query}
          />
        </label>
        <label>
          Status
          <select
            aria-label="Amendment status"
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            value={status}
          >
            {statuses.map((value) => (
              <option key={value} value={value}>
                {value ? adminLabel(value) : 'All statuses'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Financial direction
          <select
            aria-label="Financial direction"
            onChange={(event) => {
              setDirection(event.target.value);
              setPage(1);
            }}
            value={direction}
          >
            {directions.map((value) => (
              <option key={value} value={value}>
                {value ? directionLabel(value) : 'All directions'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <select
            aria-label="Amendment scope"
            onChange={(event) => {
              setScope(event.target.value);
              setPage(1);
            }}
            value={scope}
          >
            {scopes.map((value) => (
              <option key={value} value={value}>
                {value ? adminLabel(value) : 'All scopes'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Booking lifecycle
          <select
            aria-label="Booking lifecycle"
            onChange={(event) => {
              setBookingStatus(event.target.value);
              setPage(1);
            }}
            value={bookingStatus}
          >
            {bookingStatuses.map((value) => (
              <option key={value} value={value}>
                {value ? adminLabel(value) : 'All booking states'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reconciliation
          <select
            aria-label="Reconciliation required"
            onChange={(event) => {
              setReconciliation(event.target.value);
              setPage(1);
            }}
            value={reconciliation}
          >
            <option value="">All</option>
            <option value="true">Manual attention</option>
            <option value="false">No manual attention</option>
          </select>
        </label>
      </div>
      {list.isLoading && <p>Loading Change Booking amendments…</p>}
      {list.error && (
        <EmptyState title="Amendments could not be loaded" description={list.error.message} />
      )}
      {list.data?.items.length === 0 && (
        <EmptyState
          title="No amendments found"
          description="Adjust the search or operational filters."
        />
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <DataTable label="Change Booking amendments">
            <thead>
              <tr>
                <th>Amendment</th>
                <th>Booking</th>
                <th>People / vehicle</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Financial</th>
                <th>Submitted</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.id.slice(0, 8)}</strong>
                    {item.operationallyExpiredAt && <small> Operationally closed</small>}
                  </td>
                  <td>
                    <Link href={`/admin/bookings/${item.booking.publicReference}`}>
                      {item.booking.publicReference}
                    </Link>
                    <br />
                    <StatusBadge value={item.booking.status} />
                  </td>
                  <td>
                    {personName(item.booking.renter)} → {personName(item.booking.owner)}
                    <br />
                    {item.booking.vehicle.make} {item.booking.vehicle.model}
                  </td>
                  <td>{adminLabel(item.scope)}</td>
                  <td>
                    <StatusBadge value={item.status} />
                  </td>
                  <td>
                    {directionLabel(item.settlement?.direction)}
                    {item.settlement?.reconciliationRequired && (
                      <>
                        <br />
                        <StatusBadge value="RECONCILIATION_REQUIRED" />
                      </>
                    )}
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <Link href={`/admin/booking-amendments/${item.id}`}>Open detail</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <nav aria-label="Amendment pagination" className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>
              Page {list.data.page} of {list.data.totalPages} · {list.data.total} total
            </span>
            <button
              disabled={page >= list.data.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

function AmendmentDetailView({
  can,
  data,
  error,
  loading,
  onRefresh,
  request,
}: {
  readonly can: (permission: string) => boolean;
  readonly data: AmendmentDetail | undefined;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly request: Request;
}) {
  if (loading) return <p>Loading authoritative amendment detail…</p>;
  if (error)
    return <EmptyState title="Amendment could not be loaded" description={error.message} />;
  if (!data) return null;
  const { amendment } = data;
  const snapshot = amendment.pricingSnapshot;
  const refund = amendment.settlement?.refund;
  const recovery = amendment.status === 'FINANCIAL_RECOVERY_PENDING';
  return (
    <div className="detail-page">
      <AdminDetailHeader
        backHref="/admin/booking-amendments"
        backLabel="Change Booking queue"
        eyebrow="CHANGE BOOKING"
        title={amendment.id}
        status={amendment.status}
        description={
          <>
            <Link href={`/admin/bookings/${amendment.booking.publicReference}`}>
              {amendment.booking.publicReference}
            </Link>{' '}
            · {personName(amendment.booking.renter)} → {personName(amendment.booking.owner)} ·{' '}
            {amendment.booking.vehicle.make} {amendment.booking.vehicle.model}
          </>
        }
      />
      {recovery && (
        <AdminSection className="warning-panel" title="Operationally closed — financial recovery">
          <p>
            The amendment can no longer apply. The original/current booking remains authoritative,
            its hold is released, and the refund obligation survives.
          </p>
          <AdminDefinitionList
            items={[
              {
                label: 'Recovery reason',
                value: amendment.failureCode
                  ? adminLabel(amendment.failureCode)
                  : 'Financial recovery required',
              },
              {
                label: 'Operationally expired',
                value: formatDate(amendment.operationallyExpiredAt),
              },
              {
                label: 'Refund status',
                value: refund ? adminLabel(refund.status) : 'Refund not created',
              },
            ]}
          />
        </AdminSection>
      )}
      <AdminSection title="Lifecycle summary">
        <AdminSummaryGrid>
          <AdminSummaryCard
            label="Scope"
            value={adminLabel(amendment.scope)}
            detail={
              amendment.scope === 'ACTIVE_EXTENSION'
                ? 'Original return remains authoritative until APPLIED.'
                : 'Pre-trip booking change'
            }
          />
          <AdminSummaryCard
            label="Financial direction"
            value={directionLabel(amendment.settlement?.direction)}
          />
          <AdminSummaryCard label="Submitted" value={formatDate(amendment.createdAt)} />
          <AdminSummaryCard label="Accepted" value={formatDate(amendment.acceptedAt)} />
          <AdminSummaryCard label="Applied" value={formatDate(amendment.appliedAt)} />
          <AdminSummaryCard label="Policy evidence" value={amendment.policyVersion} />
        </AdminSummaryGrid>
      </AdminSection>
      <AdminSection
        title="Current vs proposed"
        description="Backend-authoritative booking state and immutable accepted proposal."
      >
        <div className="comparison-grid">
          <article className="compact-panel">
            <h4>Current</h4>
            <AdminDefinitionList
              items={[
                { label: 'Start', value: formatDate(amendment.booking.rentalStart) },
                { label: 'End', value: formatDate(amendment.booking.rentalEnd) },
                {
                  label: 'Start method',
                  value: adminLabel(
                    amendment.fulfillmentSnapshot?.currentStartMethod ??
                      amendment.booking.fulfillmentSnapshot?.startMethod,
                  ),
                },
                {
                  label: 'End method',
                  value: adminLabel(
                    amendment.fulfillmentSnapshot?.currentEndMethod ??
                      amendment.booking.fulfillmentSnapshot?.endMethod,
                  ),
                },
                {
                  label: 'Accepted total',
                  value: money(
                    snapshot?.currentTotalMinor ?? amendment.booking.pricingSnapshot?.totalMinor,
                    snapshot?.currency ?? amendment.booking.pricingSnapshot?.currency,
                  ),
                },
              ]}
            />
          </article>
          <article className="compact-panel">
            <h4>Proposed</h4>
            <AdminDefinitionList
              items={[
                { label: 'Start', value: formatDate(amendment.proposedRentalStart) },
                { label: 'End', value: formatDate(amendment.proposedRentalEnd) },
                { label: 'Start method', value: adminLabel(amendment.proposedStartMethod) },
                { label: 'End method', value: adminLabel(amendment.proposedEndMethod) },
                {
                  label: 'Destination evidence',
                  value: amendment.fulfillmentSnapshot
                    ? JSON.stringify(amendment.fulfillmentSnapshot.destinationSnapshot)
                    : 'Unchanged',
                },
                {
                  label: 'Proposed total',
                  value: money(snapshot?.proposedTotalMinor, snapshot?.currency),
                },
              ]}
            />
          </article>
        </div>
      </AdminSection>
      {snapshot && (
        <AdminSection
          title="Immutable financial snapshot"
          description="Historical accepted evidence; proposed values are not current until the amendment is APPLIED."
        >
          <AdminDefinitionList
            items={[
              {
                label: 'Renter financial delta',
                value: money(snapshot.renterFinancialDeltaMinor, snapshot.currency),
              },
              {
                label: 'Commission current → proposed',
                value: `${money(snapshot.currentCommissionMinor, snapshot.currency)} → ${money(snapshot.proposedCommissionMinor, snapshot.currency)}`,
              },
              {
                label: 'Owner earnings current → proposed',
                value: `${money(snapshot.currentOwnerEarningsMinor, snapshot.currency)} → ${money(snapshot.proposedOwnerEarningsMinor, snapshot.currency)}`,
              },
              {
                label: 'Owner earnings delta',
                value: money(snapshot.ownerEarningsDeltaMinor, snapshot.currency),
              },
              { label: 'Pricing engine', value: snapshot.pricingEngineVersion },
            ]}
          />
        </AdminSection>
      )}
      <AdminSection title="Payment, refund, and settlement">
        <AdminDefinitionList
          items={[
            {
              label: 'Settlement',
              value: amendment.settlement
                ? adminLabel(amendment.settlement.status)
                : 'No provider movement',
            },
            {
              label: 'Reconciliation',
              value: amendment.settlement?.reconciliationRequired ? 'Required' : 'Not required',
            },
            { label: 'Payment deadline', value: formatDate(amendment.paymentDeadlineAt) },
            {
              label: 'Additional Payment',
              value: data.additionalPayment
                ? `${data.additionalPayment.id} · ${money(data.additionalPayment.amountMinor, data.additionalPayment.currency)} · ${adminLabel(data.additionalPayment.status)}`
                : 'None',
            },
            {
              label: 'Payment provider reference',
              value: data.additionalPayment?.externalPaymentId ?? 'None',
            },
            {
              label: 'Refund',
              value: refund
                ? `${refund.id} · ${money(refund.amountMinor, refund.currency)} · ${adminLabel(refund.status)}`
                : 'None',
            },
            { label: 'Refund source Payment', value: refund?.payment.id ?? 'None' },
            {
              label: 'Provider uncertainty',
              value: data.additionalPayment?.reconciliationRequired
                ? `Reconcile ${formatDate(data.additionalPayment.reconcileAfter)} · grace ends ${formatDate(data.additionalPayment.unknownExpiresAt)}`
                : refund?.payment.reconciliationRequired
                  ? 'Refund verification pending'
                  : 'None',
            },
          ]}
        />
      </AdminSection>
      <AdminSection
        title="Accounting and payout visibility"
        description="Read-only correlated authority; balances are not calculated by this page."
      >
        <AdminDefinitionList
          items={[
            {
              label: 'Current Owner earning',
              value: amendment.booking.ownerEarning
                ? `${money(amendment.booking.ownerEarning.netEarningAmountMinor, amendment.booking.ownerEarning.currency)} · ${adminLabel(amendment.booking.ownerEarning.status)}`
                : 'Unavailable',
            },
            {
              label: 'Applied adjustment',
              value: amendment.booking.ownerEarning
                ? money(
                    amendment.booking.ownerEarning.adjustmentAmountMinor,
                    amendment.booking.ownerEarning.currency,
                  )
                : 'Unavailable',
            },
            {
              label: 'Payout',
              value: amendment.booking.ownerEarning?.payoutItems.length
                ? amendment.booking.ownerEarning.payoutItems
                    .map(
                      (item) =>
                        `${item.payout.publicReference} (${adminLabel(item.payout.status)})`,
                    )
                    .join(', ')
                : recovery || amendment.settlement?.reconciliationRequired
                  ? 'Blocked by unresolved amendment recovery'
                  : 'Not yet attached',
            },
            {
              label: 'Cancellation amendment-refund obligation offset',
              value: amendment.booking.cancellationSettlement
                ? `${money(amendment.booking.cancellationSettlement.amendmentRefundObligationOffsetMinor, amendment.booking.cancellationSettlement.currency)} reserved for the surviving amendment refund obligation`
                : 'No cancellation offset',
            },
          ]}
        />
        {data.ledger.length === 0 ? (
          <p>No correlated amendment ledger entries.</p>
        ) : (
          <DataTable label="Correlated amendment accounting">
            <thead>
              <tr>
                <th>Event</th>
                <th>Posted</th>
                <th>Account</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.flatMap((entry) =>
                entry.entries.map((line) => (
                  <tr key={line.id}>
                    <td>{adminLabel(entry.type)}</td>
                    <td>{formatDate(entry.postedAt)}</td>
                    <td>
                      {line.account.code} · {line.account.name}
                    </td>
                    <td>{line.amountMinor}</td>
                  </tr>
                )),
              )}
            </tbody>
          </DataTable>
        )}
      </AdminSection>
      <AdminSection title="Lifecycle history">
        <AdminTimeline
          events={amendment.statusHistory.map((entry) => ({
            id: entry.id,
            title: adminLabel(entry.toStatus),
            occurredAt: entry.occurredAt,
            detail: `${adminLabel(entry.actorType)}${entry.reasonCode ? ` · ${adminLabel(entry.reasonCode)}` : ''}`,
          }))}
        />
        {amendment.settlement?.refundResolutionEvidence.length ? (
          <AdminTechnicalDetails
            summary={`Manual refund evidence (${amendment.settlement.refundResolutionEvidence.length})`}
          >
            <AdminTimeline
              events={amendment.settlement.refundResolutionEvidence.map((entry) => ({
                id: entry.id,
                title: adminLabel(entry.outcome),
                occurredAt: entry.evidenceAt,
                detail: `${adminLabel(entry.evidenceType)} · ${entry.externalReference} · ${entry.resolutionNote}`,
              }))}
            />
          </AdminTechnicalDetails>
        ) : null}
      </AdminSection>
      {data.manualResolutionEligible &&
        amendment.settlement &&
        refund &&
        can('refunds.approve') && (
          <ManualResolutionForm
            amendment={amendment}
            onRefresh={onRefresh}
            refund={refund}
            request={request}
            settlementId={amendment.settlement.id}
          />
        )}
      {data.manualResolutionEligible && !can('refunds.approve') && (
        <AdminSection title="Manual reconciliation">
          <p>Finance authorization is required. This case remains read-only for your role.</p>
        </AdminSection>
      )}
    </div>
  );
}

function ManualResolutionForm({
  amendment,
  onRefresh,
  refund,
  request,
  settlementId,
}: {
  readonly amendment: AmendmentDetail['amendment'];
  readonly onRefresh: () => void;
  readonly refund: RefundRecord;
  readonly request: Request;
  readonly settlementId: string;
}) {
  const [outcome, setOutcome] = useState('UNRESOLVED');
  const [provider, setProvider] = useState(refund.payment.provider);
  const [externalReference, setExternalReference] = useState(refund.externalRefundId ?? '');
  const [evidenceType, setEvidenceType] = useState('MANUAL_REVIEW');
  const [evidenceAt, setEvidenceAt] = useState(new Date().toISOString().slice(0, 16));
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(`admin-refund-${refund.id}`);
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      request(`/admin/finance/amendment-refunds/${settlementId}/manual-resolution`, {
        method: 'POST',
        body: JSON.stringify({
          amendmentId: amendment.id,
          refundId: refund.id,
          originalPaymentId: refund.payment.id,
          provider,
          externalReference,
          evidenceType,
          evidenceAt: new Date(evidenceAt).toISOString(),
          resolvedAmountMinor: refund.amountMinor,
          currency: refund.currency,
          outcome,
          resolutionNote: note,
          idempotencyKey,
        }),
      }),
    onSuccess: () => {
      setConfirming(false);
      onRefresh();
    },
    onError: onRefresh,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (outcome === 'SUCCEEDED' && !confirming) {
      setConfirming(true);
      return;
    }
    mutation.mutate();
  };
  return (
    <AdminSection
      title="Manual refund reconciliation"
      description="Records structured provider evidence through the existing finance-authorized operation."
    >
      <form className="admin-form" onSubmit={submit}>
        <label>
          Outcome
          <select
            onChange={(event) => {
              setOutcome(event.target.value);
              setConfirming(false);
            }}
            value={outcome}
          >
            <option value="SUCCEEDED">Succeeded</option>
            <option value="DEFINITIVE_FAILURE">Definitive failure</option>
            <option value="UNRESOLVED">Unresolved — keep reconciliation open</option>
          </select>
        </label>
        <label>
          Provider
          <input onChange={(event) => setProvider(event.target.value)} required value={provider} />
        </label>
        <label>
          External reference
          <input
            onChange={(event) => setExternalReference(event.target.value)}
            required
            value={externalReference}
          />
        </label>
        <label>
          Evidence type
          <select onChange={(event) => setEvidenceType(event.target.value)} value={evidenceType}>
            <option value="PROVIDER_RESPONSE">Provider response</option>
            <option value="PROVIDER_SUPPORT_CONFIRMATION">Provider support confirmation</option>
            <option value="PROVIDER_SETTLEMENT_EXPORT">Provider settlement export</option>
            <option value="MANUAL_REVIEW">Manual review</option>
          </select>
        </label>
        <label>
          Evidence timestamp
          <input
            onChange={(event) => setEvidenceAt(event.target.value)}
            required
            type="datetime-local"
            value={evidenceAt}
          />
        </label>
        <label>
          Amount
          <input disabled value={`${refund.amountMinor} ${refund.currency}`} />
        </label>
        <label>
          Note / reason
          <textarea
            minLength={3}
            onChange={(event) => setNote(event.target.value)}
            required
            value={note}
          />
        </label>
        <label>
          Evidence identity
          <input
            minLength={8}
            onChange={(event) => setIdempotencyKey(event.target.value)}
            required
            value={idempotencyKey}
          />
        </label>
        {confirming && (
          <div className="warning-panel" role="alert">
            <strong>Confirm authoritative refund success</strong>
            <p>
              Refund {refund.id}, {money(refund.amountMinor, refund.currency)}, source Payment{' '}
              {refund.payment.id}, booking {amendment.booking.publicReference}, amendment{' '}
              {amendment.id}. This records authoritative financial evidence.
            </p>
          </div>
        )}
        <button disabled={mutation.isPending} type="submit">
          {mutation.isPending
            ? 'Recording…'
            : confirming
              ? 'Confirm successful refund'
              : 'Record evidence'}
        </button>
        {mutation.error && (
          <p className="error-text">
            {mutation.error.message} Refreshing server truth is recommended.
          </p>
        )}
        {mutation.isSuccess && (
          <p className="success-text">Evidence recorded. Authoritative state refreshed.</p>
        )}
      </form>
    </AdminSection>
  );
}
