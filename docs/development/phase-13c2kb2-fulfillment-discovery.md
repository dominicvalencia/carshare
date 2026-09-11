# Phase 13C-2K-B2 fulfillment search and discovery

## Status

Implementation and automated verification are complete. Physical renter UX acceptance is pending.

## Authoritative behavior

Public search accepts a separate `handover` capability filter: `ANY`, `PICKUP_AVAILABLE`,
`DELIVERY_AVAILABLE`, or `PICKUP_AND_DELIVERY`. It reads the latest immutable vehicle policy.
“Pickup & delivery” means that both start capabilities are published; it is not a booking method.

Search-location delivery eligibility is evaluated on the server from the search coordinates, the
PostGIS vehicle distance, the requested pickup timestamp, the policy radius, and minimum notice.
The mobile client renders the result and never computes serviceability. A contextual failure for a
vehicle fails closed for that vehicle and does not create a booking decision.

Search cards expose only capability booleans, contextual delivery status/reason, the configured
notice needed to explain `INSUFFICIENT_NOTICE`, and a rounded distance. They do not expose
coordinates, service radii, fees, collection policy, or private owner data. Public vehicle detail
exposes approved general handover capabilities, approximate pickup area, policy fees, approximate
radius, and friendly delivery-and-collection notice wording. It does not promise that a booking is
eligible; final totals and fulfillment eligibility remain deferred to booking.

## UX boundary

- Handover is single-select and defaults to Any.
- Result badges use Pickup, Delivery, or Delivery to your location; contextual delivery replaces
  the generic Delivery badge.
- Search shows restrained secondary notice guidance only when the authoritative contextual reason
  is `INSUFFICIENT_NOTICE`; it does not show that guidance for `OUTSIDE_SERVICE_RADIUS`.
- Empty results explain when a handover filter is responsible.
- Vehicle detail separates start and end handover capabilities.
- Self-drive labeling is deferred until Phase 13C-2K-C.

## Owner configuration and publication lifecycle

The Owner vehicle editor's existing **Policies** step is the authority-preserving entry point for
Handover options. Existing vehicles load their latest immutable policy values; new vehicles default
to renter pickup and renter return, with owner delivery and collection disabled. Enabling either
owner-provided service reveals a shared service-area selector and **Delivery & collection notice**.
The notice applies only to Owner delivery or collection, not renter pickup or return. Delivery and
collection retain separate PHP fee inputs, including zero for a free service. Saving uses the
existing `POST /owner/vehicles/:id/policy-versions` endpoint and creates a new immutable version
while carrying forward unrelated values from the latest policy. The complete policy form keeps all
long-booking discount inputs with their existing explanation before the separate Handover section.

Vehicle Detail includes a direct **Edit handover options** entry point and factual Marketplace
status guidance. There is no generic Owner publish switch. A new vehicle remains a draft until its
required setup is complete and the Owner submits it for Operations review. After approval, the
existing operational control can mark it available or temporarily unavailable. Public Search still
independently requires an approved and available vehicle, a verified Owner, a location, a latest
policy, current verified required documents, and a public-ready cover photo. Fulfillment settings
cannot bypass any of these conditions.

## Deferred

Booking fulfillment selection, exact address capture, quote arithmetic, booking snapshots,
with-driver service, maps/geocoding providers, accounting, inspection changes, Admin operations,
staging, and production certification are outside B2.

Phase 13C-2K-B3 will present Pickup/Delivery and Return/Collection choices during booking and
revalidate serviceability authoritatively. If Delivery fails minimum-notice validation, the future
booking choice should be unavailable and explain the Owner's configured notice. B2 does not add
that booking control or calculate the decision on the mobile client.
