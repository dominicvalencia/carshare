# ADR-0001: pnpm and Turborepo monorepo

- Status: Accepted
- Date: 2026-08-19

## Decision

Use pnpm workspaces for dependency management and Turborepo for dependency-aware tasks. Applications
and reusable packages remain independently buildable while sharing one pinned toolchain and lockfile.

## Consequences

Workspace boundaries are explicit. CI can cache build results, and shared changes trigger dependent
checks. Packages must declare their dependencies rather than relying on hoisting.
