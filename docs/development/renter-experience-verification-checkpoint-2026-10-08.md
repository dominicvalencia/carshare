# Renter experience and verification checkpoint — 2026-10-08

This checkpoint records the implemented renter entry, discovery, Trips, and verification experience. Server authority for eligibility, booking, payment, and evidence remains unchanged.

## Authentication and entry

The unauthenticated entry is **Welcome → Create account / Log in**. The main login screen uses credentials only, retains the contextual **Forgot password?** action, and does not expose mobile OTP or general-purpose reset/verification utilities.

Registration is email based. Passwords are 12–128 characters; common passwords and repeated single-character passwords are rejected. There is no artificial uppercase, number, or special-character composition rule.

Forgot Password accepts email only, sends a reset link, and shows **Check your email**. The environment-specific deep link opens **Create new password** without manual token entry. Invalid or expired links have a dedicated state; success shows **Password updated** and returns to Login. Reset tokens remain single-use with the existing 30-minute expiry, and successful reset still revokes existing sessions.

Mobile application schemes are:

| Environment | Scheme             |
| ----------- | ------------------ |
| local       | `carrental`        |
| test        | `carshare-test`    |
| staging     | `carshare-staging` |
| production  | `carshare`         |

## Native splash

Expo's `expo-splash-screen` config plugin uses the existing CarShare app icon on the branded `#F6F7F4` background with `contain` sizing. Startup prevents automatic hiding and hides the native splash only after authentication bootstrapping completes. There is no artificial delay; cold-launch validation must use an installed native build.

## Explore and discovery

Discovery location authority is ordered **USER_SELECTED → DEVICE_LOCATION → FALLBACK**. A manual area wins. Device coordinates are runtime context, not persisted as a permanent manual selection. **Nearby** explicitly switches back to device location. The app does not continuously track location; permission denial, lookup failure, and timeout fall back safely.

The Search sheet is content-measured and capped to the safe viewport with internal scrolling when needed; it does not use an oversized fixed native page-sheet detent. No-results presentation uses a compact white surface with **Change location** as the primary action, optional **Clear filters**, and no redundant **Adjust dates** button because dates remain available through the top search pill.

Explore derives contextual rails without inventing signals. The primary area rail is always first. Secondary rails require at least three unique vehicles and are omitted when they merely repeat the primary set. Implemented truthful signals are price for **Budget-friendly**, category metadata for **SUVs near you**, server-filtered `BATTERY_ELECTRIC` inventory for **EVs near you**, and the existing `NEWEST` sort for **Recently added**. Global filters remain authoritative for the displayed result set. No popularity rail is shown because no supported popularity signal exists.

## Trips

Trips uses a sticky **Current / Upcoming / Past** selector; the dropdown is removed. Loaded bookings are grouped locally while existing card actions remain unchanged.

- Current: `READY_FOR_PICKUP`, `ACTIVE`, `RETURN_PENDING`, `RETURNED`
- Upcoming: `HOLD`, `AWAITING_PAYMENT`, `AWAITING_OWNER`, `CAPTURE_PENDING`, `CONFIRMED`
- Past: `COMPLETED`, `CANCELLED`, `EXPIRED`

Upcoming sections use pickup date ascending; Past sections use return date descending. Historical bookings without pricing remain renderable.

## Shared renter verification flow

Onboarding and **Profile → Verification** use one stable registry and this exact order:

1. `PERSONAL_INFORMATION` — Personal information
2. `CONTACT_VERIFICATION` — Contact verification
3. `RESIDENTIAL_ADDRESS` — Residential address
4. `DRIVERS_LICENSE` — Driver's license
5. `EMERGENCY_CONTACT` — Emergency contact
6. `IDENTITY_DOCUMENTS` — Identity documents
7. `IDENTITY_PHOTOS` — Identity photos
8. `REVIEW` — Review & finish

Visible pager state is separate from persisted completion state. Resume derives the next compatible page from server completion plus the stable registry; page changes commit immediately before animation so header, content, and footer do not drift. Profile reuses the same components and prepopulates authoritative values. It has an Account-style top Back action, no Skip action, and preserves approval/reverification semantics.

Footer rules are: Step 1 has one full-width **Continue** action and no bottom Back; Steps 2–7 have **Back / Continue**; Step 8 has **Back / Submit verification** (or the existing resubmit label). Onboarding retains **Skip onboarding** in its header. Profile top Back exits without changing status or deleting saved data.

### Step behavior

- Personal information: legal first/middle/last name, optional middle name, DOB calendar, and a compact white form card.
- Contact verification: email/mobile status cards, progressively disclosed OTP, compact resend actions, and unchanged verification rules. No development-inbox card is rendered in the current UI.
- Residential address: dependent PSGC region/scope/locality/barangay selectors, renter-entered street/postal code, and adaptive searchable sheets.
- Driver's license: securely stored full number, last-four existing-license presentation, free-text classification, optional restrictions, and shared calendar expiry picker.
- Emergency contact: optional; existing validation, normalization, payload, and storage remain unchanged. Saving it alone does not strengthen KYC or reset an approval.
- Identity documents: the current four required configured evidence items use camera capture, Added/Not added state, secure thumbnails, Retake, immediate SENSITIVE upload, and rear-camera guides.
- Identity photos: `PROFILE_PHOTO` and `SELFIE_WITH_LICENSE` use front-camera guides. `PROFILE_PHOTO` may be the renter avatar. `SELFIE_WITH_LICENSE` remains private verification evidence. Neither flow claims automated face detection, authenticity, or certified liveness.
- Review: summaries follow registry order, include optional Emergency contact as `Not provided` when empty, and Edit returns to the stable target step.

## Evidence compatibility and privacy

Migration `20261008100000_renter_identity_photo_requirements` renames the stable Philippine `SELFIE` definition to `PROFILE_PHOTO` in place so existing foreign keys/history survive, remaps existing document types, and adds required `SELFIE_WITH_LICENSE`. The seed catalog mirrors those definitions.

Uploading `PROFILE_PHOTO` updates the user's avatar file reference. Its authenticated file remains eligible for the renter profile avatar. `SELFIE_WITH_LICENSE` is sensitive/private only. Public and owner projections must never expose private verification evidence; administrative access continues through authorized short-lived file grants.

## Safety boundary

This checkpoint does not make live Maya calls, change credentials, enable Security Deposit settlement execution, or alter booking/payment authority.
