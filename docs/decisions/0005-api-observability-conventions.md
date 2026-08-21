# ADR-0005: versioned API and observability conventions

- Status: Accepted
- Date: 2026-08-19

## Decision

Expose REST endpoints below `/api/v1`, generate OpenAPI documentation, and use standardized success
and error envelopes. Accept or generate a safe `x-correlation-id`, return it to callers, attach it to
request context, and include it in structured Pino logs. Logs redact credential and token fields.

## Consequences

Clients receive stable machine-readable errors. Requests can be traced across future API, outbox, and
worker activity without relying on sensitive log content.
