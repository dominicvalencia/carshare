# Phase 13B native development-build setup

## Current physical-device acceptance status

**FINAL STATUS: COMPLETE / PHYSICALLY ACCEPTED.** The product owner confirmed all remaining Phase 13B
manual tests PASS on September 6, 2026. Phase 12 remains complete, accepted, and frozen; Phase 13A is
complete; and Phase 13C has not started.

**iOS: PHYSICAL ACCEPTANCE PASS.** On September 5, 2026, the Personal Team-signed CarShare
development client was installed and launched on the paired iPhone 11 named “Dom’s iPhone” running
iOS 26.5. The generated project uses display name `CarShare`, bundle identifier `ph.carshare.mobile`,
custom scheme `carrental`, and deployment target iOS 15.1. Product-owner testing confirmed connection
to the LAN Metro server, successful API data loading, and the complete locally testable physical
acceptance matrix documented in `native-development-build-acceptance.md`.

The same physical session subsequently passed force-close session restoration, persistent logout,
account/cache isolation, renter/owner mode restoration, Face ID cancel/retry and five-minute lock,
all required camera directions, location denial/recovery, network recovery, form/upload lifecycle
transitions, and in-app notification navigation. Eight corrective items found during that session are
implemented in source and await physical-device regression: camera-denial recovery, native date UX,
owner keyboard behavior, root deep-link Back behavior, role-scoped notifications, placeholder
visibility, owner-draft continuity, and return-photo parity. The final physical regression confirmed
all eight corrections and the follow-up navigation, messaging, onboarding, document, and picker work.

A later physical pass confirmed successful deep-link opening and renter/owner notification
separation. It did not accept the deep-link parent-stack transition, role-scoped Messages, owner
onboarding presentation/document clarity, or booking picker consistency. Those areas now have
follow-up source corrections and automated coverage. A subsequent physical iPhone regression accepted
all of them, including natural Back/swipe behavior, role-scoped Messages, guided Owner onboarding,
clear Owner identity-document handling, and the spinner-based Booking date/time presentation. The
supplied recording and screenshot remain evidence of the corrected prior behavior.

**Personal Team notification limitation:** remote APNs Push Notifications cannot be provisioned with
the current Apple Personal Team. Phase 13B local iOS prebuilds therefore remove the `aps-environment`
entitlement in a finalized local config plugin after `expo-notifications` performs its normal native
configuration. The installed and autolinked `expo-notifications` runtime, in-app notification center, and
notification data/query logic remain intact. Remote APNs delivery is excluded from this local iOS
acceptance build and will be tested later with appropriate Apple Developer Program provisioning. Set
`IOS_REMOTE_PUSH_ENABLED=true` only when building with a team and profile that support APNs; remote push
must not be reported as physically accepted until that separate acceptance is complete.

**Android: PHYSICAL ACCEPTANCE PASS.** On September 5–6, 2026, a local CarShare development client was
built with the generated debug key and installed on a physical Samsung SM-A266B running Android
16/API 36. The product owner confirmed the complete locally testable Phase 13B matrix PASS, including
the launcher icon, independent native launch, Metro bundle, development API connectivity, auth and
session behavior, biometrics, camera direction and recovery, location, date/time controls,
keyboard/forms, safe areas/tab layout, role-scoped notifications/messages, deep links and Back
stacks, marketplace and booking/rental flows, inspections, and network/lifecycle recovery.

Physical testing found that forms could not reliably scroll with the keyboard open, the eight-page
renter onboarding shell did not protect its bottom action from the three-button system navigation
inset, and Samsung's external camera application ignored Image Picker's front-camera intent hint for
the selfie. Physical regression has now accepted the onboarding inset and explicit front-facing
Android selfie camera. Physical regression also confirms the keyboard remains open during form
drag/scroll. The resized viewport initially lacked enough content tail to move the final field and
action fully above the keyboard. Shared form scroll containers now retain
`keyboardDismissMode="none"` and dynamically add the reported Android keyboard height to their normal
bottom content padding while the keyboard is visible; the padding returns to normal on keyboard hide.
Focused physical Android regression confirms the complete scroll range now passes.

A later Home-screen regression exposed a duplicated bottom inset: shared tab scenes and the bottom
navigator both consumed the Android navigation-bar inset. Shared `Screen` scenes now leave bottom-inset
ownership to React Navigation, while standalone authentication and onboarding shells continue to
protect their own bottom edge. Physical regression confirms removal of the extra band above renter/
owner tab bars.

The shared keyboard work temporarily caused iOS fields to overscroll out of view because shared
screens combined `KeyboardAvoidingView` padding with native automatic `ScrollView` keyboard insets.
The source correction restores the accepted single iOS automatic-inset path and explicitly keeps the
dynamic keyboard-height padding Android-only. Physical iPhone retest confirmed the overscroll fix but
showed native focus positioning left too little clearance above the keyboard. Shared iOS screens now
add a platform-only 24-point content/indicator inset as a small focus-safe margin; final physical
iPhone regression confirmed that tuning.

`expo-camera` is intentionally isolated to `NativeCameraCapture.android.tsx`; the generic/iOS module
does not import or resolve `ExpoCamera`, and the accepted iOS selfie/document flows continue to use
`expo-image-picker`. This removes the stale iOS development client's native-module lookup without
changing camera direction or requiring an iOS rebuild for this source correction; physical iPhone
retest confirmed that recovery. A future native
prebuild naturally autolinks the declared SDK-compatible dependency.
The responsive Owner Booking Requests status/price row also passed final physical regression.
Universal/app links and real APNs/FCM delivery remain outside this pass.

## Prepared repository state

The mobile app remains on Expo SDK 54 / React Native 0.81.5 and uses Continuous Native Generation;
generated `ios/` and `android/` directories remain ignored. The app now directly installs the
SDK-compatible `expo-dev-client` and `expo-font`, has an `expo-font` plugin, explicit camera/photo
permission copy, and development-only EAS profiles. No production profile, credentials, EAS project,
push credential, store build, or provider was created.

The permanent identifiers are `ph.carshare.mobile` on both platforms and the installed display name is
`CarShare`. The official application icon source is `apps/mobile/assets/carshare-app-icon.png`; Expo
derives the required native launcher sizes from that high-resolution square source. The complete
car-and-wordmark artwork is also the Android standard/fallback icon. The approved transparent
`apps/mobile/assets/carshare-android-adaptive-foreground.png` car symbol is the Android adaptive
foreground over the authoritative `primaryDark` theme color `#0C4E39`, keeping the symbol clear of
launcher masks without distorting it. The custom URL scheme is
`carrental://`; React Navigation and notification taps already recognize it. Universal Links and
Android App Links are intentionally deferred until an approved HTTPS domain and association files
exist. SecureStore, LocalAuthentication, Notifications, Location, Image Picker, Expo Camera, Document Picker, and
the native date picker are already declared dependencies. Document Picker needs no broad storage
permission. Image Picker supplies camera/photo usage descriptions; audio capture is disabled.

## Development environment strategy

The root `.env` is ignored and remains the local source for `EXPO_PUBLIC_API_URL` and optional
`EXPO_PUBLIC_PROJECT_ID`. Keep `.env.example` on `localhost` so it remains portable. Before a physical
device session, determine the Mac's current LAN address and set, for example:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/api/v1
```

The phone and Mac must share a network, the API must listen on `0.0.0.0:3000`, and the firewall must
allow the connection. Restart Metro after changing an `EXPO_PUBLIC_*` value. Never place secrets in
`EXPO_PUBLIC_*`; Expo embeds them in the client. For a future EAS cloud build, create an EAS
`development` environment variable containing a stable HTTPS development API URL. A cloud builder or
installed build cannot use a changing private LAN address reliably. Selecting that stable environment
is outside this pass and is not a staging deployment.

## Local native build path (recommended first)

From the repository root:

```bash
pnpm --filter @carrental/mobile ios:native
pnpm --filter @carrental/mobile android:native
pnpm --filter @carrental/mobile dev:client
```

Expo generates native folders, compiles, installs, and launches. Regenerate/rebuild after native
dependency or app-config changes; JavaScript-only changes need only Metro. Generated projects remain
uncommitted unless a future native customization requires a deliberate policy change.

### iOS physical device

1. Install Xcode 16.1 or newer for SDK 54, accept its license, and install command-line tools and an
   iOS platform runtime.
2. Connect and trust the iPhone, enable Developer Mode, and select it when `ios:native` prompts.
3. In Xcode signing, select the authorized Apple Team for `ph.carshare.mobile`. A free Personal
   Team may support local device development with short-lived provisioning; reliable team distribution
   or EAS internal distribution requires Apple Developer Program access and registered device UDIDs.
4. Do not create distribution certificates. Development signing/provisioning is sufficient.
5. Face ID usage text is configured. Camera, selected-photo, location, and local-notification support
   remain configured by Expo plugins. The Phase 13B Personal Team build omits the APNs entitlement as
   documented above. No associated-domain entitlement is added until a domain exists.

### Android physical device

1. Install Android Studio, SDK Platform/Build Tools (SDK 54 targets Android API 36), platform tools,
   and a compatible JDK; confirm `adb devices` sees the device.
2. Enable Developer options and USB debugging, connect by USB (or pair wireless debugging), authorize
   the Mac, then run `android:native` and choose the device.
3. The local debug keystore is sufficient. Do not create, commit, or expose a production upload key.
4. Expo plugins provide biometric, camera, notification, and foreground-location permissions. Android
   app-link verification is deferred with the HTTPS domain decision.

## Optional EAS development builds

Run from `apps/mobile` only after the user completes Expo account/project setup:

```bash
eas login
eas init
eas build --profile development --platform ios
eas build --profile development --platform android
```

`eas init` will provide the real project ID; review its config diff before committing it. iOS internal
distribution requires Apple account/team access and registered devices. Android's development build
uses internal distribution and development signing. Remote building must not be used until the API URL
is reachable from the installed device and any required EAS environment value is configured. No push
credential setup is part of this pass.

## Minimum pilot device and OS matrix

Do not change deployment targets yet. The generated SDK 54 defaults are the current technical floor:
iOS 15.1 and Android 7/API 24. Validate the practical pilot on:

- one current Face ID iPhone on a current supported iOS release;
- one older available iPhone at or near the supported floor (Touch ID if available);
- one modern Android device with Android 13+ for notification permission behavior;
- one lower/mid-range Android device at the oldest realistically supported pilot OS.

Two devices (one modern iPhone and one modern Android) are the minimum smoke gate; four provide the
recommended pilot matrix. Record build fingerprint/identifier, device, OS, environment, timestamp,
result, and non-secret logs for every run. Execute every item in
`native-development-build-acceptance.md`, including auth/session, biometric cancellation/retry,
SecureStore restart/logout/account isolation, camera direction and denial/recovery, all notification
states and cold-start routing, deep links, lifecycle transitions, network loss/recovery, API outage,
and stale-cache recovery.

## User-owned prerequisites and decisions

- Provide access to an Apple Developer team (or confirm local-only Personal Team testing), connect and
  trust the iPhone, and enable Developer Mode.
- `ph.carshare.mobile` is the approved permanent identifier. Register and sign this identifier with the
  selected Apple team; changing it later would create a different installed app/keychain namespace.
- Connect an Android device and enable/authorize USB or wireless debugging.
- Log in to Expo/EAS and run project registration only if cloud development builds are desired; review
  the generated project ID before it is committed.
- Decide on a stable HTTPS development API host before remote EAS builds or off-LAN testing. Until
  then, use ignored local `.env` LAN configuration and local native builds.
- Production push credentials, associated domains, signing keys, store submission, and production
  certificates remain explicitly deferred.
