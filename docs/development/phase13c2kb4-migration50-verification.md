# Migration 50 — historical-safe handover compliance candidate

Date: 2026-09-17. Scope: local development and test only. This is a candidate awaiting Owner physical QA, not an accepted release. No staging, commit, push, or acceptance tag is authorized by this work.

## Policy and historical safety

`Booking.handoverWorkflowVersion` is a nullable PostgreSQL integer, mapped to `handover_workflow_version`. The shared domain constant `HANDOVER_WORKFLOW_VERSION_B4` is explicitly **1**. The server assigns it when creating a booking hold in `BookingsService`; the strict booking DTO does not accept a client-selected version. A database UPDATE trigger prevents any ordinary version change, including changing a historical NULL to 1. Positive unsupported versions fail normal financial eligibility closed until intentionally supported.

NULL means legacy/unclassified. Migration 50 has no column default, no historical update, no evidence/status/date heuristic, and no fabricated backfill. Existing active/ready/completed bookings keep the financial policy under which they were created. At the development database audit, all 26 existing bookings were still NULL. They were not upgraded. **Create new QA bookings after this migration to exercise B4 financial compliance; do not silently relabel old bookings.**

The version is policy metadata, not custody, inspection, verification, Return, or payout evidence. Participant rental serialization omits the raw version; Mobile consumes server-derived compliance state. Admin shows the derived workflow classification for diagnosis.

## Overdue is not expiry or custody

Start overdue is derived from CONFIRMED/READY_FOR_PICKUP, missing actual pickup, and current time strictly after the pickup grace boundary. Booking-list projection uses the existing configured pickup grace when a persisted ready-window boundary is not yet available. Rental Detail uses its persisted window. Return overdue is derived from ACTIVE/RETURN_PENDING, missing physical Return, and current time strictly after scheduled rentalEnd plus `RETURN_CONFIRMATION_GRACE_MINUTES` (existing default 120). No finalized Return inspection is necessary to detect overdue.

`assertPickupWindow()` retains the not-yet-open check, but no longer rejects solely because the end boundary passed. Draft photo attachment, Owner inspection, Renter review/resolution, and OTP issuance/verification remain available late. Existing participant, lifecycle, fulfillment-arrival, hold, required-media, condition-disclosure, OTP expiry/attempt/single-use, and physical-custody checks remain authoritative. Late Return remains available through the existing workflow.

The application never changes scheduled contract dates or backdates photo/inspection/review/OTP/custody records to make them compliant. Integration fixtures explicitly advance deadlines/schedules for testing; those fixture updates are not application rescheduling behavior. Actual pickup is recorded at successful verification; actual Return is recorded at legitimate physical Return completion. Overdue itself never activates a rental, transfers custody, completes a booking, reprices a contract, or cancels it.

The shared server presentation helper returns evaluated time, workflow classification, scheduled/grace boundaries, actual-custody flags, precise outstanding steps, and a safe financial blocker. Start prerequisites include delivery arrival, Owner inspection, Renter review, discrepancy resolution, pickup verification, and Operations hold. Return prerequisites include Renter Start Return (before collection can start), collection arrival, Renter evidence, Owner review, physical completion, and dispute/hold context. Operations holds take precedence over ordinary Start actions. Mobile does not decide financial policy from dates or the raw version.

## Database and payout authorities

Migration: `20260917090000_phase13c2kb4_workflow_compliance/migration.sql`.

One stable database helper, `booking_workflow_compliance_blocker(uuid)`, branches explicitly on the immutable version. For normal B4 bookings it requires finalized Owner Start inspection and disclosure, authoritative Owner/Renter confirmations, accepted latest discrepancy resolution or the existing audited Operations resume outcome, a consumed Renter-issued/Owner-verified OTP matching actualPickupAt, finalized Renter Return inspection, both Return confirmations, actualReturnAt and RETURNED/COMPLETED state. A DISAGREED Return confirmation is legitimate physical Return; it does not erase separate claims/disputes/financial holds.

The helper is enforced by booking completion, scheduled earnings release, payout diagnostics, eligible selection, allocation INSERT trigger, and first APPROVED → SUBMITTING transition. API pre-submission validation and the database trigger both protect that transition. Existing row locks, SKIP LOCKED processing, allocation constraints, schedules, claims, disputes, payment-reconciliation checks and idempotent events remain in place. A stale AVAILABLE earning or advanced booking status alone cannot bypass B4 evidence requirements.

Already-paid history is not rewritten. Already-submitted/provider-identified payouts retain existing reconciliation authority rather than being reinterpreted retrospectively. Migration 50 does not update historical payouts or allocations.

Migration 49 pre-custody cancellation settlement is explicitly outside the normal-rental evidence predicate. Its captured commission, completed Delivery retention, uncompleted Delivery refund and Collection refund rules remain authoritative. Cancellation settlement, refund and ledger idempotency are unchanged. Full existing fulfillment earnings are preserved in payout amount validation and the maximum-selection bound: net rental + Delivery + Collection + additional compensation + adjustment. No repricing is introduced.

Delivery ARRIVED is travel progress, not custody or normal payout eligibility. Collection arrival is likewise a prerequisite, not Return completion. This candidate adds no Admin OTP bypass, off-app custody confirmation, technical-failure exception authority, automatic cancellation/no-show policy, B5, with-driver workflow, or production/staging deployment. Technical failures still require support review; support escalation by itself cannot satisfy missing evidence or release funds.

## Participant and Admin presentation

Owner and Renter overdue cards precede normal workflow/travel cards. They use textual titles, precise outstanding steps, evidence warnings and short primary actions that scroll to the existing relevant workflow section. Where the other participant or Operations must act, waiting copy replaces a misleading action. Owner B4 warnings explain that missing Start/Return evidence leaves normal payout ineligible/pending, without turning legacy bookings into B4 obligations.

Existing Owner/Renter list badges show Handover overdue or Return process overdue without introducing a new BookingStatus. Existing Owner dashboard upcoming/active counters are reused and highlighted for derived overdue cases; Return-pending rentals remain in the active counter. No new counter system is added.

Admin rental queue attention badges and Detail show derived overdue state, grace boundaries, missing steps, recorded custody and exact safe payout blocker. The display is read-only context and exposes no OTP plaintext/hash or verification bypass. Existing audited support/Operations actions retain their boundaries.

## Notifications and recovery

Start and Return overdue events use the existing durable outbox. Return overdue emission now includes ACTIVE bookings with no Return inspection and uses scheduled rentalEnd plus the configured grace. Existing per-booking/event deduplication is retained. Worker policies explicitly deliver both overdue event types to both participants. Role-specific template keys make Owner/Renter instructions distinct; deterministic notification idempotency keys survive delivery retries.

Template variables contain the public booking reference only. Notification copy/deep links expose no OTP, exact address, coordinates, media URL or KYC information. Deep links reuse the booking reference routing: Owner rental surface or Renter Booking Details. Existing foreground push listeners refresh notification summary/inbox and rental queries; fallback summary polling remains 15 seconds. Notification Center refreshes on mount, focus and foreground. This is not a claim that device push was physically verified.

## Photo attachment failure and orphan audit

Upload and attachment are distinct. On a genuine attachment failure, Owner pickup slots/supporting-photo controls show the failure immediately beside the affected control, including the underlying safe API error, and a Retry action. The panel retains the successfully uploaded file ID and local URI; retry reuses that upload instead of requiring another capture or uploading another asset. Success clears pending retry state and displays persisted evidence.

The pending retry reference is in-memory, not a new persistent orphan database or deletion process. Leaving/restarting the screen can lose that retry context. The files/workers audit found no existing unattached-READY-file cleanup authority to extend safely. This candidate preserves uploaded assets and adds no destructive cleanup. A bounded persistent retry/retention policy remains a gap requiring separate authorization; an unattached file is never fabricated into inspection evidence.

## Verification caveats

Automated source tests establish warning order, server-projection consumption, retry plumbing and privacy guards; they do not establish physical layout, camera reliability, swipe/scroll usability or accessibility acceptance. Those require Owner device QA below. Existing generated Next type-reference output can be regenerated by normal builds; `development-demo.ts` is protected and was not edited, staged, reverted or discarded by this refinement.

Candidate SQL iteration is confined to the unaccepted Migration 50: an ambiguous column reference was corrected in carrental_test, and candidate functions/checksum synchronized without a reset. The candidate was normally deployed to carrental. A final audit then moved the Migration 49 settlement exception before unsupported-version rejection; only the Migration 50 helper/checksum was synchronized in both local databases. No Migration 1–49 checksum was altered. Audit found 50 applied migrations, no pending migrations and no file/database checksum mismatch in either database. Migration 51 is absent. Once accepted/published, Migration 50 must not be rewritten; subsequent policy changes need separately authorized migration work.

The initial sandbox API HTTP tests required local-port permission. Full verification was rerun with that permission. Initial shared-Redis integration setup scans timed out: the development Redis database contains over 235,000 keys. The final run uses a separately checked empty Redis database 15; development queues were not flushed/reset. A client-version-rejection test expectation was corrected from 422 to the existing strict ValidationPipe's 400 response; the rejection itself remained intact.

## Owner physical QA checklist — not executed/accepted here

- Create a new booking after Migration 50; Admin should show B4. Old QA bookings remain legacy and must not be silently upgraded.
- Use a READY_FOR_PICKUP booking past its grace boundary. Both participants should see Handover overdue first; confirm the exact outstanding step.
- Repeat the original failure: capture and upload a required inspection photo late. Confirm attachment and preview, then complete Owner inspection, known-issue disclosure, Renter review/resolution and OTP late.
- Confirm ACTIVE once, actualPickupAt equals actual completion time, contract dates/pricing are unchanged, and Start overdue disappears.
- Test wrong/expired/exhausted/reused OTP, nonparticipant access, unresolved disagreement and an Operations hold. None should bypass custody guards.
- Test Owner Delivery before/after ARRIVED. Before arrival, the primary action should lead to delivery progress, not an unavailable inspection. ARRIVED without review/OTP must not establish custody or make normal payout eligible.
- Test an ACTIVE booking past scheduled Return plus grace, including no Return inspection. Confirm Return overdue first and Renter Start Return prerequisite. Owner collection travel should remain unavailable until Renter starts Return.
- For Collection, confirm arrival prerequisite. Complete Renter Return evidence and Owner review late; confirm actualReturnAt/current physical Return and overdue disappears. Repeat with DISAGREED Return and confirm financial dispute holds remain separate.
- Confirm normal B4 earnings stay pending until compliant completion AND existing availability schedule/financial blockers allow release. Confirm legacy behavior and existing paid/submitted payouts are unchanged.
- Reconfirm Migration 49 cancellation preview/settlement: commission retained, completed Delivery retained, uncompleted Delivery and Collection refunded, one settlement/refund/ledger reversal under retry.
- With Workers running, confirm both roles receive each overdue update once, safe copy/reference routing, foreground badges and resume recovery; no OTP/address/media data in notification content.
- Force upload-success/attachment-failure. Error must appear beside that slot; Retry must reuse the upload and attach successfully. Do not delete an unattached asset manually as part of QA.
- Admin: confirm queue badges, exact missing step, custody flags and precise payout reason; no OTP exposure or new off-app-custody action.
- Check compact and large iPhones/Android devices, enlarged text, screen readers, keyboard/suggestions, touch targets, galleries, dynamic-content scroll clamping and primary-action scroll destinations. Color alone must not communicate overdue.

Stop at physical-QA-ready candidate. No acceptance tag or repository publication before Owner acceptance.

## Required final report — original 124 fields

All results below distinguish automated verification from pending physical acceptance. Full unit/package total: 590 passing tests; integration: 55 passing tests. Turbo may replay valid cached results for unchanged packages.

| #   | Requested field                                  | Result                                                                                                                                                      |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Final status                                     | Implemented candidate; automated verification passes; Owner physical QA pending, not accepted.                                                              |
| 2   | Migration 50 filename                            | 20260917090000_phase13c2kb4_workflow_compliance/migration.sql.                                                                                              |
| 3   | Migration count                                  | 50 repository migrations; 50 applied in each local database.                                                                                                |
| 4   | Historical applicability rule                    | Immutable explicit version 1 only; NULL remains legacy; unsupported positive versions fail closed.                                                          |
| 5   | Late-photo fix                                   | End-of-window attachment rejection removed; late draft attachment and persisted preview verified.                                                           |
| 6   | assertPickupWindow refactor                      | Keeps not-yet-open guard; end boundary is overdue-only. Independent lifecycle/security/fulfillment/OTP guards remain.                                       |
| 7   | Late inspection result                           | Owner finalized inspection accepted after grace in integration.                                                                                             |
| 8   | Late Renter review result                        | Renter discrepancy/review and latest resolution accepted after grace in integration.                                                                        |
| 9   | Late OTP result                                  | Late issue/verify succeeds; wrong, expired, exhausted and reused code protections remain tested.                                                            |
| 10  | No-backdating confirmation                       | actualPickupAt is verification time; actualReturnAt is physical completion time. Contract dates remain unchanged by application.                            |
| 11  | Start overdue derivation                         | CONFIRMED/READY, missing actual pickup, now strictly after grace boundary.                                                                                  |
| 12  | Return overdue derivation                        | ACTIVE/RETURN_PENDING, missing actual Return, now strictly after rentalEnd + Return grace; no inspection prerequisite.                                      |
| 13  | Grace-period configuration                       | Existing PICKUP_WINDOW_GRACE_MINUTES and RETURN_CONFIRMATION_GRACE_MINUTES; Return default 120.                                                             |
| 14  | Outstanding-step projection                      | Shared server projection; precise prerequisite, grace, custody and safe blocker. Extra Renter Start Return prerequisite reflects existing collection guard. |
| 15  | Owner Start UX                                   | First warning card, evidence/payout warning, relevant workflow scroll or waiting copy.                                                                      |
| 16  | Renter Start UX                                  | First warning card, evidence reminder, relevant review/OTP scroll or waiting copy.                                                                          |
| 17  | Owner Return UX                                  | First Return warning, B4 pending-payout warning, collection/review scroll or waiting copy.                                                                  |
| 18  | Renter Return UX                                 | First Return warning, Start Return/evidence scroll or Owner/Operations waiting copy.                                                                        |
| 19  | Start payout compliance                          | Owner finalized inspection/disclosure, Renter review/resolution, consumed verification and actual pickup.                                                   |
| 20  | Return payout compliance                         | Finalized Renter Return evidence, Owner review, physical-return status/actual time. DISAGREED remains legitimate; financial holds separate.                 |
| 21  | Earnings-release changes                         | Shared DB blocker added to existing release function; schedule and other financial holds retained.                                                          |
| 22  | Payout-selection changes                         | Shared blocker filters even stale AVAILABLE earnings; full fulfillment amount included in maximum bound.                                                    |
| 23  | Payout-allocation changes                        | DB INSERT trigger validates workflow under earning lock; existing full-allocation guard retained/corrected for fulfillment components.                      |
| 24  | Pre-submission payout changes                    | API and DB guards before first APPROVED → SUBMITTING provider transition.                                                                                   |
| 25  | Already-submitted payout handling                | Provider-identified/submitted payouts remain in existing reconciliation flow; no retrospective rewrite.                                                     |
| 26  | Delivery ARRIVED distinction                     | Travel prerequisite only; no custody/payout inference from ARRIVED.                                                                                         |
| 27  | Migration 49 cancellation regression             | Existing cancellation integration passes; shared helper explicitly exempts authoritative settlement.                                                        |
| 28  | Technical-failure / Operations exception gap     | No new audited off-app/technical-failure exception authority. Support review cannot manufacture evidence or release payout.                                 |
| 29  | Start-overdue notification behavior              | Existing durable Start-overdue outbox event; both roles, safe role-specific instructions/reference routing.                                                 |
| 30  | Return-overdue notification behavior             | Scheduled Return + grace; includes ACTIVE with no Return inspection; both roles.                                                                            |
| 31  | Notification idempotency                         | DB per-booking/event deduplication tested twice; deterministic per-recipient Worker keys tested across retries.                                             |
| 32  | Worker overdue-event handling                    | Explicit overdue event policies for both audiences; role-specific templates; existing durable delivery.                                                     |
| 33  | Foreground notification badge behavior           | Existing push-received summary/inbox/rental refetch; 15-second fallback badges; inbox mount/focus/foreground refresh. Device delivery QA pending.           |
| 34  | Inspection media attachment error UX             | Adjacent alert with underlying safe error and Retry; successful upload reused for failed attachment.                                                        |
| 35  | Unattached/orphaned FileAsset handling           | No deletion/reset/cleanup added. In-memory pending retry; persistent retention/retry gap documented.                                                        |
| 36  | Admin overdue presentation                       | Derived queue badges and Detail warnings; no BookingStatus change.                                                                                          |
| 37  | Admin outstanding-step presentation              | Exact safe outstanding steps and boundaries in read-only Detail.                                                                                            |
| 38  | Admin custody presentation                       | Actual Start/Return custody flags, not inferred from deadlines/travel.                                                                                      |
| 39  | Admin payout-pending reason                      | Shared DB reason shown in rental detail and payout diagnostics.                                                                                             |
| 40  | Admin OTP non-exposure                           | No plaintext/hash added to Admin compliance or notifications; original admin command boundaries unchanged.                                                  |
| 41  | Legacy booking compatibility                     | NULL bypasses B4 evidence predicate, preserving existing financial rules; isolated legacy test passes.                                                      |
| 42  | Already-paid historical payout protection        | No historical payout/earning rewrite; legacy payout race test reaches PAID exactly once under original authority.                                           |
| 43  | Already-submitted payout handling                | Already-submitted/provider-identified transitions excluded from new first-submission guard.                                                                 |
| 44  | Delivery/Collection regression                   | Four-way fulfillment/arrival and late workflow integration passes; no travel-as-custody shortcut.                                                           |
| 45  | Known Issues regression                          | Known-issue evidence API and gallery source regression tests pass; snapshot/source authorization retained.                                                  |
| 46  | Multi-round discrepancy regression               | Two discrepancy rounds, accepted latest resolution, immutable original review and changed-response guards pass.                                             |
| 47  | Optional Operations escalation regression        | Existing Operations resolution/escalation integration passes; no new bypass authority.                                                                      |
| 48  | Pre-custody cancellation regression              | Pre-custody cancellation participant/security/idempotency integration passes.                                                                               |
| 49  | Cancellation settlement regression               | Refund/commission/retained delivery/collection and balanced ledger compatibility retained; cancellation integration and payment settlement tests pass.      |
| 50  | OTP regression                                   | Late verification plus invalid/expired/exhausted/reused/concurrent OTP integration passes.                                                                  |
| 51  | Start custody regression                         | Only successful Owner verification establishes actual pickup/ACTIVE once.                                                                                   |
| 52  | Return custody regression                        | Renter evidence + Owner confirmation establishes physical Return once; disputed physical Return remains separate from financial agreement.                  |
| 53  | Claims regression                                | Claim holds prevent completion/release; existing claim integration passes.                                                                                  |
| 54  | Accounting regression                            | Payment/accounting/payout suites pass; fulfillment fees preserved, no repricing or ledger authority replaced.                                               |
| 55  | Map/privacy regression                           | Existing location/privacy and media authorization regression suites pass; no new notification/private-map payload.                                          |
| 56  | Single-option fulfillment regression             | Existing fulfillment regression suites pass; no option-selection semantics changed.                                                                         |
| 57  | Focused Database authority test result           | 4 Migration 50 source authority tests pass; live DB guards/checksums and financial integration additionally verified.                                       |
| 58  | Focused API overdue test result                  | 9 projection unit tests pass; 13-booking integration suite includes late lifecycle and outbox assertions.                                                   |
| 59  | Focused late-inspection test result              | Late Owner inspection in focused end-to-end workflow passes.                                                                                                |
| 60  | Focused late-review test result                  | Late Renter review, discrepancy rounds and resolution in focused workflow pass.                                                                             |
| 61  | Focused late-OTP test result                     | Late OTP issue/verify in focused workflow passes.                                                                                                           |
| 62  | Focused Owner Mobile test result                 | Shared rental panel 5 source-regression tests pass; Owner dashboard 2 tests pass; physical layout/camera QA pending.                                        |
| 63  | Focused Renter Mobile test result                | Shared rental panel 5 source-regression tests pass; booking/list regressions pass; physical keyboard/scroll QA pending.                                     |
| 64  | Focused Admin test result                        | Admin routing 5 tests include compliance source/privacy guards; full 82 pass; device/browser visual acceptance pending.                                     |
| 65  | Focused Workers/notification test result         | Worker 6 and Notifications 6 pass; live outbox emission twice remains one event.                                                                            |
| 66  | Focused earnings/payout test result              | Payout integration 7 pass; includes legacy/B4/future filtering, DB allocation rejection, full fee allocation and maximum bound.                             |
| 67  | Migration 49 settlement regression result        | Migration 49 cancellation integration passes; helper settlement exemption explicitly checked.                                                               |
| 68  | Integration result                               | 8 files, 55 tests pass with isolated Redis database 15. Final focused workflow additionally passes 1 test (12 unrelated tests skipped).                     |
| 69  | Full API test count                              | 191 passed.                                                                                                                                                 |
| 70  | Full Mobile test count                           | 218 passed.                                                                                                                                                 |
| 71  | Full Admin test count                            | 82 passed.                                                                                                                                                  |
| 72  | Full Workers test count                          | 6 passed.                                                                                                                                                   |
| 73  | Full Database test count                         | 33 passed.                                                                                                                                                  |
| 74  | Payments test count                              | 21 passed.                                                                                                                                                  |
| 75  | Payouts test count                               | 7 passed in provider package; separate API payout integration 7 passed.                                                                                     |
| 76  | Provider Core test count                         | 9 passed.                                                                                                                                                   |
| 77  | Notifications test count                         | 6 passed.                                                                                                                                                   |
| 78  | Config test count                                | 15 passed.                                                                                                                                                  |
| 79  | API Contracts test count                         | 1 passed.                                                                                                                                                   |
| 80  | Logger test count                                | 1 passed.                                                                                                                                                   |
| 81  | Formatting result                                | Repository Prettier check passed; report formatting checked separately after documentation.                                                                 |
| 82  | Compose validation result                        | Passed.                                                                                                                                                     |
| 83  | Lint result                                      | Passed, max-warnings=0.                                                                                                                                     |
| 84  | TypeScript result                                | Passed across repository.                                                                                                                                   |
| 85  | Repository build result                          | Passed, 12 build tasks.                                                                                                                                     |
| 86  | API production build result                      | Nest production build passed.                                                                                                                               |
| 87  | Admin production build result                    | Next production build passed; 4 routes generated.                                                                                                           |
| 88  | Workers build result                             | TypeScript Workers build passed.                                                                                                                            |
| 89  | iOS Expo export result                           | iOS Hermes export passed.                                                                                                                                   |
| 90  | Android Expo export result                       | Android Hermes export passed.                                                                                                                               |
| 91  | Expo Doctor result                               | 18/18 checks passed.                                                                                                                                        |
| 92  | Expo dependency-check result                     | Dependencies up to date.                                                                                                                                    |
| 93  | Prisma validation result                         | Valid Prisma schema.                                                                                                                                        |
| 94  | git diff --check result                          | Passed.                                                                                                                                                     |
| 95  | Migration 44 status                              | Applied, unchanged.                                                                                                                                         |
| 96  | Migration 45 status                              | Applied, unchanged.                                                                                                                                         |
| 97  | Migration 46 status                              | Applied, unchanged.                                                                                                                                         |
| 98  | Migration 47 status                              | Applied, unchanged.                                                                                                                                         |
| 99  | Migration 48 status                              | Applied, unchanged.                                                                                                                                         |
| 100 | Migration 49 status                              | Applied, unchanged.                                                                                                                                         |
| 101 | Migration 50 status                              | Applied to carrental and carrental_test; final checksums match.                                                                                             |
| 102 | Migration 51 absent                              | Absent.                                                                                                                                                     |
| 103 | carrental migration status                       | 50 applied, no pending/checksum mismatch.                                                                                                                   |
| 104 | carrental_test migration status                  | 50 applied, no pending/checksum mismatch.                                                                                                                   |
| 105 | Pending migrations                               | None.                                                                                                                                                       |
| 106 | Database reset status                            | No reset.                                                                                                                                                   |
| 107 | Historical migration integrity                   | No prior migration edits; all applied migration checksums match both databases.                                                                             |
| 108 | Security/privacy audit                           | No new OTP/private notification media/location/KYC/credential exposure; strict DTO and participant media guards retained/tested.                            |
| 109 | Files changed by this refinement                 | See complete refinement file inventory below; protected demo changes excluded.                                                                              |
| 110 | development-demo.ts protected status             | Preexisting dirty file left untouched by refinement; not staged/reverted/discarded.                                                                         |
| 111 | Current branch                                   | main.                                                                                                                                                       |
| 112 | Current HEAD                                     | 02f0bdd527c59a09a3b8e76986bb96631b5c9c7b.                                                                                                                   |
| 113 | origin/main                                      | 02f0bdd527c59a09a3b8e76986bb96631b5c9c7b.                                                                                                                   |
| 114 | Ahead/behind                                     | 0 ahead / 0 behind local origin/main; no fetch/push performed.                                                                                              |
| 115 | Staged files                                     | None.                                                                                                                                                       |
| 116 | Commit created = no unless separately authorized | No.                                                                                                                                                         |
| 117 | Push performed = no unless separately authorized | No.                                                                                                                                                         |
| 118 | Physical QA checklist ready                      | Ready above; not executed/accepted here.                                                                                                                    |
| 119 | Full B5 not started                              | Not started.                                                                                                                                                |
| 120 | With-driver not started                          | Not started.                                                                                                                                                |
| 121 | No-show policy not started                       | No new no-show policy; existing report action retained.                                                                                                     |
| 122 | Automatic overdue cancellation not implemented   | Not implemented.                                                                                                                                            |
| 123 | Off-app custody confirmation not implemented     | Not implemented.                                                                                                                                            |
| 124 | Production/staging work not started              | Not started.                                                                                                                                                |

## Historical-safety authorization — additional 20 items

1. Nullable integer mapped to handover_workflow_version; no database default.
2. B4 = shared HANDOVER_WORKFLOW_VERSION_B4 = 1.
3. BookingsService booking-hold creation.
4. Server assignment; client-selected version rejected by strict DTO (400 VALIDATION_ERROR).
5. Database BEFORE UPDATE trigger prevents every ordinary change, including NULL → version.
6. Existing rows remain NULL legacy/unclassified; development audit observed all 26 unchanged.
7. No fabricated/heuristic backfill.
8. Existing active/READY rows remain legacy; no mid-booking policy upgrade.
9. Existing legacy completion, release, diagnostics, selection, allocation and processing retained.
10. Explicit B4 Start/Return evidence required through shared financial predicate.
11. Positive unsupported version fails normal eligibility closed; version zero rejected by column CHECK.
12. Server-created current integration fixtures are B4; separate direct legacy/future fixtures preserve compatibility coverage. Demo fixture untouched.
13. Legacy earning releases/selects/allocates without B4 evidence; integration passes.
14. Missing Owner inspection, Renter review, OTP and incomplete ACTIVE Return blockers tested; completed B4 release respects existing availability schedule.
15. No paid historical rewrite; existing legacy payout settlement/idempotency coverage passes.
16. Migration 49 settlement exception preserves retained/refunded components and existing idempotency.
17. Yes: create new bookings for B4 financial physical QA; old QA bookings were not upgraded.
18. Yes, normal migrate deploy applied final Migration 50 to carrental.
19. Yes, applied and checksum-verified in carrental_test; candidate-only iterations documented.
20. Migration 51 absent; migrations 1–49 unchanged; no reset.

## Refinement file inventory

- `apps/admin-web/src/components/AdminConsole.tsx`
- `apps/admin-web/src/components/AdminRouting.test.tsx`
- `apps/api/src/bookings/booking-projection.service.ts`
- `apps/api/src/bookings/bookings.service.ts`
- `apps/api/src/payouts/payout-eligibility.service.ts`
- `apps/api/src/payouts/payouts.service.ts`
- `apps/api/src/rentals/rentals.service.ts`
- `apps/api/test/bookings.integration.test.ts`
- `apps/api/test/payouts.integration.test.ts`
- `apps/mobile/src/features/bookings/MyBookingsScreen.tsx`
- `apps/mobile/src/features/rentals/OwnerRentalsScreen.tsx`
- `apps/mobile/src/features/rentals/RentalOperationsPanels.test.ts`
- `apps/mobile/src/features/rentals/RentalOperationsPanels.tsx`
- `apps/mobile/src/features/vehicles/OwnerDashboardScreen.test.ts`
- `apps/mobile/src/features/vehicles/OwnerDashboardScreen.tsx`
- `apps/workers/src/notification-delivery.test.ts`
- `apps/workers/src/notification-delivery.ts`
- `packages/api-contracts/src/index.ts`
- `packages/database/prisma/schema.prisma`
- `packages/notifications/src/templates.ts`
- `apps/api/src/rentals/workflow-compliance.test.ts`
- `apps/api/src/rentals/workflow-compliance.ts`
- `docs/development/phase13c2kb4-migration50-verification.md`
- `packages/database/prisma/migrations/20260917090000_phase13c2kb4_workflow_compliance/migration.sql`
- `packages/database/src/phase13c2kb4-workflow-compliance-migration.test.ts`
- `packages/notifications/src/templates.test.ts`

The preexisting dirty `packages/database/prisma/development-demo.ts` is not part of this refinement. Normal Next production generation changed its generated type-reference output; it is not manually authored feature work. No source staging or Git history mutation occurred.
