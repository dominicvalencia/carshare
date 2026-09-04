# Phase 13B native development-build setup

## Prepared repository state

The mobile app remains on Expo SDK 54 / React Native 0.81.5 and uses Continuous Native Generation;
generated `ios/` and `android/` directories remain ignored. The app now directly installs the
SDK-compatible `expo-dev-client` and `expo-font`, has an `expo-font` plugin, explicit camera/photo
permission copy, and development-only EAS profiles. No production profile, credentials, EAS project,
push credential, store build, or provider was created.

Identifiers remain `ph.com.carrental.mobile` on both platforms. The custom URL scheme is
`carrental://`; React Navigation and notification taps already recognize it. Universal Links and
Android App Links are intentionally deferred until an approved HTTPS domain and association files
exist. SecureStore, LocalAuthentication, Notifications, Location, Image Picker, Document Picker, and
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
3. In Xcode signing, select the authorized Apple Team for `ph.com.carrental.mobile`. A free Personal
   Team may support local device development with short-lived provisioning; reliable team distribution
   or EAS internal distribution requires Apple Developer Program access and registered device UDIDs.
4. Do not create distribution certificates. Development signing/provisioning is sufficient.
5. Face ID usage text is configured. Camera, selected-photo, location, and notification permissions
   are configured by Expo plugins. No associated-domain entitlement is added until a domain exists.

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
- Confirm that `ph.com.carrental.mobile` is the intended development identifier before registering it
  with Apple or EAS. Changing it later creates a different installed app/keychain namespace.
- Connect an Android device and enable/authorize USB or wireless debugging.
- Log in to Expo/EAS and run project registration only if cloud development builds are desired; review
  the generated project ID before it is committed.
- Decide on a stable HTTPS development API host before remote EAS builds or off-LAN testing. Until
  then, use ignored local `.env` LAN configuration and local native builds.
- Production push credentials, associated domains, signing keys, store submission, and production
  certificates remain explicitly deferred.
