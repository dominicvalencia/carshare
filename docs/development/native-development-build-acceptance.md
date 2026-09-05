# Native development-build acceptance plan

## Status and boundary

Phase 13B preparation began September 4, 2026 after Phase 12 acceptance. On September 5, 2026, the
product owner completed the physical regression matrix using a Personal Team-signed CarShare
development client on an iPhone 11 running iOS 26.5. **Phase 13B iOS native development-build
acceptance is PASS** for the locally signed build and the cases recorded below. See
[`phase-13b-native-development-build-setup.md`](phase-13b-native-development-build-setup.md) for build,
environment, signing, device, and user-owned prerequisite instructions. Phase 13C and later remain
deferred.

Remote APNs delivery is excluded from this Personal Team build and is not part of its acceptance. The
in-app notification center and locally generated notification-navigation cases remain testable.

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

These corrections require a new physical-device regression run. They are **not yet physically
accepted**, and iOS Phase 13B remains in progress. Remote APNs remains excluded.

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
- [ ] Native validation — SecureStore persistence, logout cleanup, account isolation, and reinstall
      behavior appropriate to iOS Keychain and Android storage semantics.
- P12 accepted — server reloads current session/account/roles; mobile refresh tokens use SecureStore.

## Biometrics and app lifecycle lock

- [x] Native validation — Face ID normal unlock on the accepted iPhone 11 build.
- [x] Native validation — cancelled/failed prompt remains locked; explicit retry succeeds.
- [ ] Native validation — logout/account switching cannot inherit another account's lock.
- [x] Native validation — five-minute background inactivity locks and foreground unlocks correctly.
- P12 accepted — biometric matching belongs to the OS; there is no custom PIN fallback or biometric
  template stored by the app.

## Camera and evidence

- [x] Native validation — renter front-camera selfie and rear-camera KYC documents.
- [x] Native validation — vehicle photos/documents and pickup/return inspection perspectives.
- [x] Native validation — camera denial guidance, Settings grant, recovery without reinstall, direction,
      preview/retake, and accepted upload/network paths on iPhone 11.
- P12 accepted — renter KYC is camera-only and evidence remains object-authorized/immutable.
- Provider validation — malware scanning, durable object storage, retention/deletion, backups, and
  production media variants.

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
