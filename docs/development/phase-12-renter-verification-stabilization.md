# Phase 12 renter verification and pilot stabilization

This continuation remains within Phase 12. It adds the missing renter rental-eligibility control and
stabilizes existing booking, messaging, notification, availability, pickup, return, and owner dashboard
paths. It does not begin Phase 13 and does not enable security deposits.

## Authoritative renter gate

Public discovery and authoritative PHP quotes remain informational. `POST /bookings` evaluates renter
eligibility inside the serializable booking transaction before idempotency, snapshots, occupancy, or a
booking record is created. Payment authorization evaluates it again. Authorization finalization also
rechecks it before `AWAITING_OWNER`; if eligibility was lost, the rental authorization enters the
existing controlled void path, the booking is cancelled, and occupancy is released.

The mobile onboarding flow collects legal profile, Philippine address, driver-license metadata,
emergency contact, and the active jurisdiction-configured document checklist. The complete license
number is normalized and hashed; only its last four characters are retained for review display.

Pilot document requirements are seeded as data: driver-license front/back, additional government ID,
proof of address, and a newly captured selfie. Accepted MIME types and maximum bytes are enforced by
the API. All evidence must be a READY, SENSITIVE file owned by the renter. Every renter-verification
document is camera-only in the mobile workflow: IDs and proof of address default to the rear camera,
the selfie defaults to the front camera, and every capture has preview, Retake, and Use photo steps.
Permission denial explains the requirement and links to system Settings; there is no gallery, photo
library, file-picker, or silent fallback. Camera capture is not represented as proof of authenticity or
liveness.

Admin review is available in the existing admin application. Dedicated read/review/suspend/document
permissions are assigned to ADMIN and SUPER_ADMIN, not SUPPORT. Every review transition is audited.
Owners see only the privacy-safe trust projection described in ADR 0018.

## Phase 12 KYC hardening addendum

The mobile workflow now persists four structured profile draft stages, then proceeds through identity
documents, camera-only selfie capture, and an explicit review/submit screen. Date-only identity values
use native date pickers and canonical `YYYY-MM-DD` API values. Material legal identity, residential
address, or driver changes reset non-suspended approvals to `DRAFT`; emergency contact changes alone do
not remove approval. An approved renter must acknowledge that consequence before editing.

Residential geography comes from the official PSA **PSGC 2Q 2026** workbook, current as of 30 June 2026. A controlled normalizer creates `packages/database/reference/psgc-2q-2026.json`; a transactional
sync upserts the platform-owned PostgreSQL reference. Runtime mobile requests never call PSA. Region,
scope, locality, and barangay codes are persisted and validated authoritatively, including independent
cities and official special geographic groupings. Selecting an ancestor resets incompatible descendants.

Admin KYC detail presents the renter-entered address beside authorized, short-lived access to relevant
private documents. Staff must record `MATCH`, `POSSIBLE_MATCH`, `MISMATCH`, or `NOT_APPLICABLE` before
approval. Notes are mandatory for possible matches and mismatches. This is a manual assessment; no OCR,
document-authenticity, face-match, or liveness provider is implied.

The current optional local app lock is biometric-only as specified by ADR 0025. It stores account-scoped
enablement/inactivity state in SecureStore and delegates authentication to the operating system. Its
five-minute background policy gates protected mobile content without changing API session expiry. The
former custom PIN/PBKDF2 implementation and benchmark switch are not present; legacy PIN records are
deleted during storage loading so they cannot trap a user.

## Contact verification and local manual testing

The Contact Information card shows the account email, email verification status, Philippine mobile
entry, and mobile verification status. A changed mobile number is normalized server-side and clears
the previous verification timestamp before a fresh OTP is issued. Booking eligibility continues to
read these authoritative contact timestamps.

For a new, non-demo account in a local development build:

1. Register, open **Profile → Verification**, and tap **Verify email**.
2. Tap **Open local verification inbox**, then **Use latest email token**, and **Confirm email**.
3. Enter a Philippine number such as `09171234567` and tap **Send verification code**.
4. Reopen the local inbox, tap **Use latest mobile code**, and tap **Verify mobile**.

The viewer calls authenticated `GET /api/v1/development/auth-deliveries` and returns only deliveries
whose normalized recipient belongs to the signed-in account. It exists in the app only when `__DEV__`
is true and the API returns data only when `APP_ENV` is `local` or `test` and
`AUTH_DELIVERY_PROVIDER=development`. Production configuration rejects the development provider.
Tokens and OTPs are held in process memory, remain subject to the existing expiry, attempt, and
cooldown rules, and are never written to normal delivery logs. Restarting the API clears the viewer.

## Refresh, messaging, notification, and availability

- Booking, booking-request, owner dashboard, and active-rental queries refresh on screen focus and app
  foreground. Five-second polling is bounded to transitional states and stops for stable states.
- Successful booking, owner-decision, pickup, and return actions invalidate the renter detail/list,
  owner detail/list/dashboard, and public availability projections they can affect.
- A new message writes one recipient-targeted transactional-outbox event in the same transaction as the
  immutable message. Idempotent retries do not notify twice, and the sender is never the recipient.
- In-app notification rows parse allow-listed internal deep links and navigate inside the existing
  navigator. Claim links use the claim ID, not the booking ID. Missing/stale targets show a readable
  unavailable state.
- Authoritative availability excludes active blocking occupancy, including booking holds and the
  snapshotted turnaround buffer. UI invalidation improves freshness but never replaces PostgreSQL
  exclusion protection.

## Two-party handover and event timeline

Pickup remains owner evidence → renter review/code → verified-owner code consumption → `ACTIVE`.
The pickup call to action uses the configured early/grace window projection; the scheduled time is not
presented as proof that handover is already available.

Return is renter evidence → independent owner receipt inspection → owner acknowledgement/disagreement
→ `RETURNED`. The renter and owner each upload guided photos and exact odometer plus fuel/SOC readings
to separate immutable inspection versions. The owner then agrees with or disputes the renter's primary
record. The booking row is locked and completion requires both RENTER and OWNER confirmation roles on
that record. A disagreement opens the controlled dispute and earning-hold path; neither participant can
enter a charge amount.

Scheduled pickup and return never establish custody automatically. Pickup-window and return-confirmation
overdue jobs notify both participants, while explicit no-show/owner-nonresponse actions create incidents.
The audited, permissioned admin command is the only fallback that may establish physical handover or
return. See ADR 0013.

Both renter and owner booking details show only persisted booking-history events. The UI does not
manufacture future timeline steps.

## Security-deposit readiness (disabled)

`SECURITY_DEPOSIT_ENABLED=false` remains mandatory; configuration fails closed if it is set true. No
deposit authorization, partial capture, release, or provider-specific behavior is implemented.

Before a provider can be approved for deposits, it must demonstrably support:

1. A deposit authorization financially separate from the captured rental payment.
2. A hold duration that safely covers the scheduled rental, 24-hour claim window, and resolution path,
   or a compliant reauthorization strategy that never hides a lapse.
3. Platform-controlled partial capture and release/void; vehicle owners must have no capture capability.
4. Admin-approved additional-charge evidence as the only source of a capture amount during MVP.
5. Stable provider identifiers, idempotency keys, signed webhooks, unknown-state reconciliation, and
   duplicate/out-of-order event handling.
6. Separate immutable payment records and balanced double-entry ledger postings for authorization,
   capture, release, reversal, and refund outcomes.
7. Documented 3DS/SCA, card-network, expiry, multi-currency (PHP), dispute, and authorization-extension
   behavior for Philippine merchants.
8. Tokenized payment data so the platform never stores PAN/CVV, plus approved operational runbooks,
   monitoring, alerting, and manual recovery procedures.

Provider selection and approval must explicitly decide authorization duration, partial-capture
semantics, release timing, failed-release recovery, and renter disclosure before the flag can change.

## Local pilot accounts

After `pnpm db:seed`, the renter, owner, and dual-role demo users have verified email/mobile and approved
identity plus valid driver-license verification so they can execute booking scenarios:

| Mode      | Email                        | Password             |
| --------- | ---------------------------- | -------------------- |
| Renter    | `renter@demo.carrental.ph`   | `CarRentalDemo2026!` |
| Owner     | `owner@demo.carrental.ph`    | `CarRentalDemo2026!` |
| Dual role | `dualrole@demo.carrental.ph` | `CarRentalDemo2026!` |

Newly registered users remain unverified and can be used to test the onboarding gate.
