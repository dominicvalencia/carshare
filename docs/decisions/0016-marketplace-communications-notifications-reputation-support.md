# ADR 0016: Marketplace communications, notifications, reputation, and support

Status: Accepted (Phase 10)

## Context

The marketplace needs private booking communication, lifecycle notifications, verified-rental reviews, and support/moderation without weakening the transactional-outbox, authorization, evidence, or financial boundaries established in Phases 1–9.

## Decision

- A booking has at most one primary renter/owner conversation. PostgreSQL creates it when a booking first reaches `AWAITING_OWNER` or a later legitimate lifecycle state. `CANCELLED` and `EXPIRED` conversations are read-only. A completed booking remains writable for the configured post-rental period (30 days by default).
- MVP messaging uses cursor-paginated REST reads and five-second detail polling. WebSockets are deferred until connection authorization and delivery infrastructure justify the operational cost.
- Sent message content is immutable. Only report-linked, permissioned moderation can tombstone it; the original row remains auditable. Inspection and claim evidence stays in the dedicated evidence system.
- Domain modules continue to write transactional outbox events. A BullMQ domain-event consumer applies centralized recipient, category, template, channel, and deep-link policies. Stable event/user/source hashes converge duplicate delivery to one logical notification.
- In-app notifications are authoritative. Push is additive through a provider interface with deterministic fake and Expo implementations. Provider failures are classified as retryable or permanent; permanent device-registration failures disable the token. Email/SMS channels and preferences are modeled but lifecycle fan-out remains deferred.
- Reviews require a completed booking and exact participant/subject relationship. The configurable MVP review window defaults to and cannot exceed the database-enforced 14-day ceiling. One author/type review is allowed per booking. Published reviews update derived vehicle, owner, and renter rating projections transactionally; ratings never drive financial decisions.
- Support tickets are private to their creator and authorized staff. Internal notes have a distinct visibility value and a database role guard. Administrative assignment, workflow, replies, moderation, and content actions require granular permissions and audit records.
- General conversation surveillance is not exposed. Staff access to messages/reviews begins from a moderation report. User blocking is deferred because it must preserve active-rental communication.

## Consequences

Notification policy and provider changes do not alter domain state machines. In-app history survives denied push permission and provider outages. Search/detail can show accurate review counts without a mutable `vehicle.rating` source of truth. Realtime transport, attachments, marketing fan-out, user blocking, and automated moderation remain later-phase work.
