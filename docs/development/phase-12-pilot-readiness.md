# Phase 12: pilot readiness

Phase 12 hardens the existing modular monolith and single React Native application for a controlled
development pilot. It does not select a production payment, payout, push, or geocoding provider and
does not change the authoritative financial or booking state machines.

## Changes

- A dedicated API integration scenario now traverses public search, authoritative quote creation,
  booking hold, rental-payment authorization, the owner request queue, owner acceptance and capture,
  pickup inspection and code verification, active rental, secure booking messaging, return inspection,
  renter confirmation, claim-window completion, the earning safety hold, earning availability, and a
  post-completion review.
- Booking projections include a short-lived signed grant for the public vehicle cover photo. Booking,
  owner-request, and active-rental screens render that projection through Expo Image and fall back to
  bundled artwork only when a grant is unavailable or fails.
- Owner fleet projections include short-lived grants created only after the service has authorized the
  owning user. Object keys and unrestricted object URLs are not returned.
- The renter quote card now shows the vehicle, dates, approximate pickup area, daily rate, authoritative
  quote lines, duration, and final PHP amount. Reservation and payment authorization remain distinct
  actions. An expired or stale quote can be refreshed.
- Owner booking requests now have loading, empty, error/retry, filtered list, detail, verification,
  deadline, price, capture explanation, and confirmation states.
- Fleet cards now show a thumbnail, readable lifecycle and operational states, location, and daily rate.
  The editor uses a compact step count and progress bar instead of a clipped horizontal step strip, and
  its review step summarizes the listing. Previous/Continue controls remain in a persistent action bar
  above the mode navigation on long forms.
- Pickup and return forms use kilometers for human input while converting to the server's exact meter
  transport field. They show guided photo progress and readable perspectives. Calculations remain
  exclusively server-side.
- Earnings, payout destinations, claims, and common domain values use centralized product-language
  labels. Payout identifiers remain masked.
- The TanStack Query client is scoped to the authenticated principal. Logging out and signing in as a
  different account replaces the complete query cache, preventing owner/renter projections from one
  account appearing in another account's UI.
- OWNER capability and owner operational verification are again separate. A DRAFT, PENDING, REJECTED,
  or VERIFIED owner profile may build a vehicle draft; publication, booking acceptance, and operational
  listing actions still require VERIFIED status. SUSPENDED owners cannot edit drafts.

## Defects found and fixed

1. The app-level query cache survived account changes. This explained the contradictory Phase 11
   screenshot in which a DRAFT owner header appeared with another session's approved fleet. The domain
   seed was not granting approved vehicles to a DRAFT owner; this was presentation cache leakage.
2. Vehicle creation and all draft-editing endpoints incorrectly used the VERIFIED operational guard,
   contradicting ADR 0003 and the approved role/status model. Draft work now uses a separate capability
   guard; submission still uses the operational guard.
3. The discovery CTA advanced a hold to `AWAITING_PAYMENT` but did not call the payment authorization
   endpoint. It now performs both legitimate server actions and opens a provider action URL when one is
   returned.
4. Mobile booking types ignored the cover-photo grant already present in the API projection, causing
   local fallback artwork on every booking.
5. Mobile payment presentation searched for the obsolete purpose `RENTAL_PAYMENT` instead of the
   canonical `RENTAL` value.
6. Development reseeding attempted to update append-only vehicle policy version 1. The second seed was
   rejected by PostgreSQL. The initializer now creates a missing immutable version and leaves an
   existing snapshot untouched. Two consecutive local seed runs are part of verification.
7. A previously rejected or suspended demo owner profile could be set to VERIFIED without clearing its
   stale reason/timestamp fields. The idempotent demo initializer now restores the complete coherent
   verified profile.
8. Vehicle availability and owner-earning availability both use the raw value `AVAILABLE`. A shared
   presentation map rendered fleet vehicles as "Available for payout." Context-specific vehicle and
   finance label maps now preserve their distinct product meanings, with a regression test.
9. The earnings summary implied payout eligibility while payout setup was incomplete. Its copy now says
   an available balance _can_ enter the next eligible payout and leaves eligibility authoritative to the
   payout projection.

## Pilot accounts and data

Run `pnpm db:seed`. Demo data is skipped when `APP_ENV=test` or `SEED_DEMO_DATA=false`.

| Mode                 | Email                        | Password             | Expected state                         |
| -------------------- | ---------------------------- | -------------------- | -------------------------------------- |
| Renter               | `renter@demo.carrental.ph`   | `CarRentalDemo2026!` | verified email, RENTER                 |
| Verified owner       | `owner@demo.carrental.ph`    | `CarRentalDemo2026!` | RENTER + OWNER, VERIFIED owner profile |
| Dual-role acceptance | `dualrole@demo.carrental.ph` | `CarRentalDemo2026!` | RENTER + OWNER, VERIFIED owner profile |

The verified owner has seven stable vehicles and the dual-role acceptance account has one. All eight
are approved and operationally available across Metro Manila, Cebu, Davao, Iloilo, and Baguio. This
split makes the own-vehicle exclusion easy to verify manually: the dual-role account cannot discover
its Nissan Leaf in renter mode but can discover vehicles belonging to the other owner. Each listing has
a public cover photo, private exact location, applicable fuel or EV return policy, mileage policy,
turnaround buffer, immutable PHP daily price, verified required vehicle documents, and rating
projection. The seed never mutates an existing immutable policy version.

## Manual acceptance follow-up

- Mobile authentication restores the refresh token before protected queries run. A coordinated refresh
  handles concurrent access-token expiry, retries each failed protected request once, and clears both
  SecureStore and principal-scoped query state when the session is truly invalid.
- Owner dashboard errors replace metrics rather than leaving cached counts visible beneath an
  authentication error.
- Public discovery excludes the authenticated user's own listings at the eligibility query before
  sorting, cursors, and pagination. Anonymous discovery remains unchanged. Authenticated own-listing
  detail is not public to that owner in renter mode, while quote creation and booking holds return the
  explicit `OWNER_CANNOT_BOOK_OWN_VEHICLE` domain error.
- Registration validates email and password input, prevents duplicate submits, converts transport
  failures to readable messages, and uses a non-rejecting press handler so an `ApiError` is never left as
  an unhandled promise.
- Search results and vehicle detail have compact upper-left back/edit controls that preserve the in-memory
  location, dates, radius, filters, and cached result data. Date icons and the price-check
  call to action have additional narrow-screen spacing.
- The search filter sheet no longer emits a raw native text node. Bookings use one accessible compact
  status menu instead of a wrapped row of large chips.

## Automated pilot scenario

The scenario in `apps/api/test/bookings.integration.test.ts` uses direct database writes only to arrange
isolated actors/listing evidence and to move the test clock past the 24-hour claim and earning-safety
deadlines. It never writes a booking, payment, inspection, completion, earning, message, or review state
to fake success. Those transitions occur through the real HTTP endpoints, provider abstraction, or the
same PostgreSQL lifecycle procedures invoked by the worker.

Verified path:

```text
public discovery
→ authoritative PHP quote (3 days, 450 km included)
→ HOLD
→ AWAITING_PAYMENT
→ payment AUTHORIZED
→ AWAITING_OWNER
→ owner acceptance
→ payment CAPTURED
→ CONFIRMED / READY_FOR_PICKUP
→ pickup inspection + renter code
→ ACTIVE
→ return inspection + renter agreement
→ RETURNED
→ claim deadline elapsed with no claim
→ COMPLETED
→ earning safety deadline elapsed
→ earning AVAILABLE
→ eligible review submitted
```

The same test rejects unrelated booking access, a review before completion, an unverified-owner accept,
and a duplicate owner accept. Existing suites continue to cover 100-renter overlap races, expired holds,
owner rejection and authorization voiding, unknown provider responses and reconciliation, inspection
code failures, claim/completion races, EV return evidence, owner-block races, additional-charge approval,
refund idempotency, payout allocation/settlement, message privacy, duplicate notifications, and review
moderation.

## Financial and security checks

- The rental total comes from the immutable quote/pricing snapshot and remains PHP minor units.
- The fake payment provider is exercised through the production provider interface. Acceptance captures
  the already authorized rental payment; rejection/expiry uses void rather than capture/refund.
- Commission snapshot and owner earning are created by capture finalization. The scenario verifies the
  earning remains PENDING through completion and becomes AVAILABLE only through the safety-hold release
  procedure.
- Every ledger transaction selected for the scenario has entries summing to zero. Existing tests also
  reject ledger and snapshot mutation, reject unbalanced posting, prevent duplicate capture/refund, and
  prove payout settlement balancing.
- The security-deposit abstraction remains disabled/deferred; Phase 12 does not invent provider-specific
  authorization or capture semantics.
- Public vehicle projections continue to omit exact coordinates, plate, VIN, owner legal data, file
  object keys, and sensitive documents. Participant file access remains object-authorized. Owner payout
  responses contain only masked destination identifiers.

## Verification commands

```bash
pnpm db:generate
pnpm db:seed
pnpm test:integration
pnpm verify
pnpm --filter @carrental/mobile build
```

Final Phase 12 verification passed:

- `pnpm verify`: formatting, Compose validation, 18/18 lint tasks, 18/18 typecheck tasks, 16 unit/E2E
  test files with 32 tests, Prisma validation, and 11/11 build tasks.
- `pnpm test:integration`: 7 files and 39 tests, including the complete pilot lifecycle.
- Expo production export: iOS and Android Hermes bundles plus 26 assets.
- Next.js admin, NestJS API, worker, database, and shared-package builds all completed.

Visual inspection was performed in Expo Go on an iPhone 17 Pro simulator and an iPhone SE (3rd
generation) simulator. Inspected states included renter home, search results, vehicle detail and price
CTA, bookings, profile, owner dashboard, fleet, wizard, booking requests, active-rental empty state,
earnings/payouts, and owner More. Pickup/return and populated booking-detail states were verified through
the HTTP integration scenario and exported bundle, not manually replayed as a complete simulator rental.
Android was export/build verified only because no Android emulator was available.

## Remaining boundaries

- Payment and payout run against deterministic fake providers for local and automated testing. A
  production provider, deposit capabilities, webhook secrets, settlement timing, and reconciliation
  operating procedures still require explicit approval.
- Search uses curated Philippine areas or foreground device coordinates. A production geocoding and
  autocomplete provider remains intentionally unselected; the exact stored vehicle point remains private.
- Push delivery uses the existing provider abstraction. Real Expo credentials and physical-device token,
  delivery, receipt, permission, and deep-link behavior require device testing.
- No Detox or Maestro native-E2E framework existed in the repository, so Phase 12 does not add dependency
  churn solely for this hardening pass. The complete lifecycle is automated at the HTTP/domain boundary;
  exported mobile bundles and representative simulator screens are verified separately. Physical iOS and
  Android camera, document picker, location permission, notification, and payment-browser flows remain
  required before a public pilot.
- The bundled fallback vehicle image is intentionally used only when a listing has no usable projection;
  production media variants/CDN optimization remain provider work.

No ADR was added: Phase 12 restores conformance to existing ADRs and adds presentation/readiness fixes,
not a new architectural decision.
