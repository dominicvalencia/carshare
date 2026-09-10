'use client';

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import {
  formatMinorUnits,
  type OwnerAnalyticsPeriod,
  validateCustomRange,
} from './OwnerOverviewDashboard';

interface MoneyValue {
  readonly amountMinor: string;
  readonly currency: string;
}

interface MoneyMetric {
  readonly classification: 'PERIOD' | 'POINT_IN_TIME';
  readonly values: readonly MoneyValue[];
}

interface CountedValue extends MoneyValue {
  readonly count: number;
}

interface CountedMetric {
  readonly classification: 'PERIOD' | 'POINT_IN_TIME';
  readonly values: readonly CountedValue[];
}

type EarningStatus = 'PENDING' | 'HELD' | 'AVAILABLE' | 'PAID' | 'REVERSED';

export interface OwnerRevenueSummary {
  readonly metadata: {
    readonly classification: 'GROUPED_BY_CURRENCY';
    readonly definitionVersion: 'owner-revenue-v1';
    readonly endExclusive: string;
    readonly environment: string;
    readonly generatedAt: string;
    readonly period: OwnerAnalyticsPeriod;
    readonly startInclusive: string;
    readonly syntheticData: boolean;
    readonly timezone: string;
  };
  readonly periodActivity: {
    readonly capturedCollections: {
      readonly additionalCharge: readonly MoneyValue[];
      readonly classification: 'PERIOD';
      readonly rental: readonly MoneyValue[];
      readonly securityDeposit: readonly MoneyValue[];
    };
    readonly rentalGbv: MoneyMetric;
    readonly recognizedCarShareCommission: MoneyMetric;
    readonly ownerEarnings: {
      readonly byStatus: Readonly<Record<EarningStatus, readonly MoneyValue[]>>;
      readonly classification: 'PERIOD';
      readonly total: MoneyMetric;
    };
    readonly completedRefunds: MoneyMetric;
    readonly additionalCharges: {
      readonly classification: 'PERIOD';
      readonly approved: MoneyMetric;
      readonly collected: MoneyMetric;
      readonly refunded: MoneyMetric;
      readonly ownerCompensation: MoneyMetric;
      readonly platformShare: MoneyMetric;
    };
    readonly payouts: {
      readonly classification: 'PERIOD';
      readonly created: CountedMetric;
      readonly approved: CountedMetric;
      readonly submitted: CountedMetric;
      readonly paid: CountedMetric;
      readonly failed: CountedMetric;
      readonly reversed: CountedMetric;
    };
  };
  readonly pointInTime: {
    readonly ownerPayableLiability: MoneyMetric;
    readonly availableForPayout: MoneyMetric;
    readonly earnings: {
      readonly byStatus: Readonly<Record<EarningStatus, readonly MoneyValue[]>>;
      readonly classification: 'POINT_IN_TIME';
    };
    readonly activePayoutAllocations: CountedMetric;
    readonly processingPayouts: CountedMetric;
  };
  readonly integrity: {
    readonly authoritativeTotalsComplete: boolean;
    readonly excludedReconciliationRequiredCount: number;
    readonly financialIntegrityWarning: boolean;
  };
  readonly unavailable: readonly string[];
}

interface PeriodSelection {
  readonly period: OwnerAnalyticsPeriod;
  readonly startDate?: string;
  readonly endDate?: string;
}

const STORAGE_KEY = 'carshare-owner-revenue-period';
const defaultSelection: PeriodSelection = { period: 'THIS_MONTH' };
const statusLabels: Readonly<Record<EarningStatus, string>> = {
  PENDING: 'Pending Earnings',
  HELD: 'Held Earnings',
  AVAILABLE: 'Available Earnings',
  PAID: 'Paid Earnings',
  REVERSED: 'Reversed Earnings',
};

export function OwnerRevenueDashboard({
  requestRevenue,
}: {
  readonly requestRevenue: (path: string) => Promise<OwnerRevenueSummary>;
}) {
  const [selection, setSelection] = useState<PeriodSelection>(loadSelection);
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState(selection.startDate ?? '');
  const [customEnd, setCustomEnd] = useState(selection.endDate ?? '');
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(
    () => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection)),
    [selection],
  );

  const revenue = useQuery({
    queryKey: ['owner-revenue', selection],
    queryFn: () => requestRevenue(buildPath(selection)),
  });

  const choosePreset = (period: Exclude<OwnerAnalyticsPeriod, 'CUSTOM'>) => {
    setCustomOpen(false);
    setCustomError(null);
    setSelection({ period });
  };
  const applyCustom = () => {
    const error = validateCustomRange(customStart, customEnd);
    setCustomError(error);
    if (!error) {
      setSelection({ period: 'CUSTOM', startDate: customStart, endDate: customEnd });
      setCustomOpen(false);
    }
  };

  return (
    <div className="owner-revenue-dashboard">
      <section className="owner-period-bar" aria-label="Revenue reporting period">
        <div>
          <strong>Reporting period</strong>
          <small>Period activity and boundaries come from CarShare reporting.</small>
        </div>
        <div className="period-selector" role="group" aria-label="Select reporting period">
          {(
            [
              ['TODAY', 'Today'],
              ['THIS_WEEK', 'This Week'],
              ['THIS_MONTH', 'This Month'],
            ] as const
          ).map(([period, label]) => (
            <button
              aria-pressed={selection.period === period}
              className={selection.period === period ? 'selected' : 'quiet'}
              key={period}
              onClick={() => choosePreset(period)}
              type="button"
            >
              {label}
            </button>
          ))}
          <button
            aria-expanded={customOpen}
            aria-pressed={selection.period === 'CUSTOM'}
            className={selection.period === 'CUSTOM' ? 'selected' : 'quiet'}
            onClick={() => {
              setCustomError(null);
              setCustomOpen(true);
            }}
            type="button"
          >
            Custom
          </button>
        </div>
      </section>

      {customOpen && (
        <section className="custom-period-panel" aria-label="Custom reporting period">
          <label>
            Start date
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
          </label>
          <label>
            End date
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </label>
          <div className="custom-period-actions">
            <button type="button" onClick={applyCustom}>
              Apply
            </button>
            <button
              className="quiet"
              type="button"
              onClick={() => {
                setCustomOpen(false);
                setCustomError(null);
                setCustomStart(selection.startDate ?? '');
                setCustomEnd(selection.endDate ?? '');
              }}
            >
              Cancel
            </button>
          </div>
          {customError && (
            <p className="field-error" role="alert">
              {customError}
            </p>
          )}
        </section>
      )}

      {revenue.isLoading && <RevenueSkeleton />}
      {revenue.isError && (
        <section className="owner-overview-error" role="alert">
          <strong>Revenue and earnings are temporarily unavailable.</strong>
          <p>No financial totals are shown until authoritative reporting responds.</p>
          <button type="button" onClick={() => void revenue.refetch()}>
            Retry
          </button>
        </section>
      )}
      {revenue.data && <RevenueContent summary={revenue.data} />}
    </div>
  );
}

function RevenueContent({ summary }: { readonly summary: OwnerRevenueSummary }) {
  const { metadata, periodActivity, pointInTime, integrity } = summary;
  return (
    <>
      {metadata.syntheticData && (
        <aside className="synthetic-data-banner" aria-label="Synthetic data warning">
          <strong>{metadata.environment.toUpperCase()} • SYNTHETIC DATA</strong>
          <span>
            Figures shown here are development/test data and do not represent real business
            performance.
          </span>
        </aside>
      )}
      <AsOf metadata={metadata} />

      <RevenueSection eyebrow="MONEY COLLECTED" title="Customer payment activity">
        <div className="revenue-card-grid revenue-primary-grid">
          <MoneyCard
            label="Rental Collections"
            values={periodActivity.capturedCollections.rental}
            empty="No rental payments were collected in this period."
            definition="Captured rental funds paid by renters. This is cash collection, not CarShare revenue."
            helper="Captured renter payments."
          />
          <MoneyCard
            label="Completed Refunds"
            metric={periodActivity.completedRefunds}
            empty="No refunds were completed in this period."
          />
          <MoneyCard
            className="contract-value-card"
            label="Gross Booking Value"
            metric={periodActivity.rentalGbv}
            empty="No captured rental GBV in this period."
            definition="Marketplace contracted value for captured rentals. It is distinct from cash collected and is not reduced by completed refunds."
            helper="Contracted rental value; may differ from collections."
          />
        </div>
        <div className="secondary-financial-row">
          <MoneyCard
            className="secondary-financial-card"
            label="Additional Charge Collections"
            values={periodActivity.capturedCollections.additionalCharge}
            empty="No additional charges were collected in this period."
          />
        </div>
      </RevenueSection>

      <RevenueSection eyebrow="CARSHARE EARNINGS" title="Recognized platform earnings">
        <div className="revenue-card-grid revenue-earnings-grid">
          <MoneyCard
            className="commission-card"
            label="Recognized CarShare Commission"
            metric={periodActivity.recognizedCarShareCommission}
            empty="No commission was recognized in this period."
            definition="Platform commission recognized by CarShare's accounting ledger after recorded reversals. This is not net revenue, net profit, or profit because provider fees, tax, and operating costs are not yet authoritative."
          />
          <MoneyCard
            className="secondary-financial-card"
            label="Additional Charge CarShare Share"
            metric={periodActivity.additionalCharges.platformShare}
            empty="No CarShare share of additional charges was approved in this period."
          />
        </div>
      </RevenueSection>

      <RevenueSection eyebrow="VEHICLE OWNER MONEY" title="Period owner earnings">
        <p className="revenue-section-note">
          These are earnings recorded during the selected period; they are not payout totals.
        </p>
        <div className="owner-earnings-layout">
          <MoneyCard
            className="owner-total-card"
            label="Total Owner Earnings"
            metric={periodActivity.ownerEarnings.total}
            empty="No owner earnings were recorded in this period."
          />
          <MoneyBreakdown
            title="Earnings breakdown"
            rows={(Object.keys(statusLabels) as EarningStatus[]).map((status) => ({
              definition: earningDefinition(status),
              label: statusLabels[status].replace(' Earnings', ''),
              values: periodActivity.ownerEarnings.byStatus[status],
            }))}
          />
        </div>

        <div className="balance-heading">
          <div>
            <span className="eyebrow">CURRENT BALANCES</span>
            <h3>What CarShare owes and what is eligible now</h3>
          </div>
          <span>As of {formatAsOf(metadata.generatedAt)}</span>
        </div>
        <div className="revenue-balance-grid">
          <MoneyCard
            className="balance-card payable-card"
            label="Owner Payable Liability"
            metric={pointInTime.ownerPayableLiability}
            empty="No current owner-payable liability."
            badge="CURRENT BALANCE"
            definition="The accounting liability CarShare currently owes vehicle owners based on posted financial records."
          />
          <MoneyCard
            className="balance-card eligible-card"
            label="Available for Payout"
            metric={pointInTime.availableForPayout}
            empty="No owner earnings currently satisfy all payout-readiness controls."
            badge="CURRENTLY ELIGIBLE"
            definition="The subset of eligible owner earnings that currently satisfies CarShare's payout readiness controls, including holds, claims, disputes, incidents, allocations, and payment reconciliation."
          />
        </div>
      </RevenueSection>

      <RevenueSection eyebrow="PAYOUT ACTIVITY" title="Selected-period payout lifecycle">
        <p className="revenue-section-note">
          Created or allocated payouts are not treated as paid. Current allocations appear
          separately below.
        </p>
        <PayoutBreakdown
          rows={[
            ['Pending Approval', periodActivity.payouts.created],
            ['Approved', periodActivity.payouts.approved],
            ['Processing', periodActivity.payouts.submitted],
            ['Paid', periodActivity.payouts.paid],
            ['Failed', periodActivity.payouts.failed],
            ['Reversed', periodActivity.payouts.reversed],
          ]}
        />
        <div className="revenue-card-grid payout-current-grid">
          <CountedCard
            label="Active Payout Allocations"
            metric={pointInTime.activePayoutAllocations}
            empty="No earnings are currently allocated to an active payout."
            badge="CURRENT"
          />
          <CountedCard
            label="Processing Payouts"
            metric={pointInTime.processingPayouts}
            empty="No payouts are currently processing."
            badge="CURRENT"
          />
        </div>
      </RevenueSection>

      <RevenueSection eyebrow="ADDITIONAL CHARGES" title="Additional-charge activity">
        <MoneyBreakdown
          title="Additional-charge breakdown"
          rows={[
            { label: 'Approved', values: periodActivity.additionalCharges.approved.values },
            { label: 'Collected', values: periodActivity.additionalCharges.collected.values },
            { label: 'Refunded', values: periodActivity.additionalCharges.refunded.values },
            {
              label: 'Owner Compensation',
              values: periodActivity.additionalCharges.ownerCompensation.values,
            },
            {
              label: 'CarShare Share',
              values: periodActivity.additionalCharges.platformShare.values,
            },
          ]}
        />
      </RevenueSection>

      {integrity.financialIntegrityWarning && (
        <aside className="reconciliation-notice" role="status">
          <strong>Financial reconciliation in progress</strong>
          <span>
            Some financial records are excluded from authoritative totals until reconciliation is
            complete.
          </span>
        </aside>
      )}

      <section
        className="admin-card owner-trends-placeholder"
        aria-labelledby="revenue-trends-heading"
      >
        <span className="eyebrow">DETAILED TRENDS</span>
        <h2 id="revenue-trends-heading">Revenue and earnings trends</h2>
        <p>Authoritative trends will appear here after time-series reporting is enabled.</p>
      </section>
    </>
  );
}

function RevenueSection({
  eyebrow,
  title,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const id = `${eyebrow.toLowerCase().replace(/[^a-z]+/gu, '-')}-heading`;
  return (
    <section className="revenue-section" aria-labelledby={id}>
      <div className="owner-section-heading compact">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={id}>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function MoneyCard({
  label,
  metric,
  values: directValues,
  empty,
  definition,
  helper,
  badge,
  className = '',
}: {
  readonly label: string;
  readonly metric?: MoneyMetric;
  readonly values?: readonly MoneyValue[];
  readonly empty: string;
  readonly definition?: string;
  readonly helper?: string;
  readonly badge?: string;
  readonly className?: string;
}) {
  const values = directValues ?? metric?.values ?? [];
  const shown = values.length ? values : [{ currency: 'PHP', amountMinor: '0' }];
  const zero = shown.every((value) => BigInt(value.amountMinor) === 0n);
  return (
    <article className={`owner-kpi-card revenue-money-card ${className}`}>
      <div className="owner-kpi-label">
        <span>{label}</span>
        {definition && <DefinitionHelp text={definition} />}
      </div>
      {helper && <p className="metric-helper">{helper}</p>}
      {badge && <span className="balance-badge">{badge}</span>}
      <div className="currency-value-list">
        {shown.map((value) => (
          <div key={value.currency}>
            <strong className="owner-kpi-value">
              {formatMinorUnits(value.amountMinor, value.currency)}
            </strong>
            {shown.length > 1 && <small className="currency-code">{value.currency}</small>}
          </div>
        ))}
      </div>
      {zero && <small>{empty}</small>}
    </article>
  );
}

function MoneyBreakdown({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly {
    readonly definition?: string | undefined;
    readonly label: string;
    readonly values: readonly MoneyValue[];
  }[];
}) {
  return (
    <section className="compact-breakdown" aria-label={title}>
      <h3>{title}</h3>
      <dl>
        {rows.map((row) => {
          const values = row.values.length ? row.values : [{ currency: 'PHP', amountMinor: '0' }];
          return (
            <div className="breakdown-row" key={row.label}>
              <dt>
                {row.label}
                {row.definition && <DefinitionHelp text={row.definition} />}
              </dt>
              <dd>
                {values.map((value) => (
                  <span key={value.currency}>
                    {formatMinorUnits(value.amountMinor, value.currency)}
                    {values.length > 1 && <small>{value.currency}</small>}
                  </span>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function PayoutBreakdown({
  rows,
}: {
  readonly rows: readonly (readonly [label: string, metric: CountedMetric])[];
}) {
  return (
    <div className="compact-table-wrap">
      <table className="compact-financial-table">
        <caption className="sr-only">Selected-period payout lifecycle amounts and counts</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Amount</th>
            <th scope="col">Payouts</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(([label, metric]) => {
            const values = metric.values.length
              ? metric.values
              : [{ currency: 'PHP', amountMinor: '0', count: 0 }];
            return values.map((value, index) => (
              <tr key={`${label}-${value.currency}`}>
                <th data-label="Status" scope="row">
                  {index === 0 ? label : `${label} (${value.currency})`}
                </th>
                <td data-label="Amount">{formatMinorUnits(value.amountMinor, value.currency)}</td>
                <td data-label="Payouts">
                  {value.count.toLocaleString('en-PH')} {value.count === 1 ? 'payout' : 'payouts'}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

function CountedCard({
  label,
  metric,
  empty,
  badge,
}: {
  readonly label: string;
  readonly metric: CountedMetric;
  readonly empty: string;
  readonly badge?: string;
}) {
  const values = metric.values.length
    ? metric.values
    : [{ currency: 'PHP', amountMinor: '0', count: 0 }];
  const zero = values.every((value) => BigInt(value.amountMinor) === 0n && value.count === 0);
  return (
    <article className="owner-kpi-card payout-card">
      <div className="owner-kpi-label">
        <span>{label}</span>
        {badge && <span className="balance-badge">{badge}</span>}
      </div>
      {values.map((value) => (
        <div className="payout-value" key={value.currency}>
          <strong className="owner-kpi-value">
            {formatMinorUnits(value.amountMinor, value.currency)}
          </strong>
          <span>
            {value.count.toLocaleString('en-PH')} {value.count === 1 ? 'payout' : 'payouts'}
            {values.length > 1 ? ` • ${value.currency}` : ''}
          </span>
        </div>
      ))}
      {zero && <small>{empty}</small>}
    </article>
  );
}

function DefinitionHelp({ text }: { readonly text: string }) {
  return (
    <button
      aria-label={`Definition: ${text}`}
      className="definition-help"
      title={text}
      type="button"
    >
      ?
    </button>
  );
}

function AsOf({ metadata }: { readonly metadata: OwnerRevenueSummary['metadata'] }) {
  return (
    <p className="revenue-period-context">
      <span>
        {periodLabel(metadata.period)} •{' '}
        {formatRange(metadata.startInclusive, metadata.endExclusive)}
      </span>
      <span>Period activity</span>
      <span>{metadata.timezone}</span>
    </p>
  );
}

function RevenueSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="owner-overview-loading">
      <span className="sr-only">Loading authoritative revenue and earnings</span>
      <div className="revenue-card-grid revenue-primary-grid">
        {[0, 1, 2, 3].map((item) => (
          <div className="owner-kpi-card skeleton-card" key={item}>
            <span />
            <strong />
          </div>
        ))}
      </div>
    </section>
  );
}

function earningDefinition(status: EarningStatus): string | undefined {
  if (status === 'PENDING')
    return 'Recorded owner earnings that have not yet reached payout availability.';
  if (status === 'HELD') return 'Owner earnings currently prevented from becoming payout eligible.';
  return undefined;
}

function buildPath(selection: PeriodSelection) {
  const query = new URLSearchParams({ period: selection.period });
  if (selection.period === 'CUSTOM' && selection.startDate && selection.endDate) {
    query.set('startDate', selection.startDate);
    query.set('endDate', selection.endDate);
  }
  return `/admin/owner/revenue?${query.toString()}`;
}

function loadSelection(): PeriodSelection {
  if (typeof window === 'undefined') return defaultSelection;
  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultSelection;
  try {
    const value = JSON.parse(stored) as PeriodSelection;
    if (value.period === 'CUSTOM')
      return value.startDate &&
        value.endDate &&
        !validateCustomRange(value.startDate, value.endDate)
        ? value
        : defaultSelection;
    return ['TODAY', 'THIS_WEEK', 'THIS_MONTH'].includes(value.period) ? value : defaultSelection;
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return defaultSelection;
  }
}

function periodLabel(period: OwnerAnalyticsPeriod) {
  return period === 'TODAY'
    ? 'Today'
    : period === 'THIS_WEEK'
      ? 'This Week'
      : period === 'THIS_MONTH'
        ? 'This Month'
        : 'Custom range';
}

function formatRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(new Date(end).getTime() - 1))}`;
}

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}
