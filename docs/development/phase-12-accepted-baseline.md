# Phase 12 accepted baseline

## Status

- Manual acceptance: **PASSED**
- Final acceptance confirmed by product owner: 4 September 2026
- Pre-marketplace stabilization baseline: `8f003e2` (`Complete Phase 12 acceptance stabilization`)
- Scope status: functionally accepted and frozen; Phase 13 has not started

The product owner completed final manual QA and reported no known blocking functional or UX issue in
the accepted renter, owner, Admin, marketplace, booking, rental, return, KYC, review, Host Profile,
duration-discount, or discovery experience. Future Phase 12 product/UX changes require a discovered
regression; new work belongs to a separately approved phase.

## Manually accepted product areas

- **Identity/account:** registration, skippable renter onboarding, email/mobile verification, renter
  KYC, owner onboarding/verification, and biometric app lock.
- **Vehicles:** creation, photos/documents, pricing and policies, availability, Admin review, and
  vehicle lifecycle.
- **Discovery:** search and filters, cursor/infinite pagination, Vehicle Details, long-booking discount
  presentation, public Host Profile, and distinct vehicle/host reviews.
- **Booking:** authoritative quote and duration discount, immutable pricing snapshot, booking hold,
  development/provider-neutral payment authorization, owner request/acceptance, capture/confirmation
  architecture, cancellation, and expiration.
- **Rental:** pickup inspection/handover/verification, active rental, messaging, two-party return and
  owner receipt confirmation, claim window, completion, inspection corrections, incidents, and
  non-response handling.
- **Post-rental:** claims, disputes, additional charges, double-blind reviews/publication, ratings,
  earnings, and provider-independent payout architecture.
- **Communication:** participant messaging, notifications and badges, role-aware navigation, and review
  notifications.
- **Admin:** desktop SaaS shell, Dashboard, Users/User Detail, renter KYC, Owner Verification, Vehicle
  Review, Bookings, Rental Operations, Claims, payments/payouts, Support, Trust & Safety, Inspection
  Corrections, secure evidence previews, and audited temporary document access.

This acceptance does not certify the fake/development adapters or any unconfigured, sandbox-only, or
uncertified production provider.

Manual acceptance covers registration, contact verification and KYC, owner vehicle setup, discovery,
quote and booking, owner decision, pickup/handover, active rental, and two-party return. The accepted
behavior remains server-authoritative: clients request transitions, PostgreSQL guards invariants, the
transactional outbox records side effects, and workers perform scheduled/retryable processing.

## Regression evidence

The final repository audit on 2 September 2026 produced the following results:

| Check                             | Result                                           |
| --------------------------------- | ------------------------------------------------ |
| `pnpm verify`                     | Passed                                           |
| Formatting and Compose validation | Passed                                           |
| Monorepo lint                     | 18/18 tasks passed                               |
| Monorepo typecheck                | 18/18 tasks passed                               |
| Mobile unit/regression suite      | 20 files, 104 tests passed                       |
| API unit/E2E suite                | 4 files, 9 tests passed                          |
| Worker suite                      | 2 files, 2 tests passed                          |
| Database-backed API integration   | 8 files, 48 tests passed                         |
| Prisma schema validation          | Passed                                           |
| Production builds                 | 11/11 tasks passed                               |
| Expo export                       | iOS and Android bundles passed                   |
| Development database migrations   | 35/35 applied; none pending or unresolved failed |
| Isolated test database migrations | 35/35 applied before integration tests           |
| `pnpm audit --prod`               | 10 advisories: 6 high and 4 moderate             |

The integration suite uses the isolated `carrental_test` database. Direct database arrangements are
limited to test actors/evidence and advancing controlled deadlines; booking, payment, inspection,
handover, return, completion, notification, and financial transitions use HTTP commands, provider
contracts, or the same database procedures invoked by workers.

## Accepted architecture boundaries

- One Expo/React Native application provides renter and owner modes; role changes do not create a
  second identity or bypass API authorization.
- NestJS remains a modular monolith. PostgreSQL/PostGIS is authoritative for durable state and
  invariants; Redis/BullMQ coordinates retryable and scheduled work.
- Booking, payment, inspection, claim, earning, and payout transitions are explicit, audited, and
  idempotent. Immutable evidence and ledger history are not corrected destructively.
- Exact vehicle coordinates, identity evidence, payout identifiers, and storage object keys stay out
  of public projections. Sensitive files require object authorization and short-lived grants.
- In-app notifications are authoritative. Push is additive and does not determine domain state.
- PSGC 2Q 2026 is the accepted bundled Philippine geography reference until a controlled update is
  reviewed and migrated.

## Remaining environment, provider, and device limitations

These items are intentionally outside the accepted Phase 12 claim:

1. **Payments and payouts:** local and automated flows use deterministic fake adapters. Maya/Xendit
   credentials, merchant enablement, signed webhooks, settlement reconciliation, limits, refunds, and
   operating runbooks require sandbox then production certification.
2. **Security deposits:** disabled and fail-closed. Authorization duration, partial capture, release,
   disclosure, disputes, and ledger behavior require an approved provider and legal/finance decisions.
3. **KYC:** document capture and manual administrative review do not imply OCR, authenticity checking,
   face match, or liveness. A production KYC provider and privacy/retention review remain unselected.
4. **Authentication delivery:** local email/SMS tokens use the development delivery adapter and
   in-process inbox. Production email/SMS providers, sender registration, deliverability, abuse controls,
   and recovery operations remain required.
5. **Push notifications:** in-app history is complete, but production Expo/APNs/FCM credentials and
   physical-device token, permission, background delivery, receipt, and deep-link matrices are not
   certified. Expo Go itself has remote-notification limitations.
6. **Mobile devices:** the accepted registration-through-return path was manually exercised on physical
   iOS. Android has export coverage but still needs physical-device acceptance. A native development
   build is required for representative biometrics/app-lock crypto and full notification testing.
7. **Location and maps:** curated Philippine areas and foreground coordinates are used. No production
   geocoder/autocomplete provider, map SLA, or offline behavior is approved.
8. **Media storage:** local secure-file behavior and authorization are covered; production object
   storage, malware scanning, lifecycle/retention, backup, CDN variants, and deletion operations need
   infrastructure and privacy review.
9. **Native end-to-end automation:** no committed Detox/Maestro suite currently protects camera,
   permissions, gestures, browser handoff, notifications, or OS lifecycle behavior.
10. **Operations and compliance:** staging/production infrastructure, secrets/KMS, backups and restore
    drills, monitoring/alerting, incident response, data retention/deletion, legal terms, insurance,
    tax/withholding, and launch support procedures are not represented as complete.
11. **Dependency advisories:** the final audit reports vulnerable transitive versions of `postcss` and
    `image-size` through Expo/Metro, `uuid` and `decode-uri-component` through Expo/navigation tooling,
    and `deepmerge-ts`/`mysql2` through Prisma tooling. The registry reported 6 high and 4 moderate
    advisories. They do not invalidate the completed functional regression, but compatibility-tested
    upgrades or narrowly justified overrides are mandatory before a pilot release. No dependency was
    silently upgraded while freezing this baseline.
12. **Discovery scale:** search currently retrieves at most 500 nearby PostGIS candidates before
    centralized eligibility/filtering and cursor slicing. This is accepted for the current baseline and
    remains a future query-planning/scalability item.
13. **Long rentals and extensions:** maintenance scheduling during an already-active long rental is not
    modeled. Booking-extension commands remain intentionally unimplemented pending occupancy, pricing,
    notification, payment, policy, and legal decisions.

Any work beyond this baseline requires an approved Phase 13 scope. New functionality must not be
silently folded into Phase 12 maintenance.

## Marketplace-completeness addendum (4 September 2026)

Phase 12 now also includes server-cursor vehicle discovery, owner-configured duration discounts,
and double-blind post-rental reviews. These are extensions of the accepted discovery, immutable
pricing, and review models—not Phase 13 release-readiness work.

- Search requests return 10 eligible vehicles by default. An opaque cursor binds the complete
  search criteria and the deterministic sort keys; the mobile list retains loaded pages, requests
  the next page near the end, and retains its offset after viewing a vehicle.
- Duration tiers are 3, 7, 14, and 30 chargeable days. Each tier is optional, bounded from 0% to
  40%, and enabled longer tiers cannot be lower than earlier enabled tiers. Quotes retain the base
  amount and a separate negative discount line. The selected tier, basis points, discount amount,
  base amount, and discounted subtotal are copied into the append-only booking pricing snapshot.
- Vehicle Details advertises only the active policy's positive duration tiers and hides the complete
  section when none exist. Selected-date copy explains qualification without calculating money; the
  server quote remains the only authoritative discount and total.
- Commission remains based on `BookingPricingSnapshot.subtotalMinor`; because that value is now the
  discounted rental subtotal, the platform does not charge commission on the pre-discount amount.
- Reviews remain eligible only after authoritative booking completion and for the configured 14-day
  window. First-side content remains pending and is excluded from public reads and aggregates. Both
  sides publish together when the counterpart submits; otherwise pending content publishes when the
  deadline is processed. Duplicate submission remains protected by the existing unique constraint.
- Public host identity uses `OwnerProfile.publicReference`. Public host and review projections omit
  legal/contact/KYC/payout data, exact vehicle locations, internal owner identifiers, and unpublished
  review content. Public host/vehicle review lists are cursor-paginated.
- Admin User Detail adds aggregate review counts only. Existing permission-gated, audited review
  moderation remains unchanged; ordinary operational views do not expose pending content.

Migrations `20260904090000_phase12_marketplace_completeness` and
`20260904093000_duration_discount_signed_lines` were applied to the local development database. The
first temporarily removes and recreates existing append-only triggers solely while backfilling new
immutable pricing columns; the append-only protections remain active afterward. The second permits a
negative pricing line only for the explicit `DURATION_DISCOUNT` code while preserving line arithmetic
and nonnegative checks for every other charge.

The local development migration ledger retains three explicitly resolved/rolled-back zero-step attempts
for `20260904090000_phase12_marketplace_completeness` from correcting its initial local application.
They are historical audit rows, not unresolved failures: Prisma reports all 35 migrations applied, the
same migration has a later successful row, and the isolated integration database applies the complete
35-migration chain cleanly. These rows were not deleted or rewritten for acceptance cosmetics.

Long-trip operational boundaries remain unchanged: maximum rental duration, mileage inclusion and
excess-distance charging, turnaround buffers, and booking extensions use their existing policies.
Scheduled maintenance during an already-active very long rental is not modeled and remains future
product/operations work. No payment-provider, deposit, or extension behavior was added.

The synchronized cross-domain description is maintained in the
[current system baseline](../architecture/current-system-baseline.md). Exact suite counts belong in
this accepted baseline rather than being copied into every phase guide.
