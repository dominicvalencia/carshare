# Security deposit Phase 1 foundation

Security-deposit configuration is part of the immutable `VehiclePolicyVersion`. Owners may select
no deposit or one server-approved, currency-aware tier. The API is the tier authority; clients must
read `GET /api/v1/security-deposit/policy` and must not embed tier values.

Booking requests copy the selected terms into `BookingPolicySnapshot` at the same time as existing
pricing and policy terms. Later vehicle-policy versions and booking amendments do not modify this
snapshot. Deposit amounts remain separate from rental subtotal, total, commission, earnings,
ledger, and payout calculations.

`SecurityDepositAuthorization` remains the booking-scoped execution lifecycle. Phase 1 does not
create a required-deposit authorization or payment, call a provider, consume claims, or block
pickup. Required bookings therefore project `PENDING`, zero held/captured/released amounts,
`executionAvailable: false`, and `blockingPickup: false`.

Configuration capability and financial execution capability are intentionally separate. The
policy endpoint exposes configuration while `SECURITY_DEPOSIT_ENABLED` and provider capability
flags continue to gate all future financial execution.
