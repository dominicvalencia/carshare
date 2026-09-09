# Phase 13C decision register

| Decision         | Answer                                              | Status                  |
| ---------------- | --------------------------------------------------- | ----------------------- |
| Cloud/region     | DigitalOcean, Singapore                             | Target; not provisioned |
| Domains          | None selected                                       | Deferred                |
| Pilot            | Lucena City and Metro Manila                        | Approved                |
| Support          | 08:00–18:00 Asia/Manila                             | Approved                |
| Alerts           | Primary owner                                       | Approved initial model  |
| Budget           | PHP 10k initial; PHP 6k target; PHP 8k soft ceiling | Guardrail               |
| Builds           | Future EAS Build                                    | Profiles prepared only  |
| KYC              | Manual                                              | Approved initial model  |
| Payments/payouts | Sandbox/test only                                   | Activation deferred     |
| Recovery         | RPO 1h; RTO 4h                                      | Target, not validated   |

Phase 13C-2 was reordered to complete the local provider integration foundation before staging.
Next gate: finish local provider QA, then separately approve staging provisioning, actual domains/origins, access principals, and
managed secret locations. No production activation is implied.

## Proposed Phase 13C-3

**Phase 13C-3 — Isolated Staging Infrastructure and Deployment Foundation** is documented as a
proposal in `phase-13c3-staging-foundation-proposal.md`. It is not approved, and no infrastructure
has been provisioned. Owner decisions remain required for the controlled domain and exact origins,
topology/budget, access principals, secret locations, backup retention, implementation slices, and
whether staging waits for Semaphore Sender Name approval or initially keeps SMS disabled.

Staging is paused while **Phase 13C-2G — Admin Identity, Staff Accounts, RBAC, and Audit
Foundation** completes automated and physical local acceptance. The Phase 13C-3 proposal remains
unapproved and no provisioning is authorized by the 13C-2G implementation.
