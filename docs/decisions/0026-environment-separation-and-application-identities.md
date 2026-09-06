# ADR 0026: Environment separation and application identities

## Status

Accepted for Phase 13C-1.

## Decision

CarShare has four explicit application environments: `local`, `test`, `staging`, and
`production`. Staging and production use separate API, database, Redis, object-storage, and Admin
origins. Runtime environment markers must agree; non-local services reject loopback/private hosts
and non-TLS Redis endpoints.

The accepted local native build remains `CarShare`, identifier `ph.carshare.mobile`, and scheme
`carrental`. Staging is `CarShare Staging`, `ph.carshare.mobile.staging`, and
`carshare-staging`. Production is `CarShare`, `ph.carshare.mobile`, and `carshare`. The local
exception preserves the Phase 13B build and does not authorize local data or credentials in
production.

EAS profiles describe development, staging, and production build intent. Deployable staging and
production origins are supplied by protected build environments and are not committed.

## Consequences

Staging is visibly identifiable in the Account screen and Admin console. Configuration fails when
the declared application and API/data environments disagree. Infrastructure remains deferred.
