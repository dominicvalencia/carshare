'use client';

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { type OwnerAnalyticsPeriod, validateCustomRange } from './OwnerOverviewDashboard';

type PeriodSelection = {
  readonly period: OwnerAnalyticsPeriod;
  readonly startDate?: string;
  readonly endDate?: string;
};

type Integrity = {
  readonly actualPickupsWithoutActiveTransition: number;
  readonly cancellationRecordsWithoutTransition: number;
  readonly cancellationTransitionsWithoutRecord: number;
  readonly rentalsStartedChecked: number;
  readonly rentalsStartedMissingActualPickup: number;
  readonly rentalsStartedPickupTimestampMismatch: number;
  readonly status: 'PASS' | 'REVIEW_REQUIRED';
};

type CohortMetric = {
  readonly classification: 'cohortToDate';
  readonly cohortSize: number;
  readonly count: number;
  readonly definition: string;
  readonly maturityCutoffApplied: false;
  readonly rate: string | null;
  readonly rateUnit: 'PERCENT';
};

export interface OwnerMarketplaceReport {
  readonly definitionVersion: 'owner-marketplace-reports-v1';
  readonly environment: string;
  readonly syntheticData: boolean;
  readonly timezone: string;
  readonly generatedAt: string;
  readonly period: {
    readonly kind: OwnerAnalyticsPeriod;
    readonly startInclusive: string;
    readonly endExclusive: string;
  };
  readonly periodActivity: {
    readonly bookingsCreated: number;
    readonly confirmedBookings: number;
    readonly rentalsStarted: number;
    readonly completedRentals: number;
    readonly cancellations: number;
    readonly newRenters: number;
    readonly newVehicleOwners: number;
    readonly newVehicles: number;
    readonly activeRentersDuringPeriod: number;
  };
  readonly cohortMetrics: {
    readonly bookingConfirmationConversion: CohortMetric;
    readonly bookingCohortCancellationRate: CohortMetric;
  };
  readonly pointInTime: {
    readonly activeRentalsNow: { readonly asOf: string; readonly value: number };
    readonly approvedListingsNow: { readonly asOf: string; readonly value: number };
  };
  readonly cancellationBreakdown: {
    readonly actorAndReasonCode: readonly {
      readonly actorType: string;
      readonly reasonCode: string;
      readonly count: number;
    }[];
  };
  readonly integrity: Integrity;
}

type TrendMetric =
  | 'bookingsCreated'
  | 'confirmedBookings'
  | 'rentalsStarted'
  | 'completedRentals'
  | 'cancellations'
  | 'newRenters'
  | 'newVehicleOwners'
  | 'newVehicles';

type TrendPoint = {
  readonly startInclusive: string;
  readonly endExclusive: string;
  readonly count: string;
};

export interface OwnerMarketplaceTrends {
  readonly definitionVersion: 'owner-marketplace-trends-v1';
  readonly environment: string;
  readonly syntheticData: boolean;
  readonly timezone: string;
  readonly generatedAt: string;
  readonly period: {
    readonly kind: OwnerAnalyticsPeriod;
    readonly startInclusive: string;
    readonly endExclusive: string;
  };
  readonly granularity: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  readonly series: Readonly<Record<TrendMetric, readonly TrendPoint[]>>;
  readonly integrity: Integrity;
}

const STORAGE_KEY = 'carshare-owner-marketplace-reports-period';
const defaultSelection: PeriodSelection = { period: 'THIS_MONTH' };
const trendLabels: Readonly<Record<TrendMetric, string>> = {
  bookingsCreated: 'Bookings Created',
  confirmedBookings: 'Confirmed Bookings',
  rentalsStarted: 'Rentals Started',
  completedRentals: 'Completed Rentals',
  cancellations: 'Cancellations',
  newRenters: 'New Renters',
  newVehicleOwners: 'New Vehicle Owners',
  newVehicles: 'New Vehicles',
};
const trendMetrics = Object.keys(trendLabels) as TrendMetric[];
const trendColors: Readonly<Record<TrendMetric, string>> = {
  bookingsCreated: '#08785d',
  confirmedBookings: '#345995',
  rentalsStarted: '#d17b0f',
  completedRentals: '#7b4ea3',
  cancellations: '#b44747',
  newRenters: '#24748f',
  newVehicleOwners: '#8b6b24',
  newVehicles: '#596b65',
};

export function OwnerMarketplaceReportsDashboard({
  requestReport,
  requestTrends,
}: {
  readonly requestReport: (path: string) => Promise<OwnerMarketplaceReport>;
  readonly requestTrends: (path: string) => Promise<OwnerMarketplaceTrends>;
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

  const report = useQuery({
    queryKey: ['owner-marketplace-report', selection],
    queryFn: () => requestReport(buildReportPath(selection)),
  });
  const trends = useQuery({
    queryKey: ['owner-marketplace-trends', selection],
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
    <div className="owner-marketplace-dashboard">
      <section className="owner-period-bar" aria-label="Marketplace reporting period">
        <div>
          <strong>Reporting period</strong>
          <small>Marketplace activity and bucket boundaries come from CarShare reporting.</small>
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
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
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

      {report.isLoading && <ReportsSkeleton />}
      {report.isError && (
        <section className="owner-overview-error" role="alert">
          <strong>Marketplace reporting is temporarily unavailable.</strong>
          <p>No marketplace totals are shown until authoritative reporting responds.</p>
          <button type="button" onClick={() => void report.refetch()}>
            Retry
          </button>
        </section>
      )}
      {report.data && (
        <ReportsContent
          report={report.data}
          trends={{
            data: trends.data,
            isError: trends.isError,
            isLoading: trends.isLoading,
            refetch: trends.refetch,
          }}
        />
      )}
    </div>
  );
}

function ReportsContent({
  report,
  trends,
}: {
  readonly report: OwnerMarketplaceReport;
  readonly trends: {
    readonly data: OwnerMarketplaceTrends | undefined;
    readonly isError: boolean;
    readonly isLoading: boolean;
    readonly refetch: () => unknown;
  };
}) {
  const activity = report.periodActivity;
  return (
    <>
      {report.syntheticData && (
        <aside className="synthetic-data-banner" aria-label="Synthetic data warning">
          <strong>{report.environment.toUpperCase()} • SYNTHETIC DATA</strong>
          <span>
            Figures shown here are development/test data and do not represent real business
            performance.
          </span>
        </aside>
      )}
      <p className="marketplace-period-context">
        {formatPeriodRange(report.period.startInclusive, report.period.endExclusive)} •{' '}
        {report.timezone}
      </p>

      <ReportSection eyebrow="BOOKING & RENTAL ACTIVITY" title="Marketplace lifecycle activity">
        <div className="marketplace-primary-grid">
          <CountCard
            prominent
            label="Bookings Created"
            value={activity.bookingsCreated}
            helper="Bookings first created during the selected period."
          />
          <CountCard
            prominent
            label="Rentals Started"
            value={activity.rentalsStarted}
            helper="Rentals entering the active lifecycle during the selected period."
          />
          <CountCard
            prominent
            label="Completed Rentals"
            value={activity.completedRentals}
            helper="Rentals reaching completion during the selected period."
          />
        </div>
        <div className="marketplace-secondary-grid">
          <CountCard
            label="Confirmed Bookings"
            value={activity.confirmedBookings}
            helper="Bookings reaching confirmation during the selected period."
          />
          <CountCard
            label="Cancellations"
            value={activity.cancellations}
            helper="Cancellation events recorded during the selected period."
          />
        </div>
      </ReportSection>

      <MarketplaceTrendsPanel trends={trends} />

      <ReportSection eyebrow="CUSTOMER & SUPPLY GROWTH" title="Marketplace participation">
        <div className="marketplace-growth-grid">
          <CountCard label="New Renters" value={activity.newRenters} />
          <CountCard label="New Vehicle Owners" value={activity.newVehicleOwners} />
          <CountCard label="New Vehicles" value={activity.newVehicles} />
          <CountCard
            label="Active Renters During Period"
            value={activity.activeRentersDuringPeriod}
            helper="Distinct renters with qualifying booking lifecycle activity during the selected period."
          />
        </div>
      </ReportSection>

      <ReportSection eyebrow="BOOKING COHORT" title="Booking-created cohort outcomes">
        <div className="marketplace-cohort-grid">
          <CohortCard
            label="Booking Confirmation Conversion"
            metric={report.cohortMetrics.bookingConfirmationConversion}
          />
          <CohortCard
            label="Booking Cohort Cancellation Rate"
            metric={report.cohortMetrics.bookingCohortCancellationRate}
          />
        </div>
        <p className="cohort-caveat">Recent cohorts may have had less time to confirm or cancel.</p>
      </ReportSection>

      <ReportSection eyebrow="CURRENT MARKETPLACE" title="Current marketplace state">
        <div className="marketplace-current-grid">
          <CurrentCard
            label="Active Rentals Now"
            badge="LIVE • NOW"
            value={report.pointInTime.activeRentalsNow.value}
            asOf={report.pointInTime.activeRentalsNow.asOf}
          />
          <CurrentCard
            label="Approved Listings Now"
            badge="CURRENT"
            value={report.pointInTime.approvedListingsNow.value}
            asOf={report.pointInTime.approvedListingsNow.asOf}
          />
        </div>
      </ReportSection>

      <ReportSection eyebrow="CANCELLATION BREAKDOWN" title="Recorded cancellation events">
        <CancellationBreakdown rows={report.cancellationBreakdown.actorAndReasonCode} />
      </ReportSection>

      {report.integrity.status === 'REVIEW_REQUIRED' && (
        <aside className="reconciliation-notice" role="status">
          <strong>Marketplace data review in progress</strong>
          <span>
            Some lifecycle records require internal reconciliation. Aggregate reporting remains
            safely bounded.
          </span>
        </aside>
      )}
    </>
  );
}

function ReportSection({
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
    <section className="marketplace-section" aria-labelledby={id}>
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

function CountCard({
  label,
  value,
  helper,
  prominent = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly helper?: string;
  readonly prominent?: boolean;
}) {
  return (
    <article className={`owner-kpi-card marketplace-count-card ${prominent ? 'prominent' : ''}`}>
      <span className="owner-kpi-label">{label}</span>
      <strong className="owner-kpi-value">{formatCount(value)}</strong>
      {helper && <small>{helper}</small>}
    </article>
  );
}

function CohortCard({ label, metric }: { readonly label: string; readonly metric: CohortMetric }) {
  return (
    <article className="owner-kpi-card cohort-card">
      <span className="owner-kpi-label">{label}</span>
      <span className="cohort-badge">COHORT TO DATE</span>
      {metric.rate === null ? (
        <strong className="cohort-unavailable">No booking cohort in this period</strong>
      ) : (
        <>
          <strong className="owner-kpi-value">{metric.rate}%</strong>
          <span>
            {formatCount(metric.count)} of {formatCount(metric.cohortSize)} bookings
          </span>
        </>
      )}
      <small>{metric.definition}</small>
    </article>
  );
}

function CurrentCard({
  label,
  badge,
  value,
  asOf,
}: {
  readonly label: string;
  readonly badge: string;
  readonly value: number;
  readonly asOf: string;
}) {
  return (
    <article className="owner-kpi-card live-kpi-card marketplace-current-card">
      <div className="owner-kpi-label">
        <span>{label}</span>
        <span className="live-indicator">{badge}</span>
      </div>
      <strong className="owner-kpi-value">{formatCount(value)}</strong>
      <small>As of {formatTimestamp(asOf)}</small>
    </article>
  );
}

function CancellationBreakdown({
  rows,
}: {
  readonly rows: OwnerMarketplaceReport['cancellationBreakdown']['actorAndReasonCode'];
}) {
  if (!rows.length)
    return (
      <div className="marketplace-zero-state">
        No cancellation events were recorded in this period.
      </div>
    );
  return (
    <div className="compact-table-wrap">
      <table className="compact-financial-table">
        <caption>Cancellation events by actor type and reason code</caption>
        <thead>
          <tr>
            <th scope="col">Actor type</th>
            <th scope="col">Reason code</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.actorType}:${row.reasonCode}`}>
              <td>{humanizeCode(row.actorType)}</td>
              <td>
                <code>{row.reasonCode}</code>
              </td>
              <td>{formatCount(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketplaceTrendsPanel({
  trends,
}: {
  readonly trends: {
    readonly data: OwnerMarketplaceTrends | undefined;
    readonly isError: boolean;
    readonly isLoading: boolean;
    readonly refetch: () => unknown;
  };
}) {
  const [selected, setSelected] = useState<readonly TrendMetric[]>([
    'bookingsCreated',
    'rentalsStarted',
    'completedRentals',
  ]);
  const data = trends.data;
  return (
    <section className="admin-card owner-trends-panel" aria-labelledby="marketplace-trends-heading">
      <span className="eyebrow">MARKETPLACE ACTIVITY TRENDS</span>
      <div className="trend-heading-row">
        <div>
          <h2 id="marketplace-trends-heading">Marketplace activity over time</h2>
          <p>Authoritative event counts in server-generated reporting buckets.</p>
        </div>
      </div>
      {trends.isLoading && <p aria-live="polite">Loading authoritative marketplace trends…</p>}
      {trends.isError && (
        <div className="trend-error" role="alert">
          <p>
            Marketplace trends are temporarily unavailable. Summary totals remain authoritative.
          </p>
          <button type="button" onClick={() => void trends.refetch()}>
            Retry trends
          </button>
        </div>
      )}
      {data && (
        <>
          <div className="trend-controls" role="group" aria-label="Marketplace trend metrics">
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
                  {trendLabels[metric]}
                </button>
              );
            })}
          </div>
          <p className="trend-context">
            Count • {data.granularity.toLowerCase()} buckets • {data.timezone}
          </p>
          <MarketplaceTrendChart data={data} metrics={selected} />
          <AccessibleMarketplaceTrendTable data={data} metrics={selected} />
        </>
      )}
    </section>
  );
}

function MarketplaceTrendChart({
  data,
  metrics,
}: {
  readonly data: OwnerMarketplaceTrends;
  readonly metrics: readonly TrendMetric[];
}) {
  const width = 900;
  const height = 240;
  const left = 60;
  const top = 20;
  const plotWidth = width - left - 24;
  const plotHeight = height - top - 44;
  const points = data.series[metrics[0]!] ?? [];
  const maximum = metrics.reduce(
    (max, metric) =>
      data.series[metric].reduce(
        (inner, point) => (BigInt(point.count) > inner ? BigInt(point.count) : inner),
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
        aria-label="Marketplace activity count trend chart"
        className="financial-trend-chart marketplace-trend-chart"
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
                {formatCount(value.toString())}
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
              {formatBucketLabel(point.startInclusive, data.granularity)}
            </text>
          ) : null,
        )}
        {metrics.map((metric) => (
          <g key={metric}>
            <polyline
              fill="none"
              points={data.series[metric]
                .map((point, index) => `${x(index)},${y(BigInt(point.count))}`)
                .join(' ')}
              stroke={trendColors[metric]}
              strokeWidth="3"
            />
            {data.series[metric].map((point, index) => (
              <circle
                aria-label={`${trendLabels[metric]}, ${formatBucketLabel(point.startInclusive, data.granularity)}: ${formatCount(point.count)}`}
                cx={x(index)}
                cy={y(BigInt(point.count))}
                fill={trendColors[metric]}
                key={point.startInclusive}
                r="4"
                tabIndex={0}
              >
                <title>{`${trendLabels[metric]} • ${formatBucketLabel(point.startInclusive, data.granularity)} • ${formatCount(point.count)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

function AccessibleMarketplaceTrendTable({
  data,
  metrics,
}: {
  readonly data: OwnerMarketplaceTrends;
  readonly metrics: readonly TrendMetric[];
}) {
  const points = data.series[metrics[0]!] ?? [];
  return (
    <details className="trend-data-details">
      <summary>View accessible trend data</summary>
      <div className="compact-table-wrap">
        <table className="compact-financial-table">
          <caption>Authoritative marketplace activity trend counts</caption>
          <thead>
            <tr>
              <th scope="col">Bucket</th>
              {metrics.map((metric) => (
                <th key={metric} scope="col">
                  {trendLabels[metric]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={point.startInclusive}>
                <th scope="row">{formatTrendRange(point)}</th>
                {metrics.map((metric) => (
                  <td key={metric}>{formatCount(data.series[metric][index]!.count)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ReportsSkeleton() {
  return (
    <section className="owner-overview-loading" aria-live="polite">
      <span className="sr-only">Loading authoritative marketplace reports</span>
      <div className="skeleton-block" />
      <div className="skeleton-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="skeleton-card" key={index} />
        ))}
      </div>
    </section>
  );
}

function loadSelection(): PeriodSelection {
  if (typeof window === 'undefined') return defaultSelection;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '') as PeriodSelection;
    return ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'CUSTOM'].includes(saved.period)
      ? saved
      : defaultSelection;
  } catch {
    return defaultSelection;
  }
}
function buildReportPath(selection: PeriodSelection) {
  const query = new URLSearchParams({ period: selection.period });
  if (selection.startDate) query.set('startDate', selection.startDate);
  if (selection.endDate) query.set('endDate', selection.endDate);
  return `/admin/owner/reports/marketplace?${query.toString()}`;
}
function buildTrendsPath(selection: PeriodSelection) {
  return buildReportPath(selection).replace('/marketplace?', '/marketplace/trends?');
}
export function formatMarketplaceCount(value: string | number) {
  return formatCount(value);
}
function formatCount(value: string | number) {
  return new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(BigInt(String(value)));
}
function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}
function formatPeriodRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}
function formatBucketLabel(value: string, granularity: OwnerMarketplaceTrends['granularity']) {
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
function humanizeCode(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase());
}
