# ADR 0027: Secret management and provider activation

## Status

Accepted for Phase 13C-1.

## Decision

Secrets never use `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*`, never enter source control, and are injected
from each environment's managed secret store. Public variables are limited to non-secret origins,
environment/release labels, project identifiers, client maps tokens, payment public keys, and public
observability DSNs.

External integrations are opt-in. `PAYMENTS_ENABLED`, `PAYOUTS_ENABLED`, `PUSH_ENABLED`,
`AUTH_DELIVERY_ENABLED`, and `OBSERVABILITY_ENABLED` default to false. Credentials are required
only when their integration/provider is enabled. KYC remains manual; email, SMS, and geocoding
default to disabled. Staging payments and payouts remain sandbox/test-only.

The primary owner administers production secrets and alerts. Rotation is required after exposure,
access changes, provider replacement, and at least every 90 days for high-impact secrets.

## Consequences

Inventories contain metadata, never values. Rotation follows create, deploy, verify, revoke, record.
A public environment variable is treated as disclosed.
