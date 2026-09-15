# Phase 13C-2K-B4 — Physical handover, inspection, and custody

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / MIGRATIONS 44–49 PASS / PHYSICAL QA PENDING**

## Authority boundaries

`BookingStatus` remains the rental/custody lifecycle authority. Owner Delivery and Owner
Collection travel are separate append-only operational events; `ARRIVED` never transfers custody.
The immutable `BookingFulfillmentSnapshot` remains the contractual source for fulfillment methods
and exact booking-party addresses. Legacy bookings without that snapshot retain Renter Pickup and
Renter Return behavior and cannot create travel events.

Start custody transfers only after the Owner's finalized Pickup inspection, explicit persisted
Renter agreement, a valid existing `InspectionVerificationChallenge`, and the transactional
`READY_FOR_PICKUP` to `ACTIVE` transition. Challenge issuance no longer creates an implicit Renter
agreement. A Renter disagreement persists unchanged, opens the existing incident path, blocks code
issuance, and leaves custody unchanged. Migration 45 adds a separate immutable Owner response and
Renter resolution review. An accepted resolution can restore OTP eligibility; `STILL_DISAGREES`
continues the Operations/dispute hold. Challenge issuance and OTP verification independently
revalidate the complete resolution and safety boundary. A continued disagreement can resume only
after an authorized Operations user records the explicit `HANDOVER_MAY_RESUME` outcome; changing a
generic Incident or Dispute to resolved is not equivalent authority.

Operations cannot transfer custody. The legacy Admin `CONFIRM_PICKUP` command is retained only as
a compatibility surface and rejects with `PICKUP_PARTICIPANT_OTP_REQUIRED`. The sole ordinary Start
custody-transfer mechanism remains Owner verification of the Renter's six-digit challenge.

## Start-condition disclosure and safety

New Owner-authored Start inspections require an explicit `NO_KNOWN_ISSUES` or `ISSUES_REPORTED`
declaration. A null disclosure state is deliberately retained only for legacy inspections and does
not mean the Owner declared that no issues existed. Structured issues record category, vehicle
area, description, and a server-authoritative `COSMETIC`, `OPERATIONAL`, or `SAFETY_CRITICAL`
classification. Issue evidence references existing private `InspectionMedia`; standard photos
remain mandatory and image storage is not duplicated.

Cosmetic issues form part of the pre-rental baseline without automatically blocking handover.
Operational issues create an Operations hold. Safety-critical issues additionally place the
vehicle in Maintenance and block challenge issuance, OTP verification, custody transfer, and the
`ACTIVE` transition. The same maintenance boundary applies when an undisclosed safety-critical
condition is added through the Owner's immutable discrepancy response. Renter acceptance cannot
waive that safety block. The Return view reuses the Start baseline for human review; it does not
infer fault, liability, or a charge.

The Owner response choices are `ACKNOWLEDGE_CONDITION`, `CLARIFY_EXISTING_EVIDENCE`, and
`REQUEST_SUPPORT`. There is no participant override that rejects the report and continues. An
acknowledged undisclosed condition becomes a structured Start-baseline issue without overwriting
the original finalized inspection or original `DISAGREED` confirmation.

Return evidence is authored only by the Renter. The Owner reviews that same evidence. Owner
agreement or disagreement completes the existing usage and physical-return transaction; a dispute
can remain open after custody has returned and must not keep the rental falsely active.

## Travel progression

- Owner Delivery: Scheduled → Preparing → On the way → Arrived.
- Owner Collection: Scheduled → On the way → Arrived.
- Repeated milestones are idempotent; backward, skipped, wrong-method, wrong-actor, too-early, and
  invalid-lifecycle transitions fail closed.
- Current travel state is derived from immutable events. No historical events are fabricated.
- Exact addresses are returned only through authenticated participant and Operations rental views;
  they never enter public Search, Map, clustering, or vehicle-detail projections.

## Evidence and measurement

The existing mandatory photo taxonomy, private file authorization, MIME/size validation,
duplicate-file protection, BigInt odometer metres, and 0–10000 fuel/SOC basis points remain
unchanged. Owner Delivery travel before pickup and Owner Collection travel after return are outside
Renter mileage because measurements remain attached to the two custody-boundary inspections.

## Persistent vehicle known issues

Migration 47 separates the vehicle's current known condition from immutable booking inspection
history. `VehicleKnownIssue` uses the existing Migration 45 category, vehicle-area, and
classification enums and has a strict `ACTIVE` to `RESOLVED` lifecycle. Creator, resolver, and
server timestamps are authoritative. Resolution is non-destructive and cannot rewrite a previous
booking's Start inspection. Historical inspection issues are deliberately not backfilled because
old evidence cannot prove that an issue remains present today.

Owners manage active and resolved issues from Hosting → Vehicles → Vehicle Detail. The guided form
performs a real authenticated server mutation, reports a description shorter than three characters
instead of silently returning, disables repeat submission while pending, preserves input after a
server failure, and refreshes the authoritative lists after success. Supporting images use a
separate private `VehicleKnownIssueEvidence` relationship; they do not reuse booking-specific
`InspectionConditionIssueEvidence`.

An Owner pickup-inspection draft preloads every active issue for the booked vehicle. The Owner must
either include each issue or mark it resolved; an active registry cannot be bypassed with a false
`NO_KNOWN_ISSUES` declaration. Submission copies server-authoritative handover-time values into new
booking-specific `InspectionConditionIssue` rows. A newly discovered ongoing issue can be entered
once and is created together with its current Start snapshot in the inspection transaction.
Subsequent edits or resolution affect only future handovers.

Active Operational and Safety-critical issues conservatively place the vehicle in Maintenance.
Safety-critical state continues to block public eligibility, Start handover, challenge issuance,
OTP verification, and custody transfer. Resolving an issue never makes the vehicle Available
automatically; the existing listing, maintenance, availability, occupancy, and other active-issue
authorities must still pass before an explicit availability change.

Operations Vehicle Detail presents active and resolved current known issues, authorized private
evidence, timestamps, and vehicle operational status. Rental Detail labels current mutable vehicle
state separately from the immutable booking Start-condition snapshot. Public Search, Map,
clustering, and public Vehicle Detail projections remain unchanged and do not expose this registry
or its evidence.

ICE and Hybrid vehicles retain fuel measurement, Plug-in Hybrid retains fuel and battery SOC, and
Battery Electric retains battery SOC. Charging settlement and claims/financial policy redesign are
outside B4.

## Migration 44

`20260913100000_phase13c2kb4_handover_travel` creates `HandoverPhase`,
`HandoverTravelStatus`, and `booking_handover_travel_events`. It enforces one event per
booking/phase/status, indexed chronological lookup, restrictive Booking/User foreign keys, and the
repository's database-level append-only trigger. It does not alter `BookingStatus`, mutate either
fulfillment snapshot, backfill rows, or modify historical migrations.

## Migration 45

`20260913160000_phase13c2kb4_condition_discrepancy` is additive. It adds the nullable legacy-safe
disclosure state, structured condition issues, restrictive issue-to-inspection-media evidence
relationships, immutable Owner discrepancy responses, and immutable Renter resolution reviews.
It performs no data backfill, creates no fake issue or no-known-issues declaration, does not alter
old confirmations/media/bookings, and leaves Migration 44 unchanged. Finalized condition rows and
participant resolution records have database-level mutation guards.

## Migration 46

`20260913190000_phase13c2kb4_operations_handover_resolution` adds one immutable, auditable
`PickupHandoverOperationsResolution` for a blocked pickup incident, with optional restrictive
links to its Dispute and continued-disagreement review. The explicit outcomes are
`HANDOVER_MAY_RESUME`, `BOOKING_CANCELLATION_REQUIRED`, `MAINTENANCE_REQUIRED`, and
`SUPPORT_FOLLOW_UP_REQUIRED`. The authenticated Operations principal supplies attribution and an
auditable reason is mandatory. The migration performs no historical backfill and database triggers
reject ordinary updates and deletes.

Only `HANDOVER_MAY_RESUME` can remove the reviewed disagreement hold, and it still cannot issue or
verify a challenge while a safety-critical condition, Maintenance state, separate operational
hold, blocking incident/dispute, invalid lifecycle, or incomplete Start inspection remains.
Cancellation-required uses the existing cancellation/support lifecycle without inventing a
financial result. Maintenance-required preserves the handover block and places the vehicle in
Maintenance. Support-follow-up preserves the hold.

## Migration 47

`20260913210000_phase13c2kb4_vehicle_known_issues` adds `VehicleKnownIssueStatus`,
`vehicle_known_issues`, and `vehicle_known_issue_evidence`. It reuses all three Migration 45 issue
taxonomies, has restrictive Vehicle/User/FileAsset foreign keys, indexed active and classification
lookup, and a database check requiring resolution actor and timestamp only for `RESOLVED` rows. It
contains no inspection backfill and leaves Migrations 44–46 unchanged.

## Migration 48

`20260914120000_phase13c2kb4_known_issue_evidence_snapshots` replaces the global
`InspectionMedia.fileAssetId` uniqueness rule with inspection-scoped uniqueness. This permits the
same private vehicle-known-issue evidence asset to be referenced by multiple immutable booking
inspection snapshots without permitting duplicates inside one inspection. Finalization copies the
selected known issue's evidence relationships into the pickup inspection. Historical condition
snapshots are backfilled only when exactly one known issue on the booked vehicle matches the
recorded category, area, classification, and description; ambiguous snapshots fail closed and are
left unchanged.

## Presentation refinements

Single supported Start/End methods render as static authoritative handover cards; dual-capability
vehicles retain the selector. Foreground push handling refetches the server-authoritative unread
summary/list and only the relevant booking/rental/dashboard query families without marking any
notification read. Disagreement overrides all ready/code copy with a participant-specific
`Handover paused` state.

The Owner Start-inspection form now presents explicit selected condition declarations, supports
multiple draft issues with Edit/Remove controls, explains Cosmetic/Operational/Safety-critical
effects, and requires at least one saved issue when issues are reported. Pickup verification
dismisses the numeric keyboard immediately and disables repeat submission while pending. Renter
logout uses the same destructive treatment as Owner logout. The Admin rental view shows structured
condition issues and the complete participant discrepancy history before presenting human-readable
Operations outcomes; it no longer presents an ordinary administrative pickup confirmation.

Persisted Notification rows and the server unread summary remain badge authority. Local physical
QA requires API, Workers, Metro/mobile, PostgreSQL, and Redis to run together. If Workers is
stopped, domain events correctly remain pending in the outbox but no Notification rows can exist;
starting Workers must drain those events through the normal idempotent pipeline rather than manual
row mutation.

## Migration 49 and continued participant resolution

`20260914150000_phase13c2kb4_continued_resolution_cancellation_settlement` replaces the former
one-response-only discrepancy constraint with immutable, incident-scoped response rounds. Each
round records its number and predecessor, retains its own single renter review, and remains covered
by the append-only database guard. Existing response rows become round 1; no escalation or
financial history is fabricated.

`STILL_DISAGREES` now means that the participants are still resolving the pre-custody condition.
It does not automatically create mandatory Operations work. The Owner can submit a materially
different next response, the Renter can accept or continue disagreeing, and either participant can
explicitly request CarShare support. The latest round controls OTP eligibility while the complete
ordered history remains available to Mobile and Admin.

Migration 49 also adds one immutable `BookingCancellationSettlement` for the narrowly authorized
Renter cancellation during an unresolved, pickup-ready disagreement before custody transfer. The
server—not Mobile—derives the quote from the accepted pricing, commission, fulfillment, captured
payment, and authoritative Start travel snapshots. Accepted commission remains platform revenue;
unstarted net Rental is refunded; Collection is always refunded; and Owner Delivery is retained
only after the server-authoritative `START / ARRIVED` milestone. Repeated cancellation requests
reuse the same cancellation, settlement, refund operation, ledger reversal, and Owner notification.
An indeterminate provider result remains quarantined for reconciliation and is never retried as a
second refund.

Renter Mobile shows the server quote before destructive confirmation and the authoritative refund
summary afterward. Owner Mobile shows that the booking ended before handover, the structured
reason, retained completed-Delivery earning, and absence of Collection earning. Admin shows the
ordered rounds, participant-versus-escalated state, settlement components, refund state,
`actualPickupAt`, and the fact that custody never transferred. No Admin OTP bypass is introduced.

## Deferred and non-scope

Physical-device acceptance remains pending; the candidate is ready for the Owner checklist below.
No live map/tracking, Return OTP, duplicate evidence
set, automatic no-show penalty/refund, new provider, full B5, With-driver, staging, DigitalOcean,
production Google configuration, or production provider operation is included.

## Candidate verification

- Migration count: 49. Migration 49 must be present in both validated local `carrental` and
  `carrental_test` before physical QA; no reset or fabricated settlement backfill is permitted.
- Repository verification, unit tests, typechecks, lint, production builds, and iOS/Android Expo
  exports: PASS.
- Integration suite: 8 files / 53 tests PASS.
- Expo Doctor: 17/17 PASS; Expo dependency compatibility: PASS.

Physical QA must additionally exercise no-known-issues, cosmetic/operational/safety-critical
disclosures, issue evidence, unresolved and accepted discrepancy paths, continued disagreement,
foreground badges for each actionable event, safety revalidation after challenge issuance, and the
Start baseline during Return review. B4 remains unstaged until that Owner review is complete.

Refinement #1 focused physical QA:

1. Open Owner Vehicle Detail → Known vehicle issues.
2. Add Scratch / Passenger side / Cosmetic with a valid description and save it.
3. Confirm it appears in Active; add a second issue and confirm the active count is two.
4. Mark one resolved and confirm Active decreases while Resolved retains it.
5. Create a future booking and begin the Owner Start inspection.
6. Confirm only active issues preload and require no repeated entry.
7. Finalize Start inspection and confirm the Renter sees the booking-specific baseline.
8. Resolve the vehicle issue later and confirm the historical booking remains unchanged.
9. Create another future booking and confirm the resolved issue no longer preloads.
10. Add a new ongoing issue once during handover and confirm it persists for a future booking.
11. Verify Admin shows Active/Resolved current issues separately from the Start snapshot.
12. Verify public Search, Map, clusters, and public Vehicle Detail expose neither issues nor evidence.

Refinement #2 focused physical QA:

1. Renter reports a pickup discrepancy; Owner submits response round 1.
2. Renter chooses Still disagree and confirms the UI says participants are resolving—not that
   Operations review is mandatory.
3. Owner submits a materially different response round 2; confirm both rounds remain visible.
4. Renter accepts round 2 and confirms OTP becomes available without Operations when no independent
   safety or operational block exists.
5. Repeat with round 2 still disputed; confirm Continue resolving, Cancel booking, and Contact
   CarShare support are available.
6. Preview cancellation for pickup/return, pickup/collection, and Owner Delivery before and after
   `ARRIVED`; compare every displayed component with the server response.
7. Confirm cancellation keeps `actualPickupAt` null, releases occupancy, invalidates outstanding
   pickup challenges, and cannot clear a vehicle safety/Maintenance hold.
8. Retry the same cancellation and confirm one cancellation, settlement, refund operation, ledger
   reversal, and Owner notification.
9. Confirm Renter, Owner, and Admin render the authoritative post-cancellation summaries and that
   Workers deliver the Owner notification through the normal outbox path.
10. Explicitly request support on a separate booking and confirm Migration 46 Operations outcomes
    remain available without any Admin OTP bypass.
