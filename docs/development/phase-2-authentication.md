# Phase 2 authentication and identity

## Local setup

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev:infra
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

To bootstrap a local super administrator, temporarily set `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` in `.env`, run `pnpm db:seed`, then remove the plaintext seed password from the
file. The password must contain at least 12 characters.

## Token policy

- Access token: 15 minutes; minimal claims; current session/account/authorization is reloaded.
- Refresh session: 30-day absolute lifetime; rotating opaque token; HMAC hash at rest.
- Email verification: 24 hours and single use.
- Password reset: 30 minutes and single use; completion revokes all sessions.
- OTP: 10 minutes, five attempts, and a 60-second resend cooldown.

Refresh replay is treated as possible theft. The server revokes every token in that session family,
records `TOKEN_REUSE_DETECTED`, and requires a new login.

## Development providers

Development email/SMS adapters record only masked delivery events. They deliberately do not log raw
tokens or OTPs. Automated integration tests replace these adapters with in-memory capture providers.
Production deployments must bind external delivery and object-storage providers before accepting
real users.

## Verification

```bash
pnpm test
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm build
pnpm db:validate
```

The integration suite uses actual PostgreSQL and Redis and exercises registration, generic login
failures, email verification, refresh rotation/replay, device sessions, OTP, password reset, sensitive
files, owner onboarding/resubmission, admin approval/rejection/suspension, and owner eligibility.
