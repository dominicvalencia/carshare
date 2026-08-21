# Phase 3 vehicle supply

## Scope

Phase 3 provides owner fleet management and administrative listing review. It does not expose public
search, create booking/reservation rows, quote checkout pricing, or create financial activity.

## Local infrastructure

The PostgreSQL image is built locally from `postgres:17-alpine3.21` with PostGIS 3.5. Alpine 3.21 is
pinned because its extension package targets PostgreSQL 17 on both Apple Silicon and x86. The image
copies extension artifacts into the official PostgreSQL image's `/usr/local` extension paths.

```bash
pnpm dev:infra
pnpm db:migrate:deploy
pnpm db:seed
```

The migration enables `postgis` and `btree_gist`, generates geography points from private
coordinates, creates the spatial index, and enforces non-overlapping active owner blocks.

## Owner workflow

Only `OWNER` users with a `VERIFIED` owner profile can mutate fleet supply. The mobile Vehicles tab
supports a resumable server-side draft through details, features, photos, documents, location,
pricing/usage policies, availability, and review/submission. Five perspectives are required:
front, rear, driver side, passenger side, and dashboard/interior. One must be the cover.

Philippine seed data currently marks CR, current registration evidence/OR, and insurance evidence as
required. These are platform-managed definitions, not hard-coded legal conclusions; operations can
change active/required definitions without a schema migration.

## File handling

Draft/review photos are `PRIVATE`; approval promotes active photos to `PUBLIC`, and suspension,
change requests, or archive returns them to `PRIVATE`. Vehicle documents are always `SENSITIVE`.
The API never returns storage object keys. Content requires an authorized request or a five-minute
bearer grant issued after authorization. Vehicle document grants require `vehicles.review`.

## Policy rules

- Currency is PHP and amounts are integer centavos.
- Turnaround presets are 120, 240, 360, 720, or 1440 minutes.
- Limited mileage requires included km per chargeable day and centavos per whole excess km.
- Battery-electric vehicles require an EV policy; other MVP powertrains require a fuel policy.
- Weekly availability must contain at least one available day.
- Each accepted change inserts a new immutable aggregate policy version.

## Verification

```bash
pnpm db:validate
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:integration
pnpm verify
```

The Phase 3 integration scenario uses real PostgreSQL/PostGIS and Redis and exercises owner
verification, vehicle completion, secure files, submission, change request, correction,
resubmission, approval, publication behavior, and suspension/restoration.
