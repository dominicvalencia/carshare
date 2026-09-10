# Phase 13C-2H-C: Revenue & Earnings

## C1 — authoritative contract and API core

Phase 13C-2H-C1 introduces the server-owned `owner-revenue-v1` definition and `GET /api/v1/admin/owner/revenue`. The endpoint is aggregate-only, OWNER-only, environment-labelled, currency-separated, and uses the shared `Asia/Manila` reporting period resolver for `TODAY`, `THIS_WEEK`, `THIS_MONTH`, and bounded `CUSTOM` periods.

Final status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / ACCOUNTING RECONCILIATION PASS**. This is an API-only slice and does not require separate physical UI acceptance.

The response separates selected-period activity from balances evaluated at `generatedAt`. Important zero-value categories remain contractual even when no local activity exists. Reconciliation-required captures are excluded and surfaced through a safe aggregate integrity warning.

No Revenue & Earnings UI, transaction table, trend chart, provider request, schema change, or migration belongs to C1. Authoritative trends are deferred to C3. Phase 13C-3 public staging remains paused.

## Accepted local reconciliation

The accepted local authoritative period reconciled to:

- rental collections: PHP 13,400.00;
- rental GBV: PHP 13,400.00;
- recognized CarShare commission: PHP 2,010.00; and
- period owner earnings: PHP 11,390.00.

The point-in-time Owner Payable Liability was PHP 13,175.00. Available for Payout was empty because the existing payout-readiness controls were not all satisfied. No data was altered to force these values.

The representative local query plans completed in approximately 0.185 ms for captured collections, 1.215 ms for recognized commission, and 0.176 ms for Owner Payable Liability. No speculative index, Redis cache, materialized view, projection, or background reporting process was introduced.

The migration count remains 39. Both local `carrental` and disposable integration `carrental_test` were up to date at acceptance; no schema or historical migration changed.

See [ADR 0029](../decisions/0029-owner-revenue-and-earnings-contract.md) for terminology and accounting boundaries.

## C2 — Owner Revenue & Earnings UI baseline

The Owner workspace route `/admin/owner/finance` presents the authoritative `owner-revenue-v1` response without recalculating financial values or period boundaries in the browser. It separates selected-period collections, CarShare commission, owner earnings, and payout lifecycle activity from point-in-time Owner Payable Liability and Available for Payout balances.

The Owner workspace is the executive business-oversight surface: **How is CarShare performing?** The Operations Console remains the deliberate operational-workflow surface: **What work needs to be done?** Dedicated Owner navigation destinations for **Bookings & rentals** and **Users & vehicles** were removed because their individual records, queues, and actions already exist in Operations Console. Legacy direct URLs for those two destinations redirect to Owner Reports. OWNER operational authority is unchanged, while authoritative aggregate booking, renter, owner, vehicle, and supply insights remain appropriate for Overview and future Reports.

Local and non-production figures carry the API-provided synthetic-data warning. Currency groups remain separate and minor-unit strings are formatted with BigInt-safe presentation helpers. Reconciliation warnings expose no payment, provider, customer, ledger, or audit identifiers. Security-deposit authorization is not presented as collected cash.

Authoritative trend series and charts remain deferred to C3. C2 introduces no schema change or migration.

The physical-review refinement reduces information density without removing authoritative categories: Total Owner Earnings remains a primary card while Pending, Held, Available, Paid, and Reversed share one compact earnings breakdown. Pending Approval, Approved, Processing, Paid, Failed, and Reversed payouts share one amount/count lifecycle table. The additional-charge breakdown preserves the distinct Approved, Collected, Refunded, Owner Compensation, and CarShare Share accounting categories; it does not reuse owner-earning statuses. Additional Charge Collections and Additional Charge CarShare Share use secondary visual treatment. Owner Payable Liability and Available for Payout remain prominent, separate point-in-time balances.

Physical Owner browser review accepted this refined hierarchy, compact presentation, responsive behavior, and simplified Owner workspace. Phase 13C-2H-C2 is **IMPLEMENTED / AUTOMATED VERIFICATION PASS / PHYSICAL OWNER UX ACCEPTANCE PASS**.

### Focused physical QA

1. Sign in as OWNER and open **Revenue & earnings**.
2. Confirm the local synthetic-data warning is visible and **This Month** is selected by default.
3. Confirm Rental Collections, Completed Refunds, and Recognized CarShare Commission match the API response.
4. Confirm Total, Pending, Held, Available, Paid, and Reversed Owner Earnings remain separate.
5. Confirm Owner Payable Liability is labelled **CURRENT BALANCE** and Available for Payout is separately labelled **CURRENTLY ELIGIBLE**.
6. Confirm neither point-in-time balance shows a previous-period comparison.
7. Confirm the payout amount/count lifecycle table and current allocation cards are distinct.
8. Confirm zero payout and additional-charge states look intentional.
9. Confirm the reconciliation notice contains no private identifiers.
10. Exercise Today, This Week, This Month, and a valid Custom range; reject an invalid or over-366-day range.
11. Check desktop, laptop, tablet, and narrow browser widths for overflow and readable stacked balances.
12. Confirm SUPER_ADMIN and STAFF cannot open the Owner route and the Operations Console remains unchanged.
13. Confirm no customer-sensitive information, security-deposit collection card, or fabricated trend chart appears.

## C3 — authoritative financial trend series

C3 introduces `owner-revenue-trends-v1` at `GET /api/v1/admin/owner/revenue/trends`. The API accepts the same `period`, `startDate`, and `endDate` query as the summary, selects granularity on the server, and returns ready-to-render `[startInclusive, endExclusive)` Manila buckets with decimal-string minor units and explicit zeroes. Each currency is an independent group; no FX conversion occurs.

The six series are Rental Collections, Gross Booking Value, Recognized CarShare Commission, Total Owner Earnings, Completed Refunds, and Paid Payouts. Their attribution timestamps and accounting definitions are documented in [ADR 0030](../decisions/0030-owner-revenue-trend-series.md). Every series is reconciled against its directly equivalent `owner-revenue-v1` summary total before a response is returned.

The Owner dashboard renders the server buckets without calculating financial totals or boundaries. It defaults to Rental Collections and CarShare Commission, permits precise metric selection, uses separate currency views, provides keyboard-focusable chart points, and includes an expandable semantic data table. Existing C2 summaries and the page-level synthetic/reconciliation warnings remain unchanged.

Point-in-time Owner Payable Liability, Available for Payout, Active Payout Allocations, and Processing Payouts remain cards and are not charted. C3 adds no schema, migration, provider call, Reports implementation, or staging work.

### C3 physical Owner QA

1. Open **Revenue & earnings** as OWNER and confirm all accepted C2 summary sections remain unchanged.
2. Confirm **Financial activity trends** loads with Rental Collections and CarShare Commission selected.
3. Toggle GBV, Owner Earnings, Completed Refunds, and Paid Payouts and verify precise legend labels and values.
4. Confirm Today is hourly; This Week and This Month are daily; short, medium, and long Custom ranges are daily, weekly, and monthly respectively.
5. Inspect zero buckets, mouse tooltips, keyboard-focused points, currency handling, and the accessible data table.
6. Check narrow layouts for readable labels and absence of horizontal page overflow.
7. Confirm synthetic and reconciliation warnings remain safe and current-balance cards are not charted.
8. Confirm SUPER_ADMIN, STAFF, and unauthenticated users remain denied.
