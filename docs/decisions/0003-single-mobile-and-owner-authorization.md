# ADR-0003: one mobile application and owner authorization

- Status: Accepted
- Date: 2026-08-19

## Decision

Ship one React Native binary with renter and owner modes. One user can hold both `RENTER` and `OWNER`.
The `OWNER` role is granted when onboarding begins and is not repeatedly removed when verification
changes.

Owner operational authorization checks both the `OWNER` capability and `OwnerProfile.status`:
`DRAFT`, `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, or `SUSPENDED`. Draft vehicle creation and
onboarding are available before verification; publication and booking acceptance require `VERIFIED`.

## Consequences

Authentication is shared while renter and owner business modules remain isolated. Operating mode is
a UI preference, never an authorization control. Compact navigation places Favorites and Earnings in
secondary surfaces instead of permanent tabs.
