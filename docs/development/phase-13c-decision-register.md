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
