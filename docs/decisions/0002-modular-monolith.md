# ADR-0002: NestJS modular monolith

- Status: Accepted
- Date: 2026-08-19
- Implementation note: the transactional outbox and separate worker process described as future work
  below are implemented in the current Phase 12 baseline.

## Decision

Deploy one NestJS API composed of strongly separated domain modules. Background workers are a
separate process from the same codebase and consume retry-safe work published through a future
transactional outbox.

## Consequences

The MVP retains transactional consistency and low operational overhead. Module ownership and
application interfaces must prevent the monolith from becoming tightly coupled.
