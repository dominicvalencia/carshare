'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export type OwnerAnalyticsPeriod = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

interface ComparisonMetric {
  readonly absoluteChange: number;
  readonly classification: 'period';
  readonly comparisonAvailable: boolean;
  readonly current: number;
  readonly percentageChange: string | null;
  readonly previous: number;
}

interface CurrencyValue {
  readonly absoluteChangeMinor: string;
  readonly comparisonAvailable: boolean;
  readonly currency: string;
  readonly currentMinor: string;
  readonly percentageChange: string | null;
  readonly previousMinor: string;
}

interface CurrencyMetric {
  readonly classification: 'period';
  readonly values: readonly CurrencyValue[];
}

export interface OwnerAnalyticsOverview {
  readonly metadata: {
    readonly definitionVersion: string;
    readonly endExclusive: string;
    readonly environment: string;
    readonly generatedAt: string;
    readonly period: OwnerAnalyticsPeriod;
    readonly startInclusive: string;
    readonly syntheticData: boolean;
    readonly timezone: string;
  };
  readonly metrics: {
    readonly activeRentalsNow: {
      readonly classification: 'pointInTime';
      readonly generatedAt: string;
      readonly value: number;
    };
    readonly bookingsCreated: ComparisonMetric;
    readonly capturedRentalGbv: CurrencyMetric;
    readonly completedRefunds: CurrencyMetric;
    readonly completedRentals: ComparisonMetric;
    readonly confirmedBookings: ComparisonMetric;
    readonly recognizedCarShareCommission: CurrencyMetric;
  };
}

interface OwnerOverviewDashboardProperties {
  readonly requestOverview: (path: string) => Promise<OwnerAnalyticsOverview>;
}

interface PeriodSelection {
  readonly period: OwnerAnalyticsPeriod;
  readonly startDate?: string;
  readonly endDate?: string;
}

const PERIOD_STORAGE_KEY = 'carshare-owner-overview-period';
const defaultSelection: PeriodSelection = { period: 'THIS_MONTH' };

export function OwnerOverviewDashboard({ requestOverview }: OwnerOverviewDashboardProperties) {
  const [selection, setSelection] = useState<PeriodSelection>(loadStoredSelection);
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState(selection.startDate ?? '');
  const [customEnd, setCustomEnd] = useState(selection.endDate ?? '');
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify(selection));
  }, [selection]);

  const queryPath = buildOverviewPath(selection);
  const overview = useQuery({
    queryKey: ['owner-analytics-overview', selection],
    queryFn: () => requestOverview(queryPath),
  });

  const selectPreset = (period: Exclude<OwnerAnalyticsPeriod, 'CUSTOM'>) => {
    setCustomOpen(false);
    setCustomError(null);
    setSelection({ period });
  };

  const applyCustom = () => {
    const error = validateCustomRange(customStart, customEnd);
    setCustomError(error);
    if (error) return;
    setSelection({ period: 'CUSTOM', startDate: customStart, endDate: customEnd });
    setCustomOpen(false);
  };

  return (
    <div className="owner-overview-dashboard">
      <section className="owner-period-bar" aria-label="Owner reporting period">
        <div>
          <strong>Reporting period</strong>
          <small>All period boundaries and comparisons are calculated by CarShare reporting.</small>
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
              onClick={() => selectPreset(period)}
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
              onChange={(event) => setCustomStart(event.target.value)}
              type="date"
              value={customStart}
            />
          </label>
          <label>
            End date
            <input
              onChange={(event) => setCustomEnd(event.target.value)}
              type="date"
              value={customEnd}
            />
          </label>
          <div className="custom-period-actions">
            <button onClick={applyCustom} type="button">
              Apply
            </button>
            <button
              className="quiet"
              onClick={() => {
                setCustomOpen(false);
                setCustomError(null);
                setCustomStart(selection.startDate ?? '');
                setCustomEnd(selection.endDate ?? '');
              }}
              type="button"
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

      {overview.isLoading && <OwnerOverviewSkeleton />}
      {overview.isError && (
        <section className="owner-overview-error" role="alert">
          <strong>Business performance is temporarily unavailable.</strong>
          <p>Your other Owner workspace pages are unaffected. Try loading this overview again.</p>
          <button onClick={() => void overview.refetch()} type="button">
            Retry
          </button>
        </section>
      )}
      {overview.data && <OwnerOverviewContent overview={overview.data} />}
    </div>
  );
}

function OwnerOverviewContent({ overview }: { readonly overview: OwnerAnalyticsOverview }) {
  const { metadata, metrics } = overview;
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

      <section aria-labelledby="financial-kpis-heading">
        <div className="owner-section-heading">
          <span className="eyebrow" id="financial-kpis-heading">
            FINANCIAL PERFORMANCE
          </span>
          <OwnerAsOf metadata={metadata} />
        </div>
        <div className="owner-kpi-grid owner-financial-grid">
          <CurrencyKpi
            definition="Platform commission recognized in CarShare's ledger after recorded reversals. Provider fees, tax, and operating costs are not included."
            empty="No commission was recognized in this period."
            label="CarShare Commission"
            metric={metrics.recognizedCarShareCommission}
          />
          <CurrencyKpi
            definition="Value of qualifying captured rental bookings. Refunds are reported separately and do not rewrite historical GBV."
            empty="No captured rental activity in this period."
            label="Gross Booking Value"
            metric={metrics.capturedRentalGbv}
          />
          <CurrencyKpi
            definition="Refunds completed during the selected reporting period, shown separately from historical GBV."
            empty="No refunds were completed in this period."
            label="Completed Refunds"
            metric={metrics.completedRefunds}
          />
        </div>
      </section>

      <section aria-labelledby="activity-kpis-heading">
        <div className="owner-section-heading compact">
          <div>
            <span className="eyebrow">BUSINESS ACTIVITY</span>
            <h2 id="activity-kpis-heading">Rental activity</h2>
          </div>
        </div>
        <div className="owner-kpi-grid owner-activity-grid">
          <CountKpi
            empty="No bookings were created in this period."
            label="Bookings Created"
            metric={metrics.bookingsCreated}
          />
          <CountKpi
            empty="No bookings were confirmed in this period."
            label="Confirmed Bookings"
            metric={metrics.confirmedBookings}
          />
          <CountKpi
            empty="No rentals were completed in this period."
            label="Completed Rentals"
            metric={metrics.completedRentals}
          />
          <article className="owner-kpi-card live-kpi-card">
            <div className="owner-kpi-label">
              <span>Active Rentals Now</span>
              <span className="live-indicator">LIVE • NOW</span>
              <DefinitionHelp text="Rentals currently active or awaiting return at the generated-as-of time. This is a point-in-time figure, so it has no previous-period comparison." />
            </div>
            <strong className="owner-kpi-value">
              {metrics.activeRentalsNow.value.toLocaleString('en-PH')}
            </strong>
            <small>
              {metrics.activeRentalsNow.value === 0
                ? 'No rentals are active right now.'
                : 'Current point-in-time activity'}
            </small>
          </article>
        </div>
      </section>

      <section className="admin-card owner-trends-placeholder">
        <span className="eyebrow">DETAILED TRENDS</span>
        <h2>More reporting is coming</h2>
        <p>Detailed trends will appear in Revenue &amp; Earnings and Reports.</p>
      </section>
    </>
  );
}

function OwnerAsOf({ metadata }: { readonly metadata: OwnerAnalyticsOverview['metadata'] }) {
  const period = metadata.period === 'CUSTOM' ? 'Custom range' : periodLabel(metadata.period);
  return (
    <p className="owner-as-of">
      <span>
        {period} • {formatDateRange(metadata.startInclusive, metadata.endExclusive)}
      </span>
      <span>
        As of{' '}
        {new Intl.DateTimeFormat('en-PH', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Manila',
        }).format(new Date(metadata.generatedAt))}
      </span>
      <span>{metadata.timezone}</span>
    </p>
  );
}

function CurrencyKpi({
  definition,
  empty,
  label,
  metric,
}: {
  readonly definition: string;
  readonly empty: string;
  readonly label: string;
  readonly metric: CurrencyMetric;
}) {
  const values =
    metric.values.length === 0
      ? [
          {
            absoluteChangeMinor: '0',
            comparisonAvailable: false,
            currency: 'PHP',
            currentMinor: '0',
            percentageChange: null,
            previousMinor: '0',
          },
        ]
      : metric.values;
  return (
    <article className="owner-kpi-card financial-kpi-card">
      <div className="owner-kpi-label">
        <span>{label}</span>
        <DefinitionHelp text={definition} />
      </div>
      <div className="currency-value-list">
        {values.map((value) => (
          <div key={value.currency}>
            <strong className="owner-kpi-value">
              {formatMinorUnits(value.currentMinor, value.currency)}
            </strong>
            {values.length > 1 && <small className="currency-code">{value.currency}</small>}
            <Comparison comparison={value} money />
          </div>
        ))}
      </div>
      {values.every(({ currentMinor }) => BigInt(currentMinor) === 0n) && <small>{empty}</small>}
    </article>
  );
}

function CountKpi({
  empty,
  label,
  metric,
}: {
  readonly empty: string;
  readonly label: string;
  readonly metric: ComparisonMetric;
}) {
  return (
    <article className="owner-kpi-card">
      <div className="owner-kpi-label">
        <span>{label}</span>
      </div>
      <strong className="owner-kpi-value">{metric.current.toLocaleString('en-PH')}</strong>
      <Comparison comparison={metric} />
      {metric.current === 0 && <small>{empty}</small>}
    </article>
  );
}

function Comparison({
  comparison,
  money = false,
}: {
  readonly comparison: ComparisonMetric | CurrencyValue;
  readonly money?: boolean;
}) {
  const percentage = comparison.percentageChange;
  if (!comparison.comparisonAvailable || percentage === null)
    return <p className="kpi-comparison unavailable">No comparable prior activity</p>;
  const numeric = Number.parseFloat(percentage);
  const previous =
    money && 'currency' in comparison
      ? formatMinorUnits(comparison.previousMinor, comparison.currency)
      : 'previous' in comparison
        ? comparison.previous.toLocaleString('en-PH')
        : comparison.previousMinor;
  return (
    <p className="kpi-comparison">
      <span>
        {numeric === 0
          ? 'No change vs previous period'
          : `${numeric > 0 ? '↑' : '↓'} ${Math.abs(numeric).toFixed(2)}% vs previous period`}
      </span>
      <small>Previous: {previous}</small>
    </p>
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

function OwnerOverviewSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="owner-overview-loading">
      <span className="sr-only">Loading business performance overview</span>
      <div className="owner-kpi-grid owner-financial-grid">
        {[0, 1, 2].map((item) => (
          <div className="owner-kpi-card skeleton-card" key={item}>
            <span />
            <strong />
          </div>
        ))}
      </div>
      <div className="owner-kpi-grid owner-activity-grid">
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

export function formatMinorUnits(value: string, currency: string): string {
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const symbol = currency === 'PHP' ? '₱' : `${currency} `;
  const sign = negative ? '-' : '';
  return `${sign}${symbol}${whole}.${fraction}`;
}

export function validateCustomRange(startDate: string, endDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(endDate))
    return 'Choose both a start date and an end date.';
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return 'End date must be on or after start date.';
  if ((end - start) / 86_400_000 + 1 > 366)
    return 'Custom reporting periods cannot exceed 366 calendar days.';
  return null;
}

function buildOverviewPath(selection: PeriodSelection): string {
  const parameters = new URLSearchParams({ period: selection.period });
  if (selection.period === 'CUSTOM' && selection.startDate && selection.endDate) {
    parameters.set('startDate', selection.startDate);
    parameters.set('endDate', selection.endDate);
  }
  return `/admin/owner/analytics/overview?${parameters.toString()}`;
}

function isValidStoredSelection(candidate: PeriodSelection): boolean {
  if (candidate.period === 'CUSTOM')
    return Boolean(
      candidate.startDate &&
      candidate.endDate &&
      !validateCustomRange(candidate.startDate, candidate.endDate),
    );
  return ['TODAY', 'THIS_WEEK', 'THIS_MONTH'].includes(candidate.period);
}

function loadStoredSelection(): PeriodSelection {
  if (typeof window === 'undefined') return defaultSelection;
  const stored = window.sessionStorage.getItem(PERIOD_STORAGE_KEY);
  if (!stored) return defaultSelection;
  try {
    const candidate = JSON.parse(stored) as PeriodSelection;
    return isValidStoredSelection(candidate) ? candidate : defaultSelection;
  } catch {
    window.sessionStorage.removeItem(PERIOD_STORAGE_KEY);
    return defaultSelection;
  }
}

function periodLabel(period: OwnerAnalyticsPeriod): string {
  return period === 'TODAY'
    ? 'Today'
    : period === 'THIS_WEEK'
      ? 'This Week'
      : period === 'THIS_MONTH'
        ? 'This Month'
        : 'Custom range';
}

function formatDateRange(startInclusive: string, endExclusive: string): string {
  const formatter = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
  });
  return `${formatter.format(new Date(startInclusive))} – ${formatter.format(new Date(new Date(endExclusive).getTime() - 1))}`;
}
