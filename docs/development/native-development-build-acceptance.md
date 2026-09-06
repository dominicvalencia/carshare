# Native development-build acceptance plan

## Status and boundary

Phase 13B preparation began September 4, 2026 after Phase 12 acceptance. On September 6, 2026, the
product owner completed the remaining physical regression matrix. **Phase 13B native
development-build acceptance is PASS on both iOS and Android** for the local builds and cases
recorded below. Phase 12 remains complete, accepted, and frozen; Phase 13A is complete; Phase 13B is
complete and physically accepted; and Phase 13C has not started. See
[`phase-13b-native-development-build-setup.md`](phase-13b-native-development-build-setup.md) for build,
environment, signing, device, and user-owned prerequisite instructions.

Remote APNs delivery is excluded from this Personal Team build and is not part of its acceptance. The
in-app notification center and locally generated notification-navigation cases remain testable.

## Final accepted native-development baseline

Physical acceptance covers local iOS and Android development clients; installation and launch;
Metro and LAN API connectivity; authentication, session/logout persistence, account/cache isolation,
and renter/owner restoration; native biometrics and app lock; camera and location permissions with
Settings recovery; front-camera selfie and rear-camera KYC, vehicle, pickup, and return evidence;
native date/time controls; keyboard/forms; renter and owner onboarding; Android safe-area, system
inset, bottom-tab, and adaptive-icon behavior; role-scoped notifications and conversations; tested
custom-scheme deep links and correct Back stacks; marketplace search with incremental cursor loading;
Vehicle Detail, Host Profile, reviews, and duration discounts; quote/booking and responsive Owner
Booking Requests; pickup/handover, return/receipt, and inspection evidence; and tested network-loss,
recovery, background, and foreground lifecycle behavior.

This PASS is limited to the named development builds and devices. It does not certify production or
store distribution/signing, TestFlight or Play rollout, production APNs/FCM delivery, production
payment/payout/KYC/media/geocoding providers, monitoring, staging/production deployment,
backup/recovery operations, security deposits, booking extensions, Universal Links/Android App
Links, legal/privacy/insurance/tax/compliance approval, or compatibility beyond the tested devices.

## Recorded Android physical evidence

On September 5, 2026, foundational smoke testing passed on a physical Samsung SM-A266B running Android
16/API 36 with the local CarShare Expo Development Client (`ph.carshare.mobile`). The launcher icon,
native launch independent of Expo Go, Metro/JavaScript loading, local development API connectivity,
login, Android biometric authentication, and camera availability are physically confirmed PASS.

**Android Phase 13B physical acceptance is PASS.** Final product-owner regression confirms the
renter-onboarding bottom inset, explicit front-facing selfie camera, rear-camera evidence flows,
keyboard persistence during drag/scroll, full keyboard-open scroll range, removal of the duplicated
inset above the shared renter/owner tab bar, native date/time and permission behavior, role-scoped
notifications/messages, deep links and Back stacks, marketplace/vehicle/Host flows, booking through
return operations, network/lifecycle recovery, adaptive icon, and responsive Owner Booking Requests.

A temporary iOS regression then exposed duplicate shared-screen keyboard compensation: both
`KeyboardAvoidingView` padding and native automatic `ScrollView` keyboard insets were active. The
shared screen now keeps only the previously accepted native automatic inset path on iOS, while the
Android-only dynamic tail remains isolated. Physical iPhone retest confirmed the overscroll was
removed but found the native minimum clearance too tight. Shared iOS screens now provide a small
24-point base content/indicator inset so native focus scrolling leaves a comfortable keyboard gap
without restoring duplicate avoidance. Final physical regression confirmed this tuning.

A narrow Android owner Booking Requests card issue found during physical acceptance was corrected
with the standard card inset and a wrapping status/price row; final physical regression passed.

Adding the Android selfie camera initially caused the previously installed iOS client to report
`Cannot find native module ExpoCamera` because a platform-neutral module imported the new native
dependency. The implementation is now platform-isolated: Android imports `expo-camera`, while iOS
retains its accepted `expo-image-picker` path and does not resolve `ExpoCamera`. Physical iPhone
regression confirmed recovery without an iOS rebuild.

## Recorded iOS physical evidence

- [x] Personal Team-signed native CarShare development client installs and launches.
- [x] Development client connects to the LAN Metro server.
- [x] The installed client reaches the LAN API and loads API-backed data.
- [x] A normal login succeeds.
- [x] A normal Face ID unlock succeeds.
- [x] At least one camera flow opens and captures successfully.
- [x] Force-close restores the authenticated session.
- [x] Logout remains cleared after force-close.
- [x] Account switching does not leak cached account data.
- [x] Renter-to-owner mode selection restores correctly.
- [x] Face ID cancellation remains locked and explicit retry succeeds.
- [x] Five-minute inactivity triggers the lifecycle lock.
- [x] Correct camera direction was observed for KYC documents, selfie, vehicle photos, pickup
      inspection, and return inspection.
- [x] Location denial and later Settings recovery succeed.
- [x] Network loss and recovery succeed.
- [x] Background/foreground transitions during forms and uploads succeed.
- [x] In-app notification navigation succeeds.
- [x] Deep-link parent stacks, Back, and interactive swipe-back behave like normal in-app navigation.
- [x] Renter/owner notification and conversation projections, unread counts, and role switching remain
      isolated.
- [x] Owner onboarding, owner-document guidance, booking date/time pickers, and return evidence pass
      physical regression.
- [x] Complete the locally testable detailed iOS cases below and assign iOS Phase 13B PASS.

### September 5 stabilization findings

Physical testing found eight issues: camera-denial recovery, inconsistent booking/date-picker UX,
owner-form keyboard jumps, root deep-link Back handling, cross-role notifications, invisible iOS
placeholders, owner-onboarding draft discrepancies, and return-photo UX inconsistency. Source fixes now:

- centralize camera authorization and route non-requestable denial to the app's Settings page;
- use the native community date picker for both bounded date-only and date-time controls, dismissing
  the keyboard before presentation and retaining cancel-safe draft values;
- avoid applying both iOS keyboard padding and automatic scroll insets to shared long forms;
- fall back to `Marketplace` when a deep-linked screen has no stack history;
- persist explicit `ACCOUNT`, `RENTER`, or `OWNER` notification audiences and scope list, summary,
  and read-all operations to the active role plus account-wide notices;
- use one accessible placeholder color token across shared and feature-owned text inputs;
- hydrate owner-onboarding fields from the server and save before every forward transition; and
- reuse the pickup secure-photo-slot interaction for return evidence.

These corrections were subsequently accepted in physical-device regression. Remote APNs remains
excluded.

The subsequent September 5 physical regression confirmed that deep-link destinations open and that
dual-role notification separation works. Evidence from the remaining navigation recording showed
that the former fallback placed Marketplace over an orphaned detail route rather than constructing a
normal parent stack. A screenshot also confirmed that booking dates still used an unreadable inline
calendar instead of the accepted DOB/license spinner presentation. The follow-up stabilization now
constructs a parent tab beneath cold deep-link destinations, scopes booking conversations and unread
counts by participant context, uses matching light-themed spinner sheets for date and date-time
fields, and brings owner onboarding/document guidance into the guided card/progress/review system.
The product owner subsequently confirmed all five follow-up areas on the physical iPhone: deep-link
parent/back stacks, role-scoped Messages, Owner onboarding presentation, Owner document clarity, and
Booking picker consistency are PASS.

### Final iOS acceptance boundary

The accepted application is CarShare (`ph.carshare.mobile`), built as a local Expo Development Client
and signed with Apple Development using Dom Valencia (Personal Team). Physical acceptance covers
installation/launch, Metro and LAN API connectivity, auth/session isolation, Face ID lock behavior,
camera direction and permission recovery, location denial/recovery, native date/time controls,
keyboard/forms, lifecycle/network recovery, locally testable deep links and notification navigation,
role-scoped notifications and Messages, Owner onboarding, and return-inspection evidence.

This is not App Store or production readiness. The Personal Team build intentionally omits
`aps-environment`; real APNs foreground/background/terminated delivery, production push credentials,
and Expo remote-push provider behavior remain excluded. Also deferred are distribution signing,
TestFlight, Universal Links/Associated Domains/production HTTPS links, production providers and
infrastructure, monitoring/deployment, security deposits, booking extensions, and legal/privacy/
insurance/tax/compliance approval.

Legend:

- **P12 accepted:** behavior is accepted at the current functional/API/export boundary.
- **Native validation:** repeat on signed physical-device development builds.
- **Provider validation:** requires configured production-like or certified external infrastructure.

## Auth, session, and secure storage

- [x] Native validation — login, logout persistence, and accepted session restoration paths.
- [x] Native validation — session restoration after cold restart and background termination.
- [x] Native validation — renter/owner account and mode switching without query/cache leakage.
- [x] Native validation — tested SecureStore persistence, logout cleanup, and account isolation paths.
- Deferred — reinstall-specific Keychain/Android-storage semantics outside the tested device paths.
- [x] Android foundational smoke — login and API connectivity on Samsung SM-A266B.
- [x] Android stabilization regression — keyboard persistence and dynamically extended keyboard-open
      scroll range physically confirmed, including last-field/action reach.
- [x] iOS stabilization regression — overscroll removal and 24-point shared focus clearance.
- P12 accepted — server reloads current session/account/roles; mobile refresh tokens use SecureStore.

## Biometrics and app lifecycle lock

- [x] Native validation — Face ID normal unlock on the accepted iPhone 11 build.
- [x] Native validation — cancelled/failed prompt remains locked; explicit retry succeeds.
- [x] Native validation — logout/account switching does not inherit another account's lock.
- [x] Native validation — five-minute background inactivity locks and foreground unlocks correctly.
- P12 accepted — biometric matching belongs to the OS; there is no custom PIN fallback or biometric
  template stored by the app.
- [x] Android foundational smoke — OS biometric authentication is available and succeeds.

## Camera and evidence

- [x] Native validation — renter front-camera selfie and rear-camera KYC documents.
- [x] Native validation — vehicle photos/documents and pickup/return inspection perspectives.
- [x] Native validation — camera denial guidance, Settings grant, recovery without reinstall, direction,
      preview/retake, and accepted upload/network paths on iPhone 11.
- P12 accepted — renter KYC is camera-only and evidence remains object-authorized/immutable.
- Provider validation — malware scanning, durable object storage, retention/deletion, backups, and
  production media variants.
- [x] Android foundational smoke — camera opens on the physical Samsung device.
- [x] Android stabilization regression — selfie uses the explicit front camera.
- [x] Android stabilization regression — documents, vehicle, pickup, and return evidence use the rear
      camera.

## Push, badges, and notification navigation

- [ ] Native validation — permission request and denied-permission in-app behavior.
- [ ] Native validation — foreground, background, and terminated-app delivery.
- [x] Native validation — locally testable in-app notification navigation.
- [x] Native validation — role-scoped badge/read state and notification navigation.
- [x] Native validation — renter/owner mode is preserved or deliberately changed by an allowed route.
- P12 accepted — in-app rows/outbox idempotency and role-aware internal routing.
- Provider validation — Expo/APNs/FCM credentials, token lifecycle, receipts, retry classification, and
  production delivery monitoring.

## Deep links

- [ ] Native validation — email verification links from installed mail clients.
- [x] Native validation — tested booking, conversation, claim, support, notification, vehicle, and Host
      Profile destinations, including parent stacks, Back, and interactive swipe-back.
- Provider validation — production universal/app-link domains, association files, and delivery URLs.

## Resilience and lifecycle matrix

- [x] Native validation — foreground/background/termination/restart across tested critical forms.
- [x] Native validation — network loss and recovery during tested login, KYC upload, quote, booking, pickup,
      return, messaging, and notification refresh.
- [ ] Native validation — stale-cache recovery after server-side lifecycle or policy changes.
- [ ] Native validation — supported OS/device matrix, accessibility, memory pressure, and low-end Android.
- P12 accepted — authoritative HTTP/domain behavior, retry/idempotency foundations, and iOS/Android
  production exports.

## Exit evidence

Record build identifiers, device/OS versions, environment, provider configuration, timestamps,
screenshots/log correlation IDs without secrets, pass/fail/owner, and linked defects. Native acceptance
does not imply production provider certification; provider acceptance requires separate sandbox/live
evidence and operational sign-off.
