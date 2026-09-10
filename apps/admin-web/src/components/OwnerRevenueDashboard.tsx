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

type TrendMetric =
  | 'rentalCollections'
  | 'grossBookingValue'
  | 'recognizedCommission'
  | 'ownerEarnings'
  | 'completedRefunds'
  | 'paidPayouts';
type TrendPoint = {
  readonly startInclusive: string;
  readonly endExclusive: string;
  readonly valueMinor: string;
};
export interface OwnerRevenueTrends {
  readonly definitionVersion: 'owner-revenue-trends-v1';
  readonly environment: string;
  readonly syntheticData: boolean;
  readonly timezone: string;
  readonly period: OwnerAnalyticsPeriod;
  readonly startInclusive: string;
  readonly endExclusive: string;
  readonly granularity: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  readonly generatedAt: string;
  readonly currencies: readonly {
    readonly currency: string;
    readonly series: Readonly<Record<TrendMetric, readonly TrendPoint[]>>;
  }[];
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
  requestTrends,
}: {
  readonly requestRevenue: (path: string) => Promise<OwnerRevenueSummary>;
  readonly requestTrends: (path: string) => Promise<OwnerRevenueTrends>;
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
  const trends = useQuery({
    queryKey: ['owner-revenue-trends', selection],
    queryFn: () => requestTrends(buildTrendsPath(selection)),
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
      {revenue.data && <RevenueContent summary={revenue.data} trends={trends} />}
    </div>
  );
}

function RevenueContent({
  summary,
  trends,
}: {
  readonly summary: OwnerRevenueSummary;
  readonly trends: {
    readonly data: OwnerRevenueTrends | undefined;
    readonly isError: boolean;
    readonly isLoading: boolean;
    readonly refetch: () => unknown;
  };
}) {
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

      <RevenueTrendsPanel trends={trends} />
    </>
  );
}

const trendMetricLabels: Readonly<Record<TrendMetric, string>> = {
  rentalCollections: 'Rental Collections',
  grossBookingValue: 'Gross Booking Value',
  recognizedCommission: 'CarShare Commission',
  ownerEarnings: 'Owner Earnings',
  completedRefunds: 'Completed Refunds',
  paidPayouts: 'Paid Payouts',
};
const trendMetrics = Object.keys(trendMetricLabels) as TrendMetric[];
const trendColors: Readonly<Record<TrendMetric, string>> = {
  rentalCollections: '#08785d',
  grossBookingValue: '#345995',
  recognizedCommission: '#d17b0f',
  ownerEarnings: '#7b4ea3',
  completedRefunds: '#b44747',
  paidPayouts: '#24748f',
};

function RevenueTrendsPanel({
  trends,
}: {
  readonly trends: {
    readonly data: OwnerRevenueTrends | undefined;
    readonly isError: boolean;
    readonly isLoading: boolean;
    readonly refetch: () => unknown;
  };
}) {
  const [selected, setSelected] = useState<readonly TrendMetric[]>([
    'rentalCollections',
    'recognizedCommission',
  ]);
  const [currency, setCurrency] = useState<string>('');
  const data = trends.data;
  const available = data?.currencies ?? [];
  const selectedCurrency = available.find((item) => item.currency === currency) ?? available[0];

  return (
    <section className="admin-card owner-trends-panel" aria-labelledby="revenue-trends-heading">
      <span className="eyebrow">DETAILED TRENDS</span>
      <div className="trend-heading-row">
        <div>
          <h2 id="revenue-trends-heading">Financial activity trends</h2>
          <p>Authoritative period activity grouped by CarShare reporting.</p>
        </div>
        {available.length > 1 && (
          <label>
            Currency
            <select
              value={selectedCurrency?.currency ?? ''}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {available.map((item) => (
                <option key={item.currency}>{item.currency}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {trends.isLoading && <p aria-live="polite">Loading authoritative financial trends…</p>}
      {trends.isError && (
        <div className="trend-error" role="alert">
          <p>Financial trends are temporarily unavailable. Summary totals remain authoritative.</p>
          <button type="button" onClick={() => void trends.refetch()}>
            Retry trends
          </button>
        </div>
      )}
      {data && !selectedCurrency && (
        <p className="trend-zero-state">No financial activity is available for this period.</p>
      )}
      {selectedCurrency && (
        <>
          <div className="trend-controls" role="group" aria-label="Financial trend metrics">
            {trendMetrics.map((metric) => {
              const active = selected.includes(metric);
              return (
                <button
                  aria-pressed={active}
                  className={active ? 'selected' : 'quiet'}
                  key={metric}
                  onClick={() => {
                    if (active && selected.length === 1) return;
                    setSelected(
                      active ? selected.filter((item) => item !== metric) : [...selected, metric],
                    );
                  }}
                  type="button"
                >
                  <span className="trend-swatch" style={{ backgroundColor: trendColors[metric] }} />
                  {trendMetricLabels[metric]}
                </button>
              );
            })}
          </div>
          <p className="trend-context">
            {selectedCurrency.currency} • {data!.granularity.toLowerCase()} buckets •{' '}
            {data!.timezone}
          </p>
          <FinancialTrendChart
            currency={selectedCurrency}
            metrics={selected}
            granularity={data!.granularity}
          />
          <AccessibleTrendTable currency={selectedCurrency} metrics={selected} />
        </>
      )}
    </section>
  );
}

function FinancialTrendChart({
  currency,
  metrics,
  granularity,
}: {
  readonly currency: OwnerRevenueTrends['currencies'][number];
  readonly metrics: readonly TrendMetric[];
  readonly granularity: OwnerRevenueTrends['granularity'];
}) {
  const width = 900;
  const height = 240;
  const left = 72;
  const top = 20;
  const plotWidth = width - left - 24;
  const plotHeight = height - top - 44;
  const points = currency.series[metrics[0]!] ?? [];
  const maximum = metrics.reduce(
    (max, metric) =>
      currency.series[metric].reduce(
        (inner, point) => (BigInt(point.valueMinor) > inner ? BigInt(point.valueMinor) : inner),
        max,
      ),
    0n,
  );
  const x = (index: number) =>
    left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotWidth);
  const y = (value: bigint) =>
    top +
    plotHeight -
    (maximum === 0n ? 0 : Number((value * 10_000n) / maximum) / 10_000) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const guides = [...new Set([maximum, maximum / 2n, 0n])];
  return (
    <div className="trend-chart-scroll">
      <svg
        aria-label={`${currency.currency} financial activity trend chart`}
        className="financial-trend-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <g aria-hidden="true">
          {guides.map((value) => (
            <g key={value.toString()}>
              <line
                className="trend-grid-line"
                x1={left}
                x2={left + plotWidth}
                y1={y(value)}
                y2={y(value)}
              />
              <text className="trend-axis-label" textAnchor="end" x={left - 10} y={y(value) + 4}>
                {formatCompactMinor(value, currency.currency)}
              </text>
            </g>
          ))}
        </g>
        <line className="trend-axis" x1={left} x2={left} y1={top} y2={top + plotHeight} />
        {points.map((point, index) =>
          index % labelEvery === 0 || index === points.length - 1 ? (
            <text
              className="trend-axis-label"
              key={point.startInclusive}
              textAnchor="middle"
              x={x(index)}
              y={height - 12}
            >
              {formatBucketLabel(point.startInclusive, granularity)}
            </text>
          ) : null,
        )}
        {metrics.map((metric) => {
          const series = currency.series[metric];
          const polyline = series
            .map((point, index) => `${x(index)},${y(BigInt(point.valueMinor))}`)
            .join(' ');
          return (
            <g key={metric}>
              <polyline
                fill="none"
                points={polyline}
                stroke={trendColors[metric]}
                strokeWidth="3"
              />
              {series.map((point, index) => (
                <circle
                  aria-label={`${trendMetricLabels[metric]}, ${formatBucketLabel(point.startInclusive, granularity)}: ${formatMinorUnits(point.valueMinor, currency.currency)}`}
                  cx={x(index)}
                  cy={y(BigInt(point.valueMinor))}
                  fill={trendColors[metric]}
                  key={point.startInclusive}
                  r="4"
                  tabIndex={0}
                >
                  <title>{`${trendMetricLabels[metric]} • ${formatBucketLabel(point.startInclusive, granularity)} • ${formatMinorUnits(point.valueMinor, currency.currency)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AccessibleTrendTable({
  currency,
  metrics,
}: {
  readonly currency: OwnerRevenueTrends['currencies'][number];
  readonly metrics: readonly TrendMetric[];
}) {
  const points = currency.series[metrics[0]!] ?? [];
  return (
    <details className="trend-data-details">
      <summary>View accessible trend data</summary>
      <div className="compact-table-wrap">
        <table className="compact-financial-table">
          <caption>Authoritative {currency.currency} financial trend values</caption>
          <thead>
            <tr>
              <th scope="col">Bucket</th>
              {metrics.map((metric) => (
                <th key={metric} scope="col">
                  {trendMetricLabels[metric]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={point.startInclusive}>
                <th scope="row">{formatTrendRange(point)}</th>
                {metrics.map((metric) => (
                  <td key={metric}>
                    {formatMinorUnits(
                      currency.series[metric][index]!.valueMinor,
                      currency.currency,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function formatBucketLabel(value: string, granularity: OwnerRevenueTrends['granularity']) {
  return new Intl.DateTimeFormat(
    'en-PH',
    granularity === 'HOURLY'
      ? { hour: 'numeric', timeZone: 'Asia/Manila' }
      : { day: 'numeric', month: 'short', timeZone: 'Asia/Manila' },
  ).format(new Date(value));
}
function formatTrendRange(point: TrendPoint) {
  const formatter = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });
  return `${formatter.format(new Date(point.startInclusive))} – ${formatter.format(new Date(point.endExclusive))}`;
}
function formatCompactMinor(value: bigint, currency: string) {
  return formatMinorUnits(value.toString(), currency).replace(/\.00$/u, '');
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

function buildTrendsPath(selection: PeriodSelection) {
  return buildPath(selection).replace('/admin/owner/revenue?', '/admin/owner/revenue/trends?');
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
