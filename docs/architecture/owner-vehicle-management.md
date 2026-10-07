# Owner vehicle management

This document describes the current Owner Add Vehicle and vehicle-management contract. The server
remains authoritative for listing lifecycle, publication, booking availability, and removal
eligibility.

## Add Vehicle wizard

The Owner mobile experience presents eight steps:

1. **Details** — identity, specifications, plate information, and description.
2. **Features** — the server-backed curated feature catalog. The **EV & charging** group is shown
   only for `BATTERY_ELECTRIC` and `PLUG_IN_HYBRID` vehicles.
3. **Photos** — the required gallery perspectives, cover-photo selection, replacement, and ordering.
4. **Documents** — the active server-projected required and optional document checklist.
5. **Location** — the embedded private pickup-location search and map-selection flow.
6. **Pricing** — daily pricing and the optional long-booking discount toggle and tiers.
7. **Handover & usage** — handover, fuel/charging, mileage, notice, and availability settings using
   progressive disclosure for conditional fields.
8. **Review** — the final summary, completeness state, section edit navigation, and submission.

Drafts persist on the server and can be resumed. Reference catalogs and accepted values remain
server-owned; mobile presentation must not replace them with independent business authority.

### Draft-section compatibility

The eight-screen UI intentionally preserves the established backend completion identifiers:

- Pricing and Handover & usage are frontend substeps of `POLICIES`.
- Pricing never persists an unsupported `PRICING` value as `lastCompletedSection`.
- Completing Handover & usage completes the backend `POLICIES` section.
- Existing drafts whose last completed section is `POLICIES` resume safely at Review.
- Earlier drafts resume into Pricing when that is the next incomplete frontend substep.

This compatibility rule avoids a draft-schema or API-contract migration while permitting the
clearer eight-step presentation.

## Fleet presentation

Owner Fleet uses compact vehicle cards with stable cover-image geometry. Complete/submitted
vehicles prioritize price, lifecycle badge, marketplace approval status, and a separate daily
availability line only when it communicates a distinct operational fact. Drafts use a distinct,
compact treatment and omit marketplace, price, and location facts that are not yet authoritative;
their action is **Continue setup**. Complete vehicles use **Manage vehicle**.

## Vehicle Details presentation

Vehicle Details uses a hero summary followed by white section surfaces for:

- Vehicle overview
- Registration & verification
- Private pickup location
- Pricing
- Handover & usage
- Known vehicle issues
- Marketplace & availability
- Danger zone

Actions are contextual and compact. The Danger zone exposes removal only through the eligibility
and confirmation flow below.

## Remove vehicle

Removal is an archive/soft-delete operation, never a hard delete. Archival removes the vehicle from
the active Fleet and marketplace operations while preserving historical bookings, payments,
claims, disputes, Security Deposit settlements, earnings, ledger entries, and audit records.

The server blocks archival for:

- an ongoing or pickup-ready rental;
- a future confirmed or capture-pending booking;
- a pending return or inspection workflow;
- an open post-return claim;
- an open dispute; or
- an unresolved Security Deposit settlement.

Cancelled, rejected/expired, and historical completed bookings do not prevent archival. The DELETE
operation runs transactionally, locks and reloads the vehicle, rechecks eligibility, and archives
only after that revalidation succeeds.

### Removal reasons

The stable reason codes are:

- `SOLD_VEHICLE`
- `NO_LONGER_RENTING`
- `VEHICLE_UNAVAILABLE`
- `MAINTENANCE_OR_REPAIRS`
- `REPLACING_VEHICLE`
- `CARSHARE_EXPERIENCE`
- `OTHER`

`OTHER` may include optional detail. Detail is trimmed and limited to 500 characters. Requests with
a non-`OTHER` reason and meaningful `otherReason` are rejected. The reason is persisted for future
reporting and included in audit metadata. Migration
`20261007110000_vehicle_removal_reason` adds the reason fields, archive actor relation, consistency
constraint, and reporting index.

### Mobile removal flow

1. Open the Vehicle Details Danger zone.
2. Check server eligibility.
3. If blocked, show the friendly authoritative blocker reason.
4. If eligible, open the content-sized reason sheet.
5. Use the top-left **Back** action; there is no duplicate bottom Cancel action.
6. Select exactly one reason.
7. Selecting `OTHER` optionally reveals **Tell us more**.
8. Continue to the final destructive confirmation.
9. Archive the vehicle.
10. Return to Fleet, invalidate its cache, and show success confirmation.

Navigation and presentation never bypass the server eligibility recheck.
