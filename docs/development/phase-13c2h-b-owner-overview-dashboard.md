# Phase 13C-2H-B — Owner Overview dashboard baseline

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / PHYSICAL OWNER UX ACCEPTANCE PASS**.

The refined Owner Overview was physically reviewed in the browser and accepted. The accepted presentation confirms:

- `Business value` is removed while `FINANCIAL PERFORMANCE` remains above the financial cards.
- Comparable financial and count metrics show the API-provided previous value.
- Unchanged comparable metrics show `No change vs previous period`; no card shows `— 0.00% vs previous period`.
- Metrics without prior activity show `No comparable prior activity`.
- Active Rentals Now remains `LIVE • NOW` with no previous-period comparison.
- Responsive layouts are acceptable and the Overview remains OWNER-only.
- No Owner Payable metric or fabricated trend chart was introduced.

## Scope and authority

The Owner Overview is an aggregate executive dashboard backed exclusively by `GET /api/v1/admin/owner/analytics/overview`. The browser selects `TODAY`, `THIS_WEEK`, `THIS_MONTH`, or a validated custom date range and renders the returned `owner-analytics-v1` metrics. It does not calculate reporting boundaries, comparison periods, financial totals, lifecycle counts, or percentage changes.

The dashboard presents CarShare Commission, Gross Booking Value, Completed Refunds, Bookings Created, Confirmed Bookings, Completed Rentals, and the point-in-time Active Rentals Now value. Financial values remain grouped by currency and minor-unit strings are formatted for display using integer arithmetic. Refunds remain separate from GBV. Active Rentals Now has no period comparison.

Local, test, and staging responses marked `syntheticData=true` display a persistent environment warning. The dashboard also shows the server generation timestamp, selected period, authoritative date boundaries, and `Asia/Manila` timezone. Definitions avoid exposing internal database model names.

Detailed trend charts, collections, owner earnings, payout and commission breakdowns, additional charges, detailed refunds, provider fees, and exports are outside this slice. Because `owner-analytics-v1` does not expose a trend series, the Overview contains no fabricated chart.

Owner Payable is not part of the Overview baseline. It remains a candidate metric for the authoritative Revenue & Earnings milestone.

## States and access

- Default period: This Month.
- Custom ranges require both dates, an end date on or after the start, and at most 366 calendar days. Apply changes the authoritative API query; Cancel keeps the prior applied selection.
- The applied selection is retained in browser session storage while navigating within the Owner workspace.
- Loading uses semantic skeletons; errors show a safe section-level message and Retry; zero periods show intentional zero-value copy.
- The existing exact OWNER route/module boundary remains in force. SUPER_ADMIN and STAFF receive no implicit Owner analytics access.
- The response and UI remain aggregate and contain no customer identity, contact, KYC, payment-instrument, payout-account, pickup-address, credential, or audit-payload data.

## Manual QA checklist

1. Sign in as OWNER and confirm landing on `/admin/owner/overview`.
2. Confirm the local synthetic-data banner is persistent and clearly states the figures are not real performance.
3. Confirm This Month is selected by default on a fresh browser session.
4. Verify CarShare Commission against the authoritative API response and open its definition help.
5. Verify Gross Booking Value and its definition; confirm refunds are separate.
6. Verify Completed Refunds and its definition.
7. Verify Bookings Created, Confirmed Bookings, and Completed Rentals.
8. Confirm Active Rentals Now is marked `LIVE • NOW`, has a definition, and has no previous-period comparison.
9. Select Today and confirm the API-driven values refresh.
10. Select This Week and confirm the API-driven values refresh.
11. Select This Month and confirm the API-driven values refresh.
12. Open Custom, apply a valid range, and confirm the displayed boundary and values.
13. Confirm missing dates, reversed dates, and ranges over 366 calendar days are rejected before a request.
14. Confirm API-provided increase, decrease, absolute change, and percentage text display accurately.
15. Confirm a zero previous period says `No comparable prior activity` and never shows infinity, NaN, or a fabricated percentage.
16. Refresh and navigate away/back within the Owner workspace; confirm the selected period remains and values remain server-calculated.
17. Test desktop, laptop, tablet, and narrow browser widths; confirm cards wrap without horizontal overflow or clipped long currency values.
18. Enter the separate Operations Console and confirm it remains operational and unchanged.
19. Confirm STAFF and SUPER_ADMIN cannot directly open the Owner Overview financial analytics.
20. Confirm the page shows aggregate metrics only and contains no customer-sensitive data.

Public HTTPS staging and Phase 13C-3 remain paused. Phase 13C-2H-C has not started.
