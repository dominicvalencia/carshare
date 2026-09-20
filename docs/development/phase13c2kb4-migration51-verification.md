# Migration 51 — participant evidence-waiver candidate

Date: 2026-09-17. Local development/test only. Implemented candidate awaiting Owner physical QA; not an accepted release. No staging, commit, push, acceptance tag, production deployment, B5, with-driver work, no-show policy or automatic overdue cancellation.

## Authority and recovery

Start and Return are independent evidence outcomes. The smallest new authority persists only WAIVED decisions; VERIFIED is derived from the existing finalized inspection/custody workflow. Pending is not labeled verified. Each waiver records booking, phase, actual participant user ID, server decision time, correlation ID and acknowledgement version `HANDOVER_EVIDENCE_WAIVER_V1`. A database unique constraint enforces one decision per booking/phase; UPDATE/DELETE triggers make it append-only. Finalized inspection evidence cannot be waived, and inspection insertion/update after a waiver is rejected under the booking lock.

Only immutable workflow version 1 (B4) can use the new recovery routes. Historical NULL bookings remain legacy; unsupported versions cannot obtain waivers. Migration 50 and earlier migration files/checksums are unchanged. Migration 51 adds tables/guards and layers the shared financial predicate without updating historical rows. No default, heuristic backfill or fabricated inspection is introduced.

Owner Start waiver requires explicit acknowledgement, verified Owner participation, READY_FOR_PICKUP, an open pickup window, no actual pickup, required Delivery arrival and no safety/maintenance/Operations blocker. Overdue is not expiry. The waiver alone never activates a booking. The Renter must still issue the normal expiring six-digit pickup code; the Owner must verify it. Wrong, expired, exhausted, reused and concurrent-code protections remain authoritative. Actual pickup remains the real successful verification time.

Renter Return waiver requires explicit acknowledgement, actual pickup, Renter Start Return, RETURN_PENDING, no completed Return, required Collection arrival and no Operations hold. Owner Collection travel is rejected before Renter Start Return. The waiver alone never records physical Return. A separate actual Owner acknowledgement of physical receipt creates an append-only receipt and records actualReturnAt at its server-confirmed time. No return inspection, media, odometer/fuel reading or inspection confirmation is manufactured.

Routes reuse existing participant authentication, booking identity and strict DTO validation:

- Owner: `POST /owner/bookings/:reference/rental/pickup/evidence-waiver`.
- Renter: `POST /bookings/:reference/rental/return/evidence-waiver`.
- Owner: `POST /owner/bookings/:reference/rental/return/receipt`.

Repeated identical requests return existing state without duplicate history, outbox records or custody transitions. There is no Admin waiver or Admin OTP bypass.

## Financial and claims boundaries

All existing completion, earnings release, payout diagnostics/selection/allocation and first provider-submission callers retain `booking_workflow_compliance_blocker(uuid)` as their shared authority. Migration 51 preserves the verified-only helper and adds phase-specific waiver branching. A valid Start waiver replaces only inspection/review evidence requirements: actual pickup and a consumed Renter-issued/Owner-verified code remain mandatory. A valid Return waiver replaces only inspection/review evidence requirements: actual Owner receipt matching actualReturnAt and RETURNED/COMPLETED remain mandatory. Missing evidence without an authorized waiver remains blocked.

Operations holds, claims/disputes, payment reconciliation, availability schedules, locks, allocations and payout idempotency remain separate authorities. Full rental/Delivery/Collection earning components are not repriced or removed. Migration 49 authoritative pre-custody cancellation settlement remains exempt from the normal-rental evidence predicate under its existing rules. Already-paid/submitted history is not rewritten.

Reduced evidence is not automatic fault, a fabricated baseline, a universal liability waiver or an automatic claim denial. Damage/cleaning claims still need separate claim evidence and normal support adjudication. Where inspection readings are unavailable, no usage summary is fabricated and measurement-dependent mileage/fuel/SOC charges are not inferred. Existing late-return formula can use actual Return versus contractual Return time with its unchanged grace/rate/cap. Claim hold requests now match the existing database monetary exposure limit; FULL continues to block the whole earning, including fulfillment fees. This corrects an existing delivery/collection claim error without changing database hold or payout authority.

## Presentation and notifications

Normal verified inspection remains the recommended primary flow. Secondary waiver actions show a native confirmation with explicit reduced-evidence consequences, a Go back option and a deliberate Continue action. Owner and Renter display persistent waived-evidence warnings; the Renter still sees Get pickup code, and the Owner sees Confirm vehicle received only on the appropriate waived Return. Existing overdue cards offer recovery actions at the relevant outstanding evidence step. Waiting copy is used where the counterpart must act.

Timeline history distinguishes inspection waivers, verified handover/Return and physical completion without inspection evidence. Admin rental detail shows each derived phase outcome and waiver participant/time/version metadata alongside actual custody and the safe financial blocker. Claim detail exposes reduced inspection evidence context and does not presume fault. Existing claims/dispute records and support authority are retained.

Start waiver notifies only the Renter; Return waiver notifies only the Owner through the durable outbox and existing delivery worker. Event/recipient idempotency keys and one authoritative phase event prevent duplicates. Notification variables/deep links contain the public booking reference, not OTP, private address, coordinates, media URLs or KYC data. Physical push delivery is not established by automated tests.

## Verification and limitations

Final automated result: 596 passing unit/package tests and 59 passing integration tests across eight files. `pnpm verify` passed; its 12 production build tasks include iOS and Android exports (valid unchanged-package results may be replayed from Turbo cache). Expo Doctor passed 18/18 and dependency validation reported up to date. Both local databases have 51 applied migrations with every checksum matching; Migration 52 is absent. These results do not establish physical acceptance.

Repository verification covers formatting, Compose validation, lint, TypeScript, unit tests, Prisma validation and production builds, including iOS/Android Hermes exports. Integration uses local carrental_test and isolated Redis database 15; development Redis/queues are not flushed. Migration audit checks every applied SQL checksum in both local databases. No database reset or historical data cleanup is performed.

Initial runs found an outdated mobile source assertion, a pickup-history relation lookup, an old collection test that traveled before Start Return, and a test-only schedule fixture violating rentalEnd > rentalStart. These were corrected. The additional reduced-evidence claim exercise exposed the preexisting hold-exposure mismatch described above. Test fixtures alone advance schedule/claim/availability boundaries; application waiver paths never alter contract dates or backdate evidence/custody.

Source tests are not device layout/camera/accessibility acceptance. Native dialogs, touch targets, enlarged text, keyboard/scroll destinations, notification delivery and real pickup/Return must be physically checked. Existing in-memory photo-attachment retry limitations documented under Migration 50 remain; this migration adds no destructive orphan cleanup or persistent upload-retention system.

## Physical QA checklist — pending Owner acceptance

- Use a newly created B4 booking, not a silently upgraded legacy booking. Confirm normal verified inspection is primary and waiver secondary.
- Late normal Pickup: complete inspection/review/OTP after grace; confirm verified labels and real actualPickupAt, unchanged dates/pricing.
- Owner Start waiver: read consequences, cancel once, then explicitly continue. Confirm one immutable decision, no fabricated inspection, reduced-evidence warning for both roles and one Renter notification.
- Before correct OTP verification, confirm no ACTIVE/custody. Test wrong, expired, exhausted, reused codes and an Operations hold; then verify once.
- Delivery: no waiver or physical pickup before ARRIVED. Arrival itself must not activate the booking.
- Renter Start Return: Owner collection travel must be unavailable beforehand. Collection arrival must precede Return evidence waiver/receipt.
- Renter Return waiver: confirm one decision and one Owner notification, no RETURNED state or actualReturnAt until actual Owner receipt acknowledgement.
- Owner receipt: decline the dialog once; confirm only after physically receiving the vehicle. Repeat safely; confirm one receipt/custody transition.
- Exercise all four Start/Return evidence combinations. Confirm missing evidence without a waiver remains financially blocked; compliant custody still respects claims/disputes, Operations/payment holds and availability schedule.
- Attempt wrong-participant actions, legacy/unsupported-version waiver, conflicting verified evidence after waiver and waiver after finalized evidence. None may change the outcome or impersonate another role.
- Admin: inspect waiver user/time/version, reduced-evidence claim context, actual custody and exact payout blocker. Confirm no OTP or new off-app custody authority.
- Submit separate evidence for a legitimate damage claim on a waived booking; confirm review remains available without automatic liability or invented readings. Confirm FULL hold and withdrawal/release behavior.
- Recheck Migration 49 cancellation retained commission/completed Delivery and refunded uncompleted Delivery/Collection; no duplicate settlement/refund/ledger effects.
- Check small/large iOS and Android, enlarged text and screen readers: secondary action, confirmation labels, warning text, primary receipt button, keyboard/suggestions and overdue scroll destination. Confirm warnings do not rely on color alone.
- Confirm foreground/resume refresh and counterpart notifications on actual devices; retries must not deliver duplicate waiver updates.

## Required final report — 70 fields

| #   | Requested field                      | Result                                                                                                                         |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Final status                         | Implemented local candidate; automated verification recorded below; physical acceptance pending.                               |
| 2   | Migration 51 filename                | `20260917130000_phase13c2kb4_handover_evidence_waiver/migration.sql`.                                                          |
| 3   | Migration count                      | 51 repository/local applied migrations.                                                                                        |
| 4   | Start waiver persistence             | Append-only booking/START/Owner/time/acknowledgement record.                                                                   |
| 5   | Return waiver persistence            | Independent append-only booking/RETURN/Renter/time/acknowledgement record.                                                     |
| 6   | Immutability strategy                | Booking lock, unique booking+phase, UPDATE/DELETE rejection and inspection conflict guard.                                     |
| 7   | Acknowledgement version strategy     | Shared version literal; strict explicit true acknowledgement and DB version check.                                             |
| 8   | Start waiver authorization           | Actual verified Owner only, READY and prerequisites; wrong participant rejected.                                               |
| 9   | Return waiver authorization          | Actual Renter only after Start Return, prerequisites; wrong participant rejected.                                              |
| 10  | B4 applicability                     | Immutable workflow version 1 only.                                                                                             |
| 11  | Legacy behavior                      | NULL unchanged; unsupported versions rejected; no backfill.                                                                    |
| 12  | Start verified flow                  | Existing finalized Owner evidence, Renter review/resolution and OTP retained.                                                  |
| 13  | Start waived flow                    | Owner waiver replaces evidence only; normal Renter code/Owner verification still establishes pickup.                           |
| 14  | Return verified flow                 | Existing Renter inspection and Owner confirmation retained; no invented Start readings.                                        |
| 15  | Return waived flow                   | Renter waiver replaces evidence only; separate actual Owner receipt establishes physical Return.                               |
| 16  | Delivery behavior                    | ARRIVED prerequisite; not custody.                                                                                             |
| 17  | Collection behavior                  | Renter Start Return then ARRIVED prerequisite; not physical Return.                                                            |
| 18  | OTP retained confirmation            | Existing six-digit expiry/attempt/single-use/concurrency guards retained.                                                      |
| 19  | Owner Return confirmation retained   | Owner-only explicit received acknowledgement with immutable receipt.                                                           |
| 20  | Safety blocker behavior              | Maintenance/active critical condition/safety blockers prevent Start recovery.                                                  |
| 21  | Operations hold behavior             | No waiver/custody bypass; financial hold remains authoritative.                                                                |
| 22  | Start payout predicate               | Verified evidence or valid Owner waiver AND authoritative consumed OTP/actual pickup.                                          |
| 23  | Return payout predicate              | Verified evidence or valid Renter waiver AND Owner receipt/actual Return/status.                                               |
| 24  | VERIFIED/VERIFIED payout test        | Full API custody → compliant completion → scheduled release covered.                                                           |
| 25  | WAIVED/VERIFIED payout test          | Independent phase waiver, real OTP, normal Return, completion/release covered.                                                 |
| 26  | VERIFIED/WAIVED payout test          | Normal Start, real Owner waived Return receipt, completion/release covered.                                                    |
| 27  | WAIVED/WAIVED payout test            | Both waivers, Delivery/Collection arrival, real custody and completion/release covered.                                        |
| 28  | Claim/dispute evidence labeling      | Persistent reduced-evidence context; no automatic fault/denial; no fabricated usage.                                           |
| 29  | Admin presentation                   | Phase outcome, actual waiver participant/time/version, custody and financial blocker.                                          |
| 30  | Owner Start UX                       | Secondary acknowledgement dialog; verified flow primary; persistent warning.                                                   |
| 31  | Renter Start UX                      | Reduced-evidence warning and normal pickup code action.                                                                        |
| 32  | Renter Return UX                     | Secondary acknowledgement dialog after Start Return/arrival; waiting for receipt.                                              |
| 33  | Owner Return UX                      | Reduced-evidence warning and explicit physical receipt confirmation.                                                           |
| 34  | Timeline/history                     | Phase waiver and verified/without-inspection physical completion labels.                                                       |
| 35  | Start waiver notification            | Durable counterpart Renter event/template.                                                                                     |
| 36  | Return waiver notification           | Durable counterpart Owner event/template.                                                                                      |
| 37  | Notification idempotency             | Unique phase decision/event and existing deterministic recipient delivery key tested.                                          |
| 38  | API authorization tests              | Owner/Renter/nonparticipant, acknowledgement, finalized evidence, legacy/future, hold/arrival and idempotency exercised.       |
| 39  | DB authority tests                   | Three new source authority tests plus live append-only/version/financial guards.                                               |
| 40  | Payout regression                    | Existing payout integration and all four shared predicate/release combinations covered.                                        |
| 41  | Migration 50 regression              | Late verified workflow and missing-evidence financial guards retained.                                                         |
| 42  | Migration 49 regression              | Existing cancellation/settlement integration retained.                                                                         |
| 43  | Security/privacy audit               | Participant guards/strict DTOs; no added OTP/media/address/KYC notification or Admin exposure.                                 |
| 44  | Accessibility/source tests           | Button roles/disabled state, alert warnings and explicit confirmation source checks; physical QA pending.                      |
| 45  | Full API tests                       | 192 passing.                                                                                                                   |
| 46  | Full Mobile tests                    | 219 passing.                                                                                                                   |
| 47  | Full Admin tests                     | 82 passing.                                                                                                                    |
| 48  | Full Workers tests                   | 7 passing.                                                                                                                     |
| 49  | Full Database tests                  | 36 passing.                                                                                                                    |
| 50  | Integration tests                    | 8 files, 59 passing; all four combinations include reduced-evidence claim/withdrawal checks where applicable.                  |
| 51  | Payments/payout tests                | Payments 21, payout provider 7; API payout integration included in integration result.                                         |
| 52  | Repository lint/typecheck            | Passed across repository; max-warnings=0.                                                                                      |
| 53  | Production builds                    | Passed, 12 tasks; API/Admin/Workers and package builds.                                                                        |
| 54  | iOS export                           | Hermes export passed.                                                                                                          |
| 55  | Android export                       | Hermes export passed.                                                                                                          |
| 56  | Expo Doctor                          | 18/18 checks passed; dependency check up to date.                                                                              |
| 57  | Prisma validation                    | Passed.                                                                                                                        |
| 58  | git diff --check                     | Passed at audit; repeat after report.                                                                                          |
| 59  | Migration 50 unchanged               | File and both applied checksums preserved; all earlier checksums match.                                                        |
| 60  | Migration 51 status                  | Normally deployed locally to both databases; applied checksum matches.                                                         |
| 61  | Migration 52 absent                  | No Migration 52 created.                                                                                                       |
| 62  | carrental migration status           | 51 applied; every checksum matches repository.                                                                                 |
| 63  | carrental_test migration status      | 51 applied; every checksum matches repository.                                                                                 |
| 64  | Database reset status                | No reset, queue flush or destructive historical cleanup.                                                                       |
| 65  | development-demo.ts protected status | Preexisting 82 additions/2 deletions untouched; not staged/reverted/discarded.                                                 |
| 66  | Current branch/HEAD                  | main / `02f0bdd527c59a09a3b8e76986bb96631b5c9c7b`.                                                                             |
| 67  | Staged files                         | None.                                                                                                                          |
| 68  | Commit/push status                   | Neither performed; no acceptance tag.                                                                                          |
| 69  | Physical QA checklist                | Ready above; not executed or accepted.                                                                                         |
| 70  | Remaining known gaps                 | Device/push/accessibility acceptance, existing in-memory attachment retry retention; no Admin/off-app custody exception added. |

Migration 51 edits are confined to the waiver migration/schema/contracts, participant API/controllers/projection, claims compatibility, shared mobile panel/timeline, Admin context, notification templates/worker and regression tests. Existing dirty Migration 50 candidate work and the protected demo remain separate. Normal production generation may update generated Next type-reference output; it is not manually authored waiver feature work and is not staged.
