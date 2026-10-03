# Owner payout methods

Owner payout-method configuration lives under **More → Payout methods**. Earnings & payouts is an
informational financial surface and does not contain payout-method configuration.

## List and add flow

The payout-method list places **Add payout method** above saved methods. Supported method types,
institutions, field labels, and validation limits come from `GET /owner/payout-methods/catalog`; the
mobile app does not own provider availability.

Adding a method progressively asks the Owner to:

1. choose a payout type;
2. choose a server-supported institution;
3. enter the catalog-required details;
4. review masked details; and
5. submit and review the authoritative readiness result.

The create authority remains `POST /owner/payout-accounts`. Raw account identifiers exist only in
transient form state and the create request. Review and result states use masked identifiers.

## Detail and management

`GET /owner/payout-methods/:id` provides safe detail fields, readiness status, primary state, and
action capabilities. Mobile renders `READY`, `PENDING_VERIFICATION`, `NEEDS_ATTENTION`, and
`UNAVAILABLE` as Owner-safe labels and supporting copy.

Set-primary and removal controls are shown only when the server-projected capabilities allow them.
Changing primary affects future payouts; payouts already in progress retain their recorded
destination. Removal uses the existing disable authority and is blocked while a payout is in
progress. The client never invents a fallback primary method.

Editing an existing method is not supported. An Owner who needs different details adds a replacement
method, then uses the server-supported primary/removal actions.
