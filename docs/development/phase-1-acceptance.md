# Phase 1 acceptance checklist

> Historical Phase 1 acceptance criteria. Statements about absent business features and unregistered
> queues describe that phase only; they are not the current repository capability set. See the
> [current system baseline](../architecture/current-system-baseline.md).

- [ ] `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- [ ] `pnpm format:check` succeeds.
- [ ] `pnpm lint` succeeds with no warnings.
- [ ] `pnpm typecheck` succeeds.
- [ ] `pnpm test` succeeds.
- [ ] `pnpm db:validate` and `pnpm db:generate` succeed.
- [ ] `pnpm infra:validate` verifies required services, health checks, and volumes.
- [ ] `pnpm build` builds all four applications and shared runtime packages.
- [ ] Docker Compose starts healthy PostgreSQL and Redis containers.
- [ ] API `/api/v1/health/live` returns the success envelope.
- [ ] API `/api/v1/health/ready` reports PostgreSQL and Redis as up.
- [ ] API response includes `x-correlation-id`, preserving a valid caller-provided ID.
- [ ] Unknown API route returns the standardized error envelope.
- [ ] Swagger UI and OpenAPI JSON are reachable.
- [ ] Worker connects to Redis and states that no business queues are registered.
- [ ] Admin application renders the Phase 1 foundation panel.
- [ ] Mobile application switches between compact renter and owner navigation shells.
- [ ] No authentication, booking, payment, payout, or marketplace business feature exists.
