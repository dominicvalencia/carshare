# Admin UX stabilization baseline

## Status and scope

This pass reorganizes the existing Admin application into a professional, responsive operations
workspace. It does not start Phase 13, add provider integrations, change booking state rules, or alter
API authorization. Existing server-authoritative endpoints and permission checks remain the source of
truth.

## Information architecture

The Admin application now exposes bookmarkable routes for:

- `/admin/dashboard`
- `/admin/users`
- `/admin/verification/renters`
- `/admin/verification/owners`
- `/admin/vehicles`
- `/admin/bookings`
- `/admin/rentals`
- `/admin/claims`
- `/admin/payouts`
- `/admin/support`
- `/admin/trust-safety`
- `/admin/operations/inspection-corrections`
- `/admin/settings/commissions`

Record identifiers appended to the applicable queue route open that record's existing detail
workspace. Unknown Admin paths safely resolve to the dashboard rather than exposing a new workflow.
Queue actions use client-side navigation, and the resulting detail URLs are bookmarkable. This applies
to renter/owner verification, vehicle review, booking finance, pickup/active/return operations, claims,
payout/support/moderation, and inspection-correction records where a detail route exists.

## Shell and responsive behavior

- Desktop uses a persistent left navigation, sticky identity/action header, dense queue workspaces,
  and multi-column dashboard summaries sourced from existing APIs.
- Tablet collapses navigation into a drawer while preserving the full operational workspace.
- Mobile uses the same routed hierarchy, a compact header and drawer, single-column cards, wrapping
  actions, and horizontally safe content.
- Visible focus states and explicit labels remain available for keyboard and assistive-technology use.

## Authentication and sensitive data

- The Admin access token remains in React memory and is not written to local storage.
- Any Admin API `401` signs the operator out and clears React Query data, producing one login surface
  instead of repeated module errors.
- Sensitive identity documents continue to use short-lived `/files/:id/access-grants`; direct storage
  URLs are not introduced.
- Existing backend permission guards and audit-producing actions are unchanged.

Dashboard queue cards use framework client navigation so the in-memory Admin access token survives
module transitions. A plain document navigation would remount the session provider and is prohibited by
regression coverage.

## Operational content baseline

- Users are presented in a filterable desktop table with roles, verification, account status, joined
  date, renter/owner activity counts, and a bookmarkable account workspace at
  `/admin/users/:userId`.
- The account workspace composes the existing authoritative user, verification, vehicle, booking,
  claim, pricing, and earning records. Role-aware Overview, Renter activity, Owner activity, and
  Security/Audit tabs only expose the workspaces applicable to the account. Dual-role users receive
  renter and owner activity within the same account page.
- Renter activity includes lifecycle summaries, lifecycle filtering, booking/rental history, and
  links to existing booking, rental, and claim diagnostics. Owner activity includes vehicle review
  status, rental summaries, authorized earnings context, and links to existing vehicle, rental, and
  claim workspaces. These links reuse server-authoritative operational records instead of duplicating
  lifecycle truth.
- The general account projection deliberately excludes sessions, KYC documents, raw license fields,
  addresses, private media identifiers, and storage paths. Sensitive verification evidence remains in
  the separately authorized temporary-grant workspace.
- Renter KYC uses a structured queue with submitted/waiting/status information. Shared data-table,
  status-badge, filter-toolbar, loading, error, and empty-state patterns provide denser desktop content
  and mobile card fallbacks.
- Owner verification, vehicles, bookings, rentals, claims, payouts, support, and trust-and-safety
  queues now distinguish successful empty results from loading and request failures.

No new endpoint was introduced. The existing permission-protected `GET /admin/users/:id` projection was
narrowed to safe fields and extended with bounded operational histories (up to 100 records per
collection). No database migration is required.

## Operational detail presentation

The Renter KYC, Vehicle Review, Booking Finance, Rental Operations, and Claims workspaces share a
desktop-first detail-page system: sticky routed headers, operator-facing status labels, compact summary
metrics, structured definition lists, evidence galleries, lifecycle timelines, contextual action bars,
and expandable technical/audit data. Raw enum codes, accounting account codes, minor-unit ledger lines,
and repetitive security events are secondary diagnostic content rather than the primary interface.

Evidence remains private by default. Image previews are loaded only when an authorized administrator
explicitly requests one, using the existing audited five-minute access-grant endpoint. Opening a full
document uses the same grant mechanism; no direct storage URL or persistent public thumbnail is added.
Photo tiles use cover previews, document tiles use contain previews, and expanded evidence uses the
secure lightbox. Renter KYC approval validates review notes and address assessment; missing required
operator input is presented in a modal so it remains visible regardless of scroll position.

At narrower widths, summary and evidence grids collapse from four/three columns to two and then one,
definition lists stack, sticky action bars become normal-flow controls, and actions expand to safe touch
targets. Desktop information density remains the primary design target.

## Regression expectations

Automated Admin coverage verifies route-to-module resolution, detail-route behavior, centralized
session expiry, secure document access-grant usage, and the desktop/tablet/mobile breakpoints. The
repository verification and integration suites remain the release gate for this stabilization pass.
This document does not claim a fresh real-browser viewport or complete manual Admin acceptance run.

## Deferred work

The proposed Phase 13 dependency, provider, native-build, production-environment, and release-readiness
work remains explicitly deferred until separately approved.
