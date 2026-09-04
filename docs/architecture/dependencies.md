# Direct dependency inventory

## Workspace

| Dependency                 | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| pnpm                       | Strict monorepo package management and deterministic lockfile |
| Turborepo                  | Cached dependency-aware workspace tasks                       |
| TypeScript                 | Strict static typing across applications and packages         |
| ESLint / typescript-eslint | Static correctness and code-quality rules                     |
| Prettier                   | Deterministic source formatting                               |
| Vitest                     | Fast unit and integration test runner                         |

## Mobile

| Dependency                  | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| Expo / React Native / React | iOS and Android runtime and toolchain          |
| React Navigation            | Mode-specific tabs and nested stack navigation |
| TanStack Query              | Server-state request lifecycle and caching     |
| Zustand                     | Local application state                        |
| React Hook Form / Zod       | Typed forms and validation                     |
| Safe Area Context / Screens | Native navigation layout and screen primitives |

## Admin

| Dependency              | Purpose                                |
| ----------------------- | -------------------------------------- |
| Next.js / React         | Administrative web runtime             |
| TanStack Query          | Server-state management                |
| React Hook Form / Zod   | Typed operational forms and validation |
| Testing Library / jsdom | Accessible component testing           |

## API and workers

| Dependency                          | Purpose                                               |
| ----------------------------------- | ----------------------------------------------------- |
| NestJS                              | Modular monolith framework and dependency injection   |
| Nest Config                         | Validated runtime configuration integration           |
| Nest Swagger                        | OpenAPI generation and documentation                  |
| Nest Terminus                       | Health endpoint metadata and future health indicators |
| Prisma / PostgreSQL adapter         | Typed PostgreSQL access and migrations                |
| ioredis                             | Redis connectivity                                    |
| BullMQ                              | Retryable domain, lifecycle, and notification jobs    |
| Pino / nestjs-pino                  | Structured application and request logging            |
| Helmet                              | Secure HTTP response headers                          |
| class-validator / class-transformer | Nest request DTO validation foundation                |
| Supertest                           | HTTP integration testing                              |

Exact versions are pinned in each `package.json` and resolved transitively in `pnpm-lock.yaml`.
