# Phase 10 marketplace experience

Phase 10 adds private booking conversations, in-app/push notifications, verified-rental reputation, user support, and report-led moderation while retaining all Phase 1–9 booking and financial state machines. Phase 12 amendments for double-blind reviews and public Host Profiles are documented below.

## Architecture

```text
Domain transaction -> outbox_events -> outbox dispatcher -> BullMQ domain-events
                                                     -> policy/template/recipient resolver
                                                     -> notifications + push deliveries
                                                     -> fake or Expo provider
                                                     -> receipt reconciliation/token cleanup
```

In-app rows use structured `templateKey`, safe variables, and an internal deep link. Domain services never write arbitrary push prose. `stableKey = SHA-256(eventType:userId:sourceId)` makes duplicate event handling converge. Delivery rows preserve attempts and safe failure metadata; token values are never returned by notification APIs or written to logs.

Messaging uses one primary conversation per eligible booking, participant-scoped authorization, cursor history, immutable text, read markers, rate limiting, and idempotent send keys. Renter/owner mode changes presentation only; booking participation grants access.

Reviews are limited to completed bookings:

- renter -> vehicle and owner
- owner -> renter
- default deadline: 14 days after the recorded `COMPLETED` transition
- aggregate source: published review rows only
- display: exact average/count or `New`; no fabricated popularity

The Phase 12 publication amendment is double-blind. First-side submissions have publication state
`PENDING`, remain hidden from the counterpart/public, and do not affect aggregates. Counterpart
submission publishes the booking's eligible reviews together; otherwise the scheduled worker publishes
eligible pending reviews after the deadline. Publication and moderation are independent. Only published,
moderation-visible rows enter public lists and aggregates. Overall rating is required; allowed category
ratings and written feedback are optional. Submission/publication notifications use the outbox and do
not reveal pending content.

Support tickets can safely reference a record the creator owns or participates in. User-visible replies and internal notes are separate records. Only support/admin roles can create internal notes, and the user endpoint filters them at the database query boundary.

## Event-to-notification policy

| Event family                                        | Recipient          | Category/template         |
| --------------------------------------------------- | ------------------ | ------------------------- |
| `BOOKING_OWNER_REQUESTED`, `BOOKING_AWAITING_OWNER` | owner              | booking requested         |
| accepted/confirmed, rejected                        | renter             | booking accepted/rejected |
| cancelled/expired                                   | renter and owner   | booking cancelled/expired |
| `PAYMENT_*`, `REFUND_*`                             | renter             | payment update            |
| pickup, inspection, rental, return                  | renter and owner   | rental update             |
| claim, dispute, additional charge                   | renter and owner   | claim update              |
| `EARNING_*`, `PAYOUT_*`                             | owner              | earnings/payout update    |
| `NEW_MESSAGE`                                       | other participant  | new message               |
| `BOOKING_COMPLETED`, `REVIEW_AVAILABLE`             | renter and owner   | review available          |
| review submitted / reviews published                | counterpart / both | review state update       |
| support reply                                       | ticket creator     | support update            |

Unknown events are intentionally ignored until a policy is approved. Financial events are consumed, never recreated or mutated by notification delivery.

## API surface

- `/api/v1/conversations`, `/:id`, `/:id/messages`, `/:id/read`
- `/api/v1/notifications`, `/summary`, `/:id/read`, `/read-all`, `/:id/opened`
- `/api/v1/notification-preferences`, `/api/v1/push-tokens`
- `/api/v1/bookings/:reference/review-eligibility`, `/:reference/reviews`
- `/api/v1/vehicles/:id/reviews`, `/hosts/:reference/reviews`, `/owners/:id/reviews`, `/users/:id/reviews`
- `/api/v1/hosts/:publicReference` (privacy-safe public Host Profile)
- `/api/v1/support/tickets` and `/:reference/messages`
- `/api/v1/reports`
- `/api/v1/admin/support/tickets`, `/admin/moderation/reports`, report-linked message/review moderation

## Local push setup

The default `.env` uses `PUSH_PROVIDER=fake`, so automated tests require no APNs/FCM credentials. Set `PUSH_PROVIDER=expo` for Expo delivery and provide `EXPO_PUBLIC_PROJECT_ID` to the mobile app. `EXPO_PUSH_ACCESS_TOKEN` is optional and is used only when enhanced Expo push security is enabled. Test remote push on a physical device; the in-app inbox works in simulators and when notification permission is denied.

## Operational controls

- `POST_RENTAL_MESSAGING_DAYS=30`
- `REVIEW_WINDOW_DAYS=14` (configurable from 1–14 days; PostgreSQL enforces the 14-day maximum)
- `MESSAGE_MAX_LENGTH=2000`
- `MESSAGE_RATE_LIMIT_PER_MINUTE=20`
- `NOTIFICATION_DELIVERY_INTERVAL_SECONDS=10`
- `PUSH_RECEIPT_DELAY_SECONDS=900`

Production rejects the fake push provider. Expo send tickets are followed by receipt checks; `DeviceNotRegistered` disables the token. Retryable failures use bounded backoff. In-app notifications remain available during push outages.

## Verification

The Phase 10 integration suite has six scenarios covering participant isolation, eight-way duplicate message concurrency, message immutability/read state, logical-notification idempotency, successful receipt reconciliation, invalid-token cleanup, eight-way review concurrency, rating moderation, ticket privacy, and internal-note isolation. Provider unit tests cover deterministic success and failure classification.

```bash
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm test:integration
pnpm verify
```

Deferred: WebSockets, message attachments, user blocking, automated/AI moderation, marketing campaigns, email/SMS lifecycle sending, and automated use of ratings in ranking or finance.

Public host navigation uses an opaque owner public reference and excludes legal/contact/address/KYC,
payout, internal-ID, exact-location, private-document, pending-review, and Admin/security data. Vehicle
reviews and host reviews remain separate subjects. See ADRs 0023 and 0024.
