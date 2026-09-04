# Current system baseline (Phase 12)

This document describes the repository as implemented on 4 September 2026. It is the current
cross-domain reference; the phase guides and ADRs retain the history of how the system arrived here.
Phase 13 is proposed and has **not started**.

## Runtime applications and authority

- One Expo/React Native application supports renter and owner modes for one identity.
- The Next.js Admin application is a routed, desktop-first operations workspace.
- The NestJS modular monolith exposes versioned REST APIs below `/api/v1`.
- PostgreSQL/PostGIS owns durable state, spatial queries, invariants, immutable evidence, and financial
  history. Redis/BullMQ coordinates retryable jobs, reconciliation, notifications, and scheduled work.
- Clients request commands and render projections. They do not decide availability, eligibility,
  prices, booking transitions, payment results, claims, earnings, or payouts.

## Registration and renter verification

Registration creates the account and session. The mobile experience then offers a skippable,
multi-page onboarding flow. Pages share one draft, save the current stage before navigation, and end
with a Review screen; moving between onboarding pages does not itself submit the KYC case.

Rental eligibility requires an active account, verified email, verified Philippine mobile number,
approved legal identity, and an approved unexpired driver licence. The structured workflow captures:

- legal identity and date-only birth information;
- a server-validated Philippine address selected from the bundled PSGC 2Q 2026 reference;
- driver-licence metadata (the full normalized number is hashed and only the last four are projected);
- emergency contact;
- jurisdiction-configured identity documents, captured with the rear camera; and
- a newly captured front-camera selfie.

There is no gallery or file-picker fallback in the renter KYC workflow. Capture being camera-only is
not an authenticity, OCR, face-match, or liveness claim. Local email/SMS verification helpers expose
only the signed-in user's in-memory deliveries when `APP_ENV` is `local` or `test` and
`AUTH_DELIVERY_PROVIDER=development`; production rejects that adapter.

The authoritative case lifecycle is:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
                 \-> MORE_INFORMATION_REQUIRED -> DRAFT
                 \-> REJECTED
APPROVED -> SUSPENDED
```

Admin review uses a dedicated queue and routed detail page. Review start precedes a final decision.
Address assessment records `MATCH`, `POSSIBLE_MATCH`, `MISMATCH`, or `NOT_APPLICABLE`; notes are
mandatory where the API requires them. Relevant legal identity, address, or licence changes invalidate
a non-suspended approval back to `DRAFT`; emergency-contact-only edits do not. Evidence access is
object-authorized through an audited, five-minute temporary grant. Evidence and replaced-document
history are not destructively corrected.

## Owner and vehicle supply

One account may hold both `RENTER` and `OWNER`. Starting owner onboarding grants the capability, while
`OwnerProfile.status` independently controls protected operations. Draft onboarding and vehicle work
remain available before verification; publication and booking acceptance require a verified owner.

Vehicle drafts use platform-managed make, model, category, feature, and document references. Owners
provide specifications, ordered photos, required private documents, an exact private pickup point,
pricing, mileage allowance/overage, fuel or EV return policy, turnaround buffer, weekly availability,
and explicit availability blocks. Policy versions are append-only. Admin vehicle review has explicit
approval, change-request, rejection, suspension, and restoration commands.

Public discovery requires an approved and operationally available vehicle, verified owner, location,
current immutable policy, ready public cover image, and verified/unexpired required documents. Public
vehicle projections contain approximate geography, never exact coordinates, plate/VIN, private
documents, object keys, or owner KYC/contact/payout information.

## Search, availability, and pagination

Search returns 10 vehicles by default and the mobile list incrementally loads the next page near its
end. The opaque cursor contains the deterministic sort position, vehicle-ID tie-breaker, and a
signature of all search criteria. A cursor used with changed criteria is rejected. Mobile query keys
reset pagination when criteria change, prevent duplicate next-page requests, retain loaded pages, and
restore the result-list offset after vehicle detail navigation where the current navigator remains
mounted.

Availability shown by search is advisory. Quote and booking creation revalidate eligibility,
weekly availability, active occupancy, dates, duration, and turnaround. PostgreSQL's partial GiST
exclusion constraint remains the final overlap authority.

The current spatial implementation asks PostGIS for at most 500 nearby candidates before centralized
eligibility/filtering and cursor slicing. This is a future query-planning/scalability item, not a
current functional blocker.

## Duration discounts and immutable pricing

Owners may configure independent tiers for 3+, 7+, 14+, and 30+ chargeable days. Values are integer
basis points, capped at 4,000 (40%). Enabled tiers must be non-decreasing. The longest applicable tier
wins and discounts never stack.

Vehicle Details presents the latest public policy's positive enabled tiers near the daily price and
hides the section when none exist. When dates are selected, it may explain the qualifying tier or days
remaining to the next tier, but it does not calculate peso savings. This is promotional information
only: Check Price always asks the server for the authoritative discount and total.

The API calculates PHP amounts in integer minor units. A quote records base rent and a negative
`DURATION_DISCOUNT` line, plus the selected tier, basis points, savings, and discounted subtotal. Hold
creation copies those values into the append-only booking pricing snapshot. Later owner-policy changes
cannot reprice historical quotes or bookings. Commission uses the discounted snapshot subtotal, so it
is not charged on the pre-discount amount.

Maximum duration, included/excess mileage, and turnaround rules still apply. Booking extensions are
not implemented, and scheduled maintenance during an already-active long rental is not modeled.

## Booking and rental lifecycle

The durable booking states are:

```text
quote (not occupancy)
  -> HOLD -> AWAITING_PAYMENT
  -> payment authorization -> AWAITING_OWNER
  -> owner accepts -> CAPTURE_PENDING -> payment capture -> CONFIRMED
  -> pickup window worker -> READY_FOR_PICKUP
  -> owner pickup inspection -> renter review/acknowledgement and pickup code
  -> verified-owner code consumption -> ACTIVE
  -> renter return evidence -> RETURN_PENDING
  -> independent owner receipt inspection -> owner acknowledgement/disagreement -> RETURNED
  -> claim window elapsed and blockers resolved -> COMPLETED

Cancellation, rejection, expiry, void, incidents, and admin resolution branch from their permitted
states; controllers never assign arbitrary statuses.
```

A hold creates authoritative occupancy through the scheduled end plus the snapshotted turnaround
buffer. Deadlines are stored, not reconstructed from mutable configuration. Scheduled pickup or return
does not prove custody. Non-response jobs notify participants; participant no-show/non-response creates
incidents. Only the audited Admin handover-resolution command may establish custody as an operational
fallback.

Pickup and return inspections are separate immutable participant perspectives. Optional discrepancy
and counter-evidence are additive. Corrections use amendment requests and permissioned Admin review;
the original evidence remains intact. Completion waits for the two-party return requirements and any
claim/dispute/operational blockers.

## Claims, payments, ledger, earnings, and payouts

Rental payment uses provider-neutral authorization, capture, void, refund, and reconciliation
operations. Local/test use deterministic fake adapters; no production payment or payout certification
is claimed. Unknown results remain reconcilable under stable idempotency/provider references.

Claims preserve measured facts and participant evidence. Admin adjudication is immutable; approved
additional charges follow a separate renter-authorized provider payment. Security deposits remain
disabled and fail closed. Posted ledger transactions are immutable and balance by currency. Capture
creates the commission snapshot and pending owner earning; claims/disputes may hold it. After completion
and the safety deadline, eligible earnings become available for controlled, provider-independent payout.
Payout destinations are encrypted/masked, allocations are row-locked, and provider success—not a
redirect or submit response—establishes `PAID`.

## Messaging, notifications, and reputation

Each eligible booking has one participant-scoped conversation with immutable messages and read state.
The mobile Messages tab derives activity badges from authoritative unread summaries. Domain writes and
their transactional outbox events commit together. The worker applies centralized, role-aware templates
and internal deep links. Stable keys make retries idempotent. In-app notifications remain authoritative;
push is additive. Local/test push is fake, and production Expo/APNs/FCM device delivery is not certified.

Review availability is limited to `COMPLETED` bookings and the configured window (14 days by default,
with a database-enforced 14-day maximum): renter reviews vehicle and owner; owner reviews renter.
Overall rating is required; supported category ratings and written feedback are optional. Duplicate
author/type submission is constrained.

```text
first side submits -> PENDING -> hidden from counterpart and public
counterpart submits -> all eligible booking reviews publish together
or deadline expires -> scheduled worker publishes eligible pending reviews
```

Published reviews may still have moderation status `PUBLISHED`, `UNDER_REVIEW`, `HIDDEN`, or `REMOVED`.
Only publication-visible, moderation-published reviews enter public lists and rating aggregates. Review
submission notifies the counterpart without revealing content; publication notifies both participants.
Events use the transactional outbox.

## Public Host Profile and privacy

Vehicle Details links its host card through an opaque `OwnerProfile.publicReference`, never the owner
profile UUID. The public Host Profile may show display identity, verified-host status, hosting/member
since, completed rentals, host rating/count, category averages, cursor-paginated published host reviews,
and that host's currently public vehicles. Vehicle reviews describe the car; host reviews describe the
owner/handover experience and are displayed separately.

The projection excludes legal identity where not intended, email, mobile, address, KYC evidence, payout
data, internal UUIDs, exact pickup coordinates, private vehicle documents, pending/unpublished review
content, and Admin/security data.

## Admin application

The Admin shell provides client-side, bookmarkable navigation for Dashboard, Users and User Detail,
renter and owner verification, vehicle review, bookings, rental operations, claims, payouts, support,
Trust & Safety, inspection corrections, and commission/settings. Queues open dedicated routed detail
pages rather than replacing the queue inline.

The centralized session keeps the access token in React memory and signs out/clears query state on an
API `401`. User Detail separates renter activity/history, owner activity/vehicles, and safe security
context. Evidence tiles use `cover` presentation for photos and `contain` for documents; an explicit
preview obtains the audited five-minute grant and opens the secure lightbox. Renter KYC includes review
start, address assessment, mandatory-note feedback, and final decision. Owner verification, vehicle,
booking, pickup/active/return, claims, payout, support/moderation, and correction workspaces retain API
permission checks and audited commands.

Automated routing/responsive tests exist, but this synchronization does not claim a fresh browser
viewport or end-to-end operator acceptance run.

## Verification and known limitations

The latest verified baseline is recorded in
[Phase 12 accepted baseline](../development/phase-12-accepted-baseline.md). Coverage includes booking
concurrency, search pagination, duration pricing and snapshot immutability, double-blind reviews, public
host privacy, KYC/evidence access, pickup/return, claims, payouts, Admin routing, and access grants.

The repository contains 35 ordered Prisma migration directories. The latest two are
`20260904090000_phase12_marketplace_completeness` and
`20260904093000_duration_discount_signed_lines`. They add owner public references, duration-policy and
immutable quote/booking snapshot fields, review publication timestamps/state, related indexes and
constraints, and the narrowly signed discount-line rule. The marketplace migration temporarily drops
and recreates existing append-only triggers only around its controlled backfill; append-only pricing
protections remain active after application. Already-applied migrations must not be edited.

Remaining work includes production provider certification, physical-device biometric app-lock testing,
physical Android acceptance, production push/email/SMS, production object storage and
retention controls, native camera/permission E2E automation, staging/production operations, and legal,
privacy, insurance, tax, and security review. See the accepted baseline for the complete list.
