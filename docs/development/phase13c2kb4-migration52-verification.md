# Migration 52 — historical physical-handover reporting

Date: 2026-09-19. Local development/test candidate only; physical acceptance remains pending. No commit, push, staging or production deployment was performed.

Migration `20260919183000_pickup_handover_time_recovery/migration.sql` adds an immutable Owner report and an independent immutable Renter response for a Start handover that physically occurred outside the app. It does not backdate `Booking.actualPickupAt`, change contract dates or prices, manufacture inspection evidence, or bypass the normal expiring pickup OTP. `actualPickupAt` remains the successful OTP verification time.

The Owner must report when physical custody changed while choosing the overdue Start evidence waiver. The server and database reject a time before the persisted pickup-window start (falling back to contractual `rentalStart`), before recorded Delivery `ARRIVED`, after the current server time, or at/after contractual `rentalEnd`. The mobile date/time picker applies the same minimum and maximum boundaries as guidance; API and database validation remain authoritative.

The Renter sees the exact reported time and can confirm it, propose a different valid time, or state that the vehicle was not received. Responses are append-only and cannot be changed. A confirmed response is required before OTP issuance/verification and by the shared database financial blocker. A disputed/not-received response pauses activation for Operations review; this candidate adds read-only Admin visibility but no new Admin custody override or unilateral time-selection authority.

Both local databases have 52 applied migrations and no pending migration. Automated verification completed:

- Prisma schema validation passed.
- API and Mobile TypeScript passed.
- Database, API and Mobile focused tests passed (3, 10 and 7 tests).
- Admin routing/presentation tests passed (5 tests).
- Database, API, Mobile and Admin lint passed.
- Full API integration passed: 8 files, 59 tests, using isolated Redis database 15.
- `git diff --check` passed.

Physical QA should verify the native date/time picker on iOS and Android, earliest/latest boundaries, Owner idempotency, all three Renter responses, OTP blocking before confirmation, current-time `actualPickupAt`, unchanged contract dates/pricing, Admin audit presentation, and accessibility with enlarged text and screen readers.
