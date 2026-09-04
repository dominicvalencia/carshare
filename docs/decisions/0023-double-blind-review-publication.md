# ADR-0023: double-blind review publication and public reputation

- Status: Accepted (Phase 12 marketplace completeness)
- Date: 2026-09-04

## Decision

Completed-booking reviews have publication state independent of moderation state. The first party's
reviews remain `PENDING` and are excluded from counterpart/public reads and aggregates. Counterpart
submission publishes the booking's eligible pending reviews together. If no counterpart submits,
scheduled worker processing publishes eligible pending reviews after the configured deadline.

Renter authors may review the vehicle and owner; owner authors may review the renter. Overall rating
is required, supported category ratings and text are optional, and the existing booking/author/type
unique constraint prevents duplicates. Only `PUBLISHED` publication rows with visible moderation state
feed public lists and projections. Submission/publication notifications contain no premature review
content and are emitted through the transactional outbox.

## Consequences

Neither party can condition a review on seeing the counterpart's content. Moderation can hide content
without rewriting original evidence, and ratings never affect financial calculations.
