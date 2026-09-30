# Car Rental Platform

Production-oriented monorepo for a Philippines peer-to-peer car rental marketplace. The implemented
current baseline includes identity and renter/owner KYC, structured vehicle supply, privacy-safe
cursor-paginated discovery, immutable pricing and duration discounts, authoritative booking and
occupancy, provider-independent payments/ledger/payouts, two-party pickup and return, claims,
messaging/notifications, double-blind reviews, public Host Profiles, cancellation settlement, Change
Booking for pre-trip changes and active extensions, and routed Admin operations.

Provider integrations remain abstractions or development adapters unless explicitly documented.
Security deposits are disabled. See the
[documentation index](docs/README.md), the
[current system baseline](docs/architecture/current-system-baseline.md), and the
[accepted Phase 12 baseline](docs/development/phase-12-accepted-baseline.md) for historical verification
and known limitations.

## Applications

- `apps/mobile` — one Expo/React Native application with modular renter and owner modes
- `apps/admin-web` — Next.js administrative application
- `apps/api` — NestJS modular monolith API
- `apps/workers` — BullMQ lifecycle, reconciliation, outbox, domain-event, and notification workers

## Requirements

- Node.js 24 LTS
- Corepack
- Docker Desktop or another Docker Compose-compatible runtime

## Local setup

On a new Mac, follow the [new Mac setup guide](docs/development/new-mac-setup.md), or after installing
Xcode/Homebrew and cloning the private repository run:

```bash
bash tooling/setup-new-mac.sh --start
```

Manual equivalent:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
cp .env.example .env
pnpm install
pnpm db:generate
pnpm dev:infra
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Services:

- Admin: http://localhost:3001
- API: http://localhost:3000/api/v1/health
- Swagger: http://localhost:3000/docs
- Metro: http://localhost:8081
- PostgreSQL 17 + PostGIS 3.5: localhost:5432
- Redis: localhost:6379

Use `i` or `a` in the Expo terminal to launch an available iOS simulator or Android emulator. A
physical device must use a LAN-reachable value for `EXPO_PUBLIC_API_URL`; `localhost` refers to the
device itself.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm db:validate
pnpm build
```

Run the complete CI-equivalent sequence with `pnpm verify`.

See the [documentation index](docs/README.md), [local development](docs/development/local-development.md), the
[new Mac setup guide](docs/development/new-mac-setup.md), the
[current system baseline](docs/architecture/current-system-baseline.md), the
[Phase 1 acceptance checklist](docs/development/phase-1-acceptance.md), and the
[Phase 5 booking engine guide](docs/development/phase-5-booking-engine.md), and the
[Phase 6 payments and ledger guide](docs/development/phase-6-payments-ledger.md), and the
[Phase 7 rental operations guide](docs/development/phase-7-rental-operations.md), and the
[Phase 8 claims and financial resolution guide](docs/development/phase-8-claims-financial-resolution.md), and the
[Phase 9 owner payouts guide](docs/development/phase-9-owner-payouts.md), the
[Phase 10 marketplace experience guide](docs/development/phase-10-marketplace-experience.md), and the
[Phase 11 mobile product UX guide](docs/development/phase-11-mobile-product-ux.md), the
[accepted Phase 12 baseline](docs/development/phase-12-accepted-baseline.md), the
[proposed Phase 13 plan](docs/development/phase-13-proposal.md), the
[native development-build acceptance plan](docs/development/native-development-build-acceptance.md), the
[Admin UX stabilization baseline](docs/development/admin-ux-stabilization.md), and the
[architecture decisions](docs/decisions/README.md). Current domain references include
[booking lifecycle and cancellation](docs/architecture/booking-lifecycle-and-cancellation.md),
[Change Booking](docs/architecture/change-booking.md), and
[payments, refunds, ledger, and payouts](docs/architecture/payments-refunds-ledger.md).
