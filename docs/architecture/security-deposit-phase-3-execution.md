# Security Deposit Phase 3: controlled preauthorization

Phase 3 adds a server-owned placement window and a purpose-specific authorization lifecycle while
leaving settlement, claims, capture, and post-return release to Phase 4.

- `SECURITY_DEPOSIT_CONFIGURATION_ENABLED` controls policy configuration and defaults on.
- The legacy `SECURITY_DEPOSIT_ENABLED` flag remains accepted for environment compatibility but no
  longer grants execution authority.
- `SECURITY_DEPOSIT_EXECUTION_ENABLED` controls placement and pickup enforcement and defaults off.
- `SECURITY_DEPOSIT_LEAD_HOURS` controls the action window and defaults to 48 hours.
- `SECURITY_DEPOSIT_POST_RETURN_BUFFER_HOURS` defaults to 24 hours. Placement is rejected before
  any provider call when return plus clearance cannot fit inside the provider's conservative hold
  lifetime.
- Maya execution additionally requires sandbox mode and
  `MAYA_SECURITY_DEPOSIT_PREAUTHORIZATION_ENABLED`, authorization, and void capabilities.
- Production execution is rejected by configuration validation until merchant capability and card
  scheme behavior are approved.

The adapter advertises a conservative six-day authorization lifetime until the merchant's exact
vehicle-rental/card-scheme capability is certified. The command evaluates the proposed hold time,
scheduled return, and post-return buffer against that advertised lifetime before contacting Maya.
It does not assume that the longest duration mentioned in provider guidance applies to every card.

V1 does not silently extend or reauthorize a hold. Production execution remains disabled until
booking amendments can prove that an existing hold remains valid through an amended return and the
clearance buffer.

The immutable booking policy snapshot remains the amount and currency authority. A dedicated
`Payment` with purpose `SECURITY_DEPOSIT` provides provider correlation and retry/reconciliation
state, while `SecurityDepositAuthorization` is the booking-facing lifecycle authority. Unknown
provider outcomes remain pending and reconciliation-required; they never permit pickup.

Reconciliation first uses Maya's exact payment lookup when a payment identifier was persisted. If
the provider succeeded but the API response or local persistence was interrupted before that
identifier was stored, reconciliation uses the already-persisted unique request reference with
Maya's request-reference lookup, then requires matching amount and currency before applying HELD.
An ambiguous or mismatched result stays quarantined and cannot expose another renter attempt.

No Phase 3 migration is required: the existing purpose-specific `Payment`, unique provider request
reference, unique operation idempotency key, `SecurityDepositAuthorization`, and reconciliation
fields already persist the required authority. UNKNOWN is represented by an authorizing payment
with an UNKNOWN payment operation and `reconciliationRequired`; this avoids adding a parallel
booking truth solely to rename an existing durable state.

Pickup completion checks the deposit inside the booking transaction only when execution is enabled.
Cancellation schedules an idempotent void of an authorized deposit. Phase 3 never captures a
deposit and does not implement claims, partial utilization, excess collection, or post-return
settlement.

## Reminders

Required-deposit reminders use the existing durable notification pipeline. The accepted schedule
is 48 hours, 24 hours, and 6 hours before handover. Each execution re-reads and locks the persisted
booking before deciding whether a reminder is still due. A reminder is skipped when the deposit is
already satisfied, the booking is cancelled or otherwise ineligible, the rental payment is not
captured, or handover is no longer in the future.

The stable notification identity includes the booking, reminder threshold, and effective handover
time. This keeps delivery idempotent while allowing a booking amendment that moves handover to
establish a new reminder schedule safely.

At the 2026-10-05 checkpoint, the worker implementation still uses a three-hour boundary for the
final event. The accepted six-hour policy therefore has an implementation mismatch that must be
corrected and regression-tested before this work is called complete. This document records the
accepted authority; it does not claim that the current worker already conforms.
