# ADR-0007: Expo React Native toolchain

- Status: Accepted
- Date: 2026-08-19

## Decision

Use Expo's React Native toolchain on its modern React Native architecture, React Navigation for
navigation, and generated native projects only when native configuration requires them. The
architecture does not use Expo Router. Phase 1 pins the supported Expo SDK 55 / React Native 0.83
matrix because the newer React Native 0.85 and 0.86 releases failed production bundling in upstream
`VirtualView` codegen. The dependency should be revisited after that upstream defect is resolved and
the iOS and Android export acceptance check passes.

## Consequences

The team gets repeatable native dependency alignment and build tooling while preserving React Native
modules and React Navigation. Native capabilities requiring custom code will use development builds,
not assume Expo Go support.

## Current compatibility baseline

Phase 12 currently pins Expo SDK 54 and React Native 0.81.5 so the repository matches the Expo Go 54
clients used for pilot device and simulator acceptance. The package manifests and lockfile are the
authoritative current dependency matrix; the SDK 55 choice above records the original Phase 1 decision.
Any future SDK upgrade must realign the complete Expo dependency set and pass iOS and Android export
verification before it replaces this baseline.
