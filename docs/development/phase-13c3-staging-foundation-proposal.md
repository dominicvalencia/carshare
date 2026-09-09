# Phase 13C-3 — Isolated Staging Infrastructure and Deployment Foundation

Status: **PROPOSED — OWNER APPROVAL REQUIRED**

This document is a planning contract. No infrastructure, DNS, account, credential, deployment, or
provider callback has been created or changed. Implementation must not begin until the approval gate
in this document is satisfied.

## Purpose and boundary

Create a reproducible, isolated, public-HTTPS staging environment that can be deployed from a
committed SHA, health checked, migrated, monitored, backed up, restored, rolled back, or
forward-fixed without depending on developer-local state.

Phase 13C-3 covers staging infrastructure, deployment mechanics, environment isolation, access,
secrets, operational telemetry, recovery rehearsal, and staging application connectivity. It does
not certify provider callbacks or production use. Production infrastructure, production data,
production credentials, production provider activation, marketplace features, direct FCM,
automatic KYC, App Store/Play Store release, and Phase 13C-4 or later are non-scope.

## Fixed decisions

The following accepted decisions remain unchanged:

| Area                 | Decision                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| Cloud and region     | DigitalOcean, Singapore                                                      |
| Mobile identity      | `CarShare Staging`, `ph.carshare.mobile.staging`, `carshare-staging`         |
| Pilot geography      | Lucena City and Metro Manila                                                 |
| Support hours        | 08:00–18:00 Asia/Manila                                                      |
| Initial alert owner  | Primary owner                                                                |
| Recovery targets     | RPO at most 1 hour; RTO at most 4 hours; not yet validated                   |
| Payments and payouts | Sandbox/test only                                                            |
| KYC                  | Manual                                                                       |
| Data                 | Synthetic unless separately approved                                         |
| Budget guardrail     | PHP 10,000 initial; PHP 6,000 monthly target; PHP 8,000 monthly soft ceiling |

## Owner decisions required

Before provisioning, the owner must approve:

1. A controlled base domain and the exact staging hostnames.
2. The recommended DigitalOcean topology and monthly spending envelope.
3. Named human and automation principals, including the break-glass custodian.
4. DigitalOcean App Platform and protected CI/EAS environments as the authoritative secret stores.
5. Backup retention and whether an additional exported database backup is required.
6. Whether first-stage staging excludes SMS until the `CarShare` Sender Name is approved, or waits
   for Semaphore physical certification.
7. The implementation slices and the rule that infrastructure acceptance remains separate from
   provider certification.

## Canonical origins and domains

The repository contains no evidence of a project-controlled domain. The recommended structure is
therefore a template, not an assertion of ownership:

| Purpose                    | Proposed value                                            |
| -------------------------- | --------------------------------------------------------- |
| API canonical origin       | `https://api-staging.<controlled-domain>`                 |
| Admin canonical origin     | `https://admin-staging.<controlled-domain>`               |
| Future app/universal links | `https://links-staging.<controlled-domain>`               |
| Provider callback base     | `https://api-staging.<controlled-domain>/api/v1/webhooks` |

Only the exact Admin origin should be allowed by browser CORS. Native mobile requests do not require
a browser CORS origin. Session cookies should be host-only, `Secure`, `HttpOnly`, and use the
narrowest compatible `SameSite` policy; do not set a broad parent-domain cookie. The links hostname
is reserved for a later Universal/App Links milestone and must not be activated here. DNS and TLS
changes require a separately authorized implementation slice.

## Recommended DigitalOcean topology

Use DigitalOcean App Platform in Singapore for the API and worker, a free static-site component for
the Admin build when its runtime requirements permit, Managed PostgreSQL, Managed Valkey, and one
staging-only Spaces bucket. Prefer platform-managed TLS, service bindings, health checks, logs, and
release rollback over a hand-managed Droplet. Keep every resource in staging-only projects,
databases, credentials, and namespaces.

| Component      | Initial shape                   | Isolation and network policy                                                                 |
| -------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| API            | App Platform service, 1 GiB     | Public HTTPS ingress only; health/readiness endpoints; database and Valkey over TLS          |
| Worker         | App Platform worker, 1 GiB      | No public ingress; outbound provider access only when approved                               |
| Admin          | App Platform static site        | Public HTTPS; exact API origin; no server secrets in browser output                          |
| PostgreSQL     | Managed PostgreSQL, basic 1 GiB | Staging database and runtime roles only; trusted-source/private connectivity where supported |
| Valkey         | Managed Valkey, 1 GiB           | Staging-only cache/queue namespace; TLS; no public application access                        |
| Object storage | Spaces, staging-only bucket     | Private by default; scoped key; controlled signed access; no production objects              |

Droplets are cheaper in some shapes but transfer patching, firewall, TLS, process supervision,
database recovery, and host security to the team. Kubernetes adds unjustified orchestration and
operational cost at this stage. Self-hosted PostgreSQL or Valkey would weaken recovery and isolation
for modest savings. The recommended topology can later scale API/worker instances independently,
resize managed data services, add a CDN, or graduate to Kubernetes only when measured load warrants
it.

Ingress is limited to HTTPS for API/Admin. Administrative database, Valkey, or host ports must not
be publicly exposed. Outbound HTTPS is allowed for explicitly enabled providers. Use DigitalOcean
firewalls/trusted sources and private networking where the chosen products support them; otherwise
require TLS, least-privilege credentials, and explicit source restrictions.

## Estimated monthly cost

Planning estimate in USD, before tax, domain registration, exchange-rate movement, or overage:

| Cost area                                                   |                                                 Estimate |
| ----------------------------------------------------------- | -------------------------------------------------------: |
| API compute (1 GiB)                                         |                                                   $10–12 |
| Worker compute (1 GiB)                                      |                                                      $10 |
| Admin static site                                           |                                                       $0 |
| Managed PostgreSQL (1 GiB)                                  |                                                   $15.15 |
| Managed Valkey (1 GiB)                                      |                                                      $15 |
| Spaces                                                      |                                                       $5 |
| Included platform logs/metrics and managed database backups |                                 $0 incremental initially |
| Included bandwidth                                          |                    $0 initially; overage usage-dependent |
| DNS/domain                                                  |                                          Owner-dependent |
| Subtotal                                                    |                                             $55.15–57.15 |
| 20% contingency                                             |                                     approximately $11–12 |
| Proposed operating envelope                                 | approximately $67–69/month plus domain, tax, and overage |

Prices must be reconfirmed immediately before approval. The PHP result depends on the billing
exchange rate. Configure budget notifications to the primary owner at 50%, 75%, and 100% of the
approved monthly ceiling, plus a forecast alert before the PHP 8,000 soft ceiling.

## Secrets and access principals

DigitalOcean App Platform encrypted secret-type environment variables are the authoritative runtime
location for API and worker secrets. Protected CI and EAS environment secrets hold only the scoped
credentials required by build/deployment automation. Managed database/Valkey bindings supply their
own credentials. Browser/mobile configuration may contain explicitly classified public values only.
The repository stores variable names, ownership, rotation dates, and purpose—not values. No
committed `.env` or dependency on a developer-local file is permitted.

| Principal               | Minimum access                                                            |
| ----------------------- | ------------------------------------------------------------------------- |
| Primary owner/admin     | Named account, MFA, billing/project administration                        |
| Deployment automation   | Deploy approved SHA; no billing or unrelated provider administration      |
| API runtime             | API secrets and scoped staging data/storage access                        |
| Worker runtime          | Worker/provider secrets and queue access; no Admin credentials            |
| Admin runtime           | Public build configuration only unless a later server runtime is approved |
| Database roles          | Separate migration owner and restricted API runtime role                  |
| Valkey                  | Scoped staging runtime credential                                         |
| Object storage          | Staging bucket-only key; separate backup key if exports are approved      |
| Backup/restore operator | Read backup/create restore target; no routine application administration  |
| Break-glass             | Named custodian, MFA, offline recovery procedure, use logged and reviewed |

No shared human administrator account is allowed. Every credential needs an owner, purpose,
environment, creation/rotation date, revocation path, and last-review metadata. Revoke automation
credentials on pipeline compromise, human access immediately on role change, and runtime credentials
by replacing bindings and redeploying.

## Data, queue, and recovery design

Use a staging-only database such as `carrental_staging`, separate database roles, a staging Valkey
instance/namespace, and a staging-only private object bucket. Never share production services,
accounts, data, queues, keys, or backups. Each runtime must validate an immutable environment
fingerprint (`staging`), application identifier, database identity, and release SHA before becoming
ready.

The deployment automation owns migrations under a single serialized migration job. Deploy the
existing 38 migrations only after implementation authorization and after validating the target
database fingerprint. Do not modify prior migrations or run migrations concurrently from API
replicas.

Retain managed PostgreSQL backups sufficient to meet the one-hour RPO target; if the selected plan
cannot provide that guarantee, approve encrypted scheduled exports to a separate restricted backup
location. Enable Spaces versioning/lifecycle protection when available and document deletion
recovery. Treat Valkey as reconstructible cache/queue state: durable business state must remain in
PostgreSQL, and job replay/idempotency must be tested. Backup encryption is required in transit and
at rest.

Rehearse restore into a new isolated database, validate migration state and synthetic record counts,
switch a disposable staging release to it, and measure from incident declaration to service
readiness. Measure the age of the newest recoverable record for RPO and elapsed restoration time for
RTO. Do not claim RPO/RTO acceptance until the rehearsal proves RPO ≤ 1 hour and RTO ≤ 4 hours.

## Deployment workflow

1. Select an immutable, reviewed, committed SHA and record the release identifier.
2. Run the full repository verification, integration suite, schema validation, dependency/security
   checks, and secret scan.
3. Build immutable API, worker, and Admin artifacts from that SHA; do not copy local output.
4. Validate target identity, required secret presence (never values), database fingerprint, backup
   freshness, and migration plan.
5. Run the serialized migration job once and verify all 38 expected migrations.
6. Deploy API, gate on health and readiness, then deploy worker and verify a synthetic job.
7. Deploy Admin and verify HTTPS, exact-origin CORS, authentication, authorization, and release ID.
8. Connect an approved staging mobile build and execute the manual smoke matrix.
9. Correlate application/infrastructure telemetry with the SHA and record acceptance evidence.

Rollback is allowed when no incompatible migration or external side effect prevents it. Otherwise
use a reviewed forward fix. A failed migration stops deployment, preserves logs, prevents the new
release becoming ready, and requires restore/repair review—never manual history rewriting. Every
promotion, rollback, and forward fix must retain actor, timestamp, SHA, artifact, migration state,
and approval evidence.

## Observability

Plan separate staging Sentry projects/configuration, structured redacted logs, App Platform and
managed-service resource metrics, external uptime checks for health/readiness, queue/worker health,
database capacity alerts, and budget alerts. Attach the same release SHA and `staging` environment
to logs and Sentry. Route initial actionable alerts to the primary owner within support hours and
define an emergency path outside them. Staging Sentry event delivery and source-map/debug-symbol
uploads remain separate certifications; tracing/profiling and production monitoring are deferred.

## Staging mobile plan

Build, but do not create in this planning task, `CarShare Staging` with package/bundle
`ph.carshare.mobile.staging` and scheme `carshare-staging`. It must use the approved staging API
origin, display a persistent staging marker, and bind to a separate staging EAS environment/project
where required. Android needs a separate staging Firebase app/config; iOS APNs requires eligible
Apple Developer provisioning. Neither may reuse production credentials. Physical smoke coverage
includes install/launch, environment marker, auth/session, API connectivity, background/foreground,
notification permission/registration where enabled, and deep-link routing. Universal/App Links wait
for approved domains and a later explicit certification.

## Provider activation matrix

All providers default disabled in initial staging and require an individual approval and
certification. Provider callbacks are not a Phase 13C-3 infrastructure acceptance condition.

| Provider     | Current local status                                               | Staging requirement                                                               | Public callback                         | Staging certification                       | Production |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------- | ---------- |
| Sentry       | Complete; 4/4 real local events                                    | Separate staging DSNs/projects and managed upload token                           | No                                      | Event receipt and later symbols/source maps | Deferred   |
| Postmark     | Complete; real local delivery                                      | Staging-scoped token/sender/domain decision                                       | Delivery/bounce/complaint later         | Controlled staging inbox delivery           | Deferred   |
| Semaphore    | Implemented; automated pass; physical pending Sender Name approval | Approved `CarShare` sender and scoped key                                         | Not required for basic send             | Physical branded handset delivery           | Deferred   |
| Firebase/FCM | Android local physical pass                                        | Separate staging Firebase apps/config and EAS credentials                         | No                                      | Android staging delivery; iOS separately    | Deferred   |
| Maya         | Sandbox physical hosted Checkout pass                              | Sandbox credentials and exact staging return/callback URLs                        | Required for authoritative events later | Sandbox checkout plus later webhook state   | Deferred   |
| Xendit       | Test-mode physical hosted Payment Session pass                     | Test credential, exact staging URLs, and schema support before normal persistence | Required for authoritative events later | Test checkout plus later webhook state      | Deferred   |

Semaphore requires an owner choice: (A) wait for Sender Name approval and complete physical SMS
certification before provisioning, or (B) provision staging with SMS explicitly disabled and finish
Semaphore later. Option B avoids allowing an external approval to block infrastructure work, but it
must be explicitly approved.

The Prisma `PaymentProviderCode` does not contain Xendit. Do not alter it during infrastructure
provisioning. Add Xendit through a deliberate, reviewed schema migration in a later staging payment
integration checkpoint before it becomes a normal persisted booking payment provider; include data
compatibility, rollback/forward-fix, and integration coverage.

## Implementation slices

Each slice is separately reviewable and recoverable; none is authorized by this proposal.

1. **13C-3A — Scope, domain, access, secrets, and budget approval:** finalize hostnames, principals,
   secret stores, cost ceiling, infrastructure specification, and evidence templates.
2. **13C-3B — Core staging data infrastructure:** create isolated project/network, PostgreSQL,
   Valkey, Spaces, access policies, backup configuration, and fingerprints.
3. **13C-3C — API and worker deployment:** implement reproducible artifacts, serialized migrations,
   API/worker release, health/readiness, synthetic jobs, and release traceability.
4. **13C-3D — Admin deployment and HTTPS:** deploy Admin, configure canonical domains/TLS/CORS, and
   certify Admin authentication and authorization.
5. **13C-3E — Staging mobile identity and build:** bind staging configuration, separate Firebase/EAS
   resources, produce authorized builds, and run physical smoke tests.
6. **13C-3F — Observability, backup, restore, and release recovery:** configure alerts/logs/Sentry
   foundations, rehearse restore and rollback/forward-fix, measure RPO/RTO, and close infrastructure
   acceptance.

Public provider webhook registration and provider-by-provider staging certification belong to a
subsequent explicitly approved milestone, not implicitly to any slice above.

## Acceptance matrix

Phase 13C-3 may be accepted only when evidence confirms:

- deployable artifacts originate from one committed SHA and expose the same release identifier;
- PostgreSQL, Valkey, object storage, queues, credentials, and data are staging-only;
- API and Admin use their approved public HTTPS origins and exact CORS/cookie policies;
- environment fingerprints prevent local, staging, or production cross-connection;
- all 38 candidate migrations are applied exactly once by the migration owner with no failures;
- API health/readiness gates pass and the worker completes an idempotent synthetic job;
- Admin authentication and role authorization pass;
- Android and iOS staging builds connect only to staging and show a visible staging marker;
- backup/restore rehearsal proves RPO ≤ 1 hour and RTO ≤ 4 hours;
- a rollback or documented forward-fix drill succeeds without rewriting migration history;
- redacted logs, release correlation, actionable alerts, uptime checks, and budget alerts work;
- named-principal/MFA/least-privilege access review and credential inventory are complete;
- no production credential, production data, customer data, or developer-local dependency exists;
- the full automated verification, integration, schema, build, export, and security suites pass;
- the manual smoke matrix covers API, worker, Admin, mobile connectivity, isolation, and recovery.

Infrastructure acceptance records provider endpoints as disabled or separately certified. It does
not claim Sentry, email, SMS, push, payment, payout, or webhook staging certification merely because
the network and runtime can reach them.

## Risks and blockers

- No controlled domain or DNS authority has been documented.
- Provisioning, cost, principals, and authoritative secret locations are not owner-approved.
- RPO/RTO are targets only; managed backup granularity and restore timing need proof.
- Semaphore branded physical delivery remains blocked on external Sender Name approval unless SMS
  is explicitly excluded from the first staging capability set.
- Xendit cannot be a normal persisted provider until a deliberate Prisma migration is approved.
- Public provider callbacks, staging Sentry artifacts, staging Firebase, iOS APNs, and Universal/App
  Links remain separate work.
- The proposed monthly cost and product capabilities must be reconfirmed before purchase.

## Approval gate

Owner approval must name the controlled domain and exact hostnames, approve the topology and budget,
choose the Semaphore option, name access/break-glass principals, approve the secret locations and
backup retention, approve the six implementation slices, and authorize **13C-3B** provisioning.
Approval of this document alone does not authorize cloud purchases or provider activation.
