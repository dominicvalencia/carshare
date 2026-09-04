# Local development

## Environment

Copy `.env.example` to `.env`. Local values are deliberately non-secret and must never be reused in
staging or production. Environment parsing fails fast when required database or Redis URLs are absent
or malformed.

## Start infrastructure

```bash
pnpm dev:infra
docker compose ps
```

Both `postgres` and `redis` should report `healthy`.

## Prepare Prisma

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
```

The current Phase 12 schema is managed by committed migrations. The seed synchronizes the bundled PSGC
reference and vehicle make/model/category data before creating idempotent local configuration and pilot
data. The current baseline contains 35 migration directories; confirm the live database rather than
assuming the count with `pnpm db:migrate:deploy`. For a complete clean-machine walkthrough, see
[New Mac development setup](new-mac-setup.md).

## Start applications

```bash
pnpm dev
```

Turbo starts the API, worker, admin, and mobile development servers in parallel. To run one process:

```bash
pnpm --filter @carrental/api dev
pnpm --filter @carrental/workers dev
pnpm --filter @carrental/admin-web dev
pnpm --filter @carrental/mobile dev
```

## Stop infrastructure

```bash
pnpm dev:infra:down
```

Named volumes preserve local database and Redis data. Removing volumes is intentionally not included
in standard scripts because it is destructive.

For current domain behavior, migrations, tests, and provider limitations, see the
[current system baseline](../architecture/current-system-baseline.md) and
[accepted Phase 12 baseline](phase-12-accepted-baseline.md).
