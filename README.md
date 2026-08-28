# Car Rental Platform

Production-oriented monorepo foundation for a Philippines peer-to-peer car rental marketplace.
Phase 1 contains platform tooling and infrastructure. Phase 2 adds authentication, identity, rotating
sessions, role/permission authorization, secure file access, owner onboarding, and the administrative
owner-verification foundation. Phase 3 adds verified-owner fleet drafts, structured vehicle listings,
PostGIS-ready private locations, versioned vehicle policies, secure media/documents, availability
blocks, and permissioned administrative review. Phase 4 adds privacy-safe public discovery,
favorites, advisory availability, and immutable pricing quotes. Phase 5 converts quotes into
authoritative checkout holds, protects unified vehicle occupancy with PostgreSQL, and adds safe
booking lifecycle foundations. Phase 6 adds provider-independent rental authorization and capture,
the Maya hosted-checkout adapter, reconciliation, immutable double-entry accounting, versioned
commission snapshots, and pending owner earnings. Phase 7 adds secure pickup verification, immutable
pickup/return inspections, active-rental operations, measured usage, the 24-hour claim window,
incident escalation, and safe automatic completion. Phase 8 adds controlled post-return claims,
renter responses and disputes, immutable admin adjudication,
formula-backed additional charges, provider-aware collection/refunds, earning holds, safe booking
completion, and the `PENDING` to `AVAILABLE` earning transition. Phase 9 adds controlled,
provider-independent owner payout settlement. Phase 10 adds booking conversations, in-app and push
notifications, verified-rental reviews and rating projections, support tickets, and report-led
moderation.

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

See [local development](docs/development/local-development.md), the
[new Mac setup guide](docs/development/new-mac-setup.md), the
[Phase 1 acceptance checklist](docs/development/phase-1-acceptance.md), and the
[Phase 5 booking engine guide](docs/development/phase-5-booking-engine.md), and the
[Phase 6 payments and ledger guide](docs/development/phase-6-payments-ledger.md), and the
[Phase 7 rental operations guide](docs/development/phase-7-rental-operations.md), and the
[Phase 8 claims and financial resolution guide](docs/development/phase-8-claims-financial-resolution.md), and the
[Phase 9 owner payouts guide](docs/development/phase-9-owner-payouts.md), the
[Phase 10 marketplace experience guide](docs/development/phase-10-marketplace-experience.md), and the
[architecture decisions](docs/decisions/README.md).
