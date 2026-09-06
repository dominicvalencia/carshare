# Proposed Phase 13: controlled pilot release readiness

## Status

Approved on September 4, 2026 only for the incremental Phase 13A dependency/security remediation and
Phase 13B native development-build preparation. Phase 13C, provider activation, observability,
staging/production deployment, and all later work remain deferred. The authoritative execution records
are [`phase-13a-dependency-security-audit.md`](phase-13a-dependency-security-audit.md) and
[`phase-13b-native-development-build-setup.md`](phase-13b-native-development-build-setup.md).
Phase 12 remains complete, accepted, and frozen, and Phase 13A is complete. Phase 13B is complete and
physically accepted: iOS passed on an iPhone 11 running iOS 26.5 and Android passed on a Samsung
SM-A266B running Android 16/API 36. Final regression includes the native-development capabilities and
stabilization recorded in the Phase 13B documents. This is a development-build baseline, not
production readiness. Phase 13C has not started and still requires explicit approval and the entry
decisions below.

## Objective

Turn the accepted Phase 12 functional baseline into a controlled, observable, recoverable pilot build
without weakening server authority, financial integrity, privacy boundaries, or provider truth. The
phase should prioritize release risk over adding marketplace features.

## Entry decisions requiring approval

Before implementation, approve:

1. Pilot audience, geography, supported iOS/Android versions, and success/rollback criteria.
2. Staging and production hosting model, regions, backup targets, secrets/KMS, and on-call ownership.
3. Payment, payout, email/SMS, push, object-storage, KYC, geocoding, and monitoring providers—or an
   explicit decision to keep a capability out of the pilot.
4. Legal, privacy, retention/deletion, insurance, cancellation, late-return, refund, dispute, tax, and
   withholding policies.
5. Whether security deposits and booking extensions remain deferred. They should be separate approved
   workstreams, not incidental additions to release readiness.

## Proposed workstreams

### 13.1 Release environments and delivery

- Resolve the Phase 12 dependency-audit findings with Expo/React Native/Prisma-compatible upgrades or
  reviewed overrides, rerun the full regression/device matrix, and add an enforced CI audit policy.
- Reproducible staging environment with isolated PostgreSQL, Redis, object storage, queues, and secrets.
- CI migration checks, deployment promotion, rollback/forward-fix procedure, and environment parity
  checks.
- Signed iOS and Android development/internal builds; no production claim based on Expo Go.

Exit gate: a clean deployment can be promoted to staging, health-checked, and recovered without local
developer state.

### 13.2 Observability and operational safety

- Structured logs with correlation IDs across API, worker, outbox, provider operations, and admin
  actions; redact credentials and sensitive evidence.
- Metrics and alerts for API health, queue lag, failed outbox events, payment/payout reconciliation,
  notification delivery, storage failures, and database saturation.
- Backup/restore drill, incident runbooks, administrative break-glass policy, and audit review.

Exit gate: injected failures are detectable, retryable where safe, and recoverable by documented action.

### 13.3 Provider integration and certification

- Integrate only approved providers behind existing contracts, beginning in sandbox.
- Verify idempotency, signed webhooks, duplicate/out-of-order events, timeouts, unknown outcomes,
  reconciliation, rate limits, and redaction.
- Reconcile payment and payout reports against the immutable ledger before pilot activation.
- Keep security deposits disabled unless a separate capability review and implementation plan is
  approved.

Exit gate: each enabled provider has contract tests, sandbox evidence, operational runbooks, and an
explicit go-live approval.

### 13.4 Identity, privacy, and media operations

- Production email/SMS delivery, abuse/rate controls, recovery flows, and sender-domain/number setup.
- Decide manual KYC versus a provider integration; document what verification does and does not prove.
- Object-storage encryption, access logging, malware scanning, retention/deletion, and backup policy.
- Data-subject export/deletion and staff least-privilege review for sensitive documents.

Exit gate: privacy-sensitive flows have approved retention, access, deletion, and incident procedures.

### 13.5 Native mobile quality

- Establish a committed native E2E smoke suite for registration, KYC, booking, pickup, and return.
- Physical iOS and Android matrix for camera, permissions, date selection, OS-biometric app lock, location,
  offline/reconnect, push/deep links, background/resume, and hosted-payment browser return.
- Accessibility, low-end-device performance, network-loss recovery, crash reporting, and release-channel
  validation.

Exit gate: the agreed device/OS matrix passes automated smoke and signed-build manual acceptance.

### 13.6 Pilot operations and launch gate

- Admin/support procedures for KYC, vehicle review, handover fallback, incidents, claims, refunds,
  payout exceptions, reports, and account suspension.
- Pilot dashboards, reconciliation cadence, support escalation, customer communication, and rollback
  criteria.
- Final threat model, dependency/security scan, load test, migration rehearsal, and go/no-go review.

Exit gate: product, engineering, operations, security/privacy, legal, and finance owners sign off on the
same documented capability set and limitations.

## Explicitly excluded unless separately approved

- New marketplace features unrelated to pilot safety or provider enablement.
- Arbitrary booking status/date mutations or client-authoritative lifecycle rules.
- Security-deposit activation without certified authorization/capture/release semantics.
- Booking extensions without occupancy locking, immutable original schedule, policy, notifications,
  payment consequences, and end-to-end tests.
- Claims of automated identity authenticity or liveness without a certified provider.
- Large architectural rewrites of the modular monolith solely for anticipated scale.

## Proposed sequencing

1. Analyze dependency/security advisories and their reachable production risk.
2. Apply only compatibility-tested dependency remediation.
3. Produce a proper signed native iOS development build.
4. Produce a proper signed native Android development build.
5. Complete physical-device native acceptance using the
   [native development-build checklist](native-development-build-acceptance.md).
6. Add approved observability and crash reporting.
7. Establish operational monitoring and alerting.
8. Separate development, staging, and production environments, secrets, and data.
9. Implement backups and complete a tested recovery drill.
10. Configure and validate production email and push infrastructure.
11. Certify the selected payment provider.
12. Certify the selected payout provider.
13. Complete production KYC, media-storage, scanning, retention, and provider operations.
14. Complete pilot security, privacy, compliance, legal, insurance, tax, and finance review.
15. Run the pilot dress rehearsal and formal go/no-go review.

The guiding entry goal is to stop using Expo Go as the primary acceptance environment. This ordering is
a proposal only and grants no Phase 13 implementation authority.

No Phase 13 migration, feature branch, provider activation, or production resource should be created
until this proposal is reviewed and approved.
