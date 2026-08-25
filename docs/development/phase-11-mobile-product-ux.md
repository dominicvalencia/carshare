# Phase 11 — Mobile product UX

## Information architecture

The product remains one Expo/React Native application. Renter mode uses Home, Search, Bookings,
Messages, and Profile tabs. Owner mode uses Dashboard, Vehicles, Requests, Messages, and More.
Favorites and owner finances are intentionally secondary destinations. Profile is a menu into
personal information, verification, active devices, notifications, support, settings, and guided
owner onboarding. Owner More links to active rentals, earnings/payouts, owner profile, notifications,
support, settings, and the renter-mode switch.

Owner role and verification remain separate. Draft owners may onboard and create vehicle drafts;
verified status is required for publication and booking-request operations. UI gating complements,
but never replaces, server authorization.

## Design system

`apps/mobile/src/theme/tokens.ts` defines the green marketplace palette, semantic colors, spacing,
radii, typography, and card shadow. `apps/mobile/src/ui` owns safe-area/keyboard-aware screens,
buttons, icon buttons, fields, chips, badges, cards, empty/error/loading states, date/time inputs, and
formatters. All icon-only actions have accessibility labels and 44-point targets.

The generated `apps/mobile/assets/demo-vehicle.png` is original project artwork. Public API photo
grants remain the primary source; the local asset handles missing or expired development imagery.

## Location and date/time UX

The app never asks a renter or owner to type coordinates. A development-safe resolver offers several
Philippine areas and foreground device location. The resolved coordinates are private transport data.
It is not a production geocoder and should be replaced behind the same boundary when a provider is
selected. No city, including Lucena, is an architectural default.

Dates and times use native iOS/Android selectors and Philippine display formatting. ISO conversion is
restricted to API request construction. The client checks that return follows pickup; all availability,
duration, buffer, occupancy, and pricing decisions remain server-authoritative.

## Presentation mappings

Booking enums are not altered. Examples include `AWAITING_OWNER` → “Waiting for owner”,
`CAPTURE_PENDING` → “Confirming payment”, `READY_FOR_PICKUP` → “Ready for pickup”, and
`RETURN_PENDING` → “Return being confirmed”. Booking detail displays actual history as a visual
timeline. Checkout calls the quote a confirmed price, explains its expiry, and states that checking a
price does not reserve the car.

## Development demo data

`pnpm db:seed` creates reference data plus idempotent demo accounts and eight realistic Philippine
listings when `APP_ENV` is not `test` and `SEED_DEMO_DATA` is not `false`. It writes public demo-image
objects and sensitive placeholder vehicle-document objects to the local storage root. These records
are not test fixtures.

Integration tests create, migrate, and seed the isolated database in `TEST_DATABASE_URL` before running, so
their concurrency vehicle names cannot appear in the development marketplace schema.

Demo sign-in:

- `renter@demo.carrental.ph` / `CarRentalDemo2026!`
- `owner@demo.carrental.ph` / `CarRentalDemo2026!`

Set `SEED_DEMO_DATA=false` to seed only platform/reference configuration. Never enable demo data in a
shared or production environment.

## Development-only controls

The application contains no floating developer gear or developer route. Expo Go/dev-client controls
belong to the development runtime and are absent from exported production bundles. Native developer
menus remain available through platform gestures in development.

## Accessibility and behavior

Major screens intentionally cover loading, empty, error, and retry states. Long titles and prices use
bounded layouts and truncation. Lists use `FlatList` where result/message volume may grow. Forms are
keyboard-aware, use appropriate keyboard types, disable duplicate submission, and show contextual
errors. Critical status information includes text and is never color-only.

## Known development limitations

- Curated locations and device coordinates are not full address search or geocoding.
- Booking projections do not yet include vehicle photo grants, so booking cards use the project demo
  image fallback.
- Existing owner operations panels preserve Phase 7–9 controls and have received safe-area and copy
  improvements; a future phase can further split their long operational forms without changing APIs.
