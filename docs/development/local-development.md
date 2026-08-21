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
```

Phase 1 intentionally has no business models or initial migration.

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
