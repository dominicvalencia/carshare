# ADR 0008: Identity, rotating sessions, and administrative access

## Status

Accepted for Phase 2.

## Decision

Use one `users` identity table for consumers and administrators. Capabilities are normalized through
`roles`/`user_roles`; administrative permissions use `permissions`/`role_permissions`. `OWNER` is a
stable capability while `owner_profiles.status` independently controls operational eligibility.

Passwords use Argon2id. Access JWTs last 15 minutes and contain only subject, session ID, roles, and
standard timing/issuer/audience claims. Every protected request reloads the current session, account
status, roles, and permissions. Mobile refresh tokens use SecureStore; admin web refresh tokens use an
HttpOnly, SameSite=Strict cookie. Access tokens remain in memory.

Refresh tokens are 256-bit opaque values stored only as HMAC-SHA-256 hashes. Every refresh consumes
the current record and creates a replacement in one transaction. Presenting a consumed token revokes
the entire session family. Password reset also revokes all active sessions.

Email, SMS, object storage, and verification providers are interfaces. Development delivery adapters
log masked delivery events but never credentials, OTPs, or raw tokens. Sensitive files are stored
outside PostgreSQL and require an authenticated ownership or administrative permission check for each
read.

## Consequences

- A role change or suspension takes effect without waiting for JWT expiry.
- Administrative identities share hardening and session controls without a second account system.
- Adding MFA, social login, external KYC, cloud storage, or production delivery vendors does not
  require changing the core identity model.
- Active session-family state is authoritative; JWTs alone are insufficient for sensitive access.
