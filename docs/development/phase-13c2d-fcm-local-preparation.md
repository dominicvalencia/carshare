# Phase 13C-2D Firebase / FCM local push preparation

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / PHYSICAL ANDROID FCM CERTIFICATION PASS**.

## Pilot architecture

CarShare keeps `expo-notifications` and Expo Push Service. Domain events create role-scoped in-app
notifications and push deliveries; workers call the shared `PushProvider`; `ExpoPushProvider` sends
Expo tokens to Expo, which forwards Android delivery through FCM v1. Direct Firebase calls and a
second mobile messaging SDK are intentionally not introduced.

## Firebase client configuration and identities

The local development identity remains `ph.carshare.mobile`, matching the registered Firebase
Android app. The downloaded client file is local build input and must be stored at
`.data/firebase/local/google-services.json`, referenced with
`EXPO_ANDROID_GOOGLE_SERVICES_FILE=.data/firebase/local/google-services.json`. The ignored file is
not committed. `EXPO_ANDROID_FIREBASE_ENV=local` must match `EXPO_PUBLIC_APP_ENV=local`.

The dynamic Expo config reads the environment-provided `EXPO_PUBLIC_PROJECT_ID` and emits it at both
`extra.eas.projectId` (the EAS project-linking contract) and the existing runtime `extra.projectId`.
The UUID is not hardcoded. Non-local profiles declare `EXPO_PUBLIC_PROJECT_ENV`, which must match the
mobile application environment before a project ID is accepted.

Staging uses `ph.carshare.mobile.staging` and requires a distinct Firebase Android app/configuration.
It must not reuse the local/production-identifier client file. A single Firebase project with
separate Android apps is adequate for the pilot, although separate projects provide stronger
credential, quota, and operational isolation for production.

The client JSON registers the native Android application with Firebase; it is not the FCM v1 server
credential. Expo Push Service delivery additionally requires an FCM v1 service-account key uploaded
to the matching Android application in EAS credentials. That private key must never enter Git or an
`EXPO_PUBLIC_*` variable.

The configured client-file path is resolved from the repository root, not from `apps/mobile`.
Configuration now fails clearly if the resolved file does not exist. Expo Continuous Native
Generation copies that ignored input to `android/app/google-services.json`, declares
`com.google.gms:google-services:4.4.1`, and applies `com.google.gms.google-services` to the app
module. Generated `apps/mobile/android` output remains ignored and must not be maintained manually.

Local Android generation and builds require JDK 17. Set `JAVA_HOME` from the installed JDK before
running Expo/Gradle; do not change the Gradle toolchain to accommodate Android Studio's Java 25
runtime:

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

## Physical registration finding

The first Firebase-enabled Samsung build launched, but registered no token. Android logs reported
that the default Firebase app had no options and that the Google Services Gradle plugin had not been
applied. Inspection confirmed that generated `android/app/google-services.json`, the Google Services
classpath, and the app-module plugin application were all absent from that installed build's native
generation. No certification push was sent. A clean CNG regeneration from the corrected source
configuration contains all three and successfully runs `:app:processDebugGoogleServices`. The
subsequent native Android rebuild initialized Firebase and passed physical token registration and
background-delivery certification.

## Token, permission, and routing safety

The mobile app creates the Android notification channel before requesting a token, requests Android
13+ permission only while the OS allows another prompt, remains usable after denial, and refreshes
registration when the native push token changes. Settings remains the recovery path after a final
denial. Expo tokens are persisted with user/session, platform, environment, app identifier, status,
last-seen and disabled timestamps. Replacement, logout/session revocation, environment separation,
and permanent invalid-token disabling already exist.

Notification taps accept only CarShare schemes and approved targets. The controlled certification
uses `carrental://notifications`, title `CarShare push certification`, and body
`Push notification delivery is configured correctly.` The atomic ignored marker
`.data/provider-certifications/push-local.sent` prevents a second accepted send and stores neither
the token nor provider ticket.

## Local Android physical certification

Phase 13C-2D local Android certification passed on the controlled Samsung handset. The corrected
Firebase-enabled development build installed and launched, the controlled account authenticated,
and the previously granted Android notification permission remained active. Native logs confirmed
successful default Firebase initialization. The mobile client registered an active Expo token in
the local database with provider `EXPO`, platform `ANDROID`, environment `local`, application
identifier `ph.carshare.mobile`, and status `ACTIVE`.

One controlled certification command sent the fixed non-sensitive payload through the local API,
the shared `PushProvider`, Expo Push Service, and the EAS-configured FCM v1 credential. Exactly one
notification arrived while CarShare was backgrounded; its title and body matched the certification
payload and no duplicate was observed. The certification switch and normal push-delivery switch
were then disabled and the provider restored to `fake` in ignored local configuration.

## Acceptance boundary

This PASS certifies `CarShare local API -> PushProvider abstraction -> Expo Push Service -> FCM v1
-> physical Android Samsung handset`, including native Firebase initialization, active token
registration, background delivery, and exactly-once observed receipt. It does not certify iOS APNs,
production FCM, a staging Firebase application, direct FCM architecture, public staging, or
production push operations. The Personal Team iOS plugin continues to omit `aps-environment`.
