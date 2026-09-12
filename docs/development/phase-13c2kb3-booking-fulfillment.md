# Phase 13C-2K-B3 booking fulfillment selection and pricing

Status: availability and Google Maps location-picker refinements implemented; complete B3 candidate
remains uncommitted pending final physical review.

## Authority and flow

The renter chooses the start and end handover after dates and before the authoritative quote. The
existing quote endpoint accepts the selected methods and a structured booking-specific destination
when owner delivery or collection is selected. Search or device location is only a convenience
prefill; the renter confirms it and the API remains authoritative.

The supported combinations are:

- renter pickup and renter return;
- renter pickup and owner collection;
- owner delivery and renter return; and
- owner delivery and owner collection.

For delivery plus collection, “Same as delivery location” copies the full confirmed destination
into the immutable end location. Collection-only requires an independent destination. Pickup and
renter return use the private contractual vehicle location without changing existing public exact-
location release rules.

## Serviceability and quote evidence

The API validates policy support, coordinates, the inclusive PostGIS service radius, and minimum
notice. Delivery notice is measured against rental start; collection notice is measured against
rental end. The client does not supply distance, serviceability, or money authority.

Migration 43 adds one immutable `PricingQuoteFulfillment` per B3 quote. It records both methods,
structured start/end locations, distances, radius, notice, fees, currency, and the source policy
version. Quote, quote lines, and fulfillment evidence are created atomically. Selected owner
delivery and collection have explicit quote lines even when free. Rental duration discounts apply
only to the rental component.

Booking creation consumes only `quoteId`, rejects a stale latest policy or changed serviceability,
and transactionally copies the quote record into the existing append-only
`BookingFulfillmentSnapshot`. Historical bookings without a snapshot continue to project renter
pickup, renter return, and zero fulfillment fees.

Exact destinations are private to the quote renter, booking renter, booking owner, and authorized
operations access. They are not part of public search, public vehicle detail, analytics, or routine
logs.

## Minimum accounting extension

The authorized payment total is the exact sum of discounted rental, delivery, and collection.
Capture fails closed unless both the provider amount and pricing snapshot total reconcile to those
components. CarShare commission continues to use the rental component only. Delivery and
collection are recorded separately and allocated 100% to owner payable at capture. Zero-fee
services create no artificial earning. Existing security-deposit and renter-mileage semantics are
unchanged.

Existing rental GBV, commission, Owner Revenue, financial trend, and marketplace report contracts
remain rental-defined and are not silently reclassified in B3.

## Deferred boundaries

Phase B4 must adapt physical pickup/return inspections, verification challenges, custody, and
handover execution for each fulfillment method. B3 does not add delivery-specific inspections,
collection custody transitions, en-route states, live tracking, or OTP redesign.

The remaining B5 work includes fulfillment refund allocation policy, detailed payout and earning
presentation, service-component reporting, lifecycle reversals, and operations tooling. With-driver,
external mapping/geocoding, airports, public staging, provider webhooks, and production provider
operations remain deferred.

## Repository-wide location-entry rule

CarShare uses the shared Google-backed `LocationPicker` whenever a user chooses an exact physical,
contractual, or operational point. Renter Delivery, renter Collection, and the Owner's private
vehicle pickup/return point are exact-entry surfaces. General discovery-area selection remains a
lightweight area selector, while public vehicle detail and booking detail remain display-only.
Identity addresses, administrative evidence, and private internal locations retain their
purpose-specific workflows and do not gain a map merely because they contain address text.

The same thin picker provides search, map movement, optional current foreground location, reverse
geocoding, readable normalized address review, explicit confirmation, and safe cancel. Contextual
copy is supplied through props rather than a duplicate Owner implementation. Provider endpoints
allow authenticated marketplace RENTER or OWNER roles, including a pure marketplace Owner, while
remaining closed to unauthenticated, roleless, and administrative-only principals. Existing
per-principal rate limits remain unchanged.

`VehicleLocation` remains the single authority for the Owner's current private pickup/return point.
The Owner sees a readable confirmed address and never edits raw coordinates. Public browsing sees
only city/province and rounded distance. The exact point is shared only where permitted for an
authorized booking. Owners may choose a meeting point rather than a home address. Changing the
current point affects new spatial search and serviceability decisions but never rewrites immutable
`PricingQuoteFulfillment` or `BookingFulfillmentSnapshot` evidence; existing stale-quote checks
continue to require a new quote when fulfillment evidence no longer matches.

## Owner availability refinement

`VehicleBlockedPeriod` is historical operational evidence rather than disposable configuration.
The existing schema already supports safe cancellation using `removedAt`, while its linked
`VehicleOccupancy` records `active=false`, `releasedAt`, and the `OWNER_BLOCK_REMOVED` release
reason. No hard deletion and no Migration 44 are required. Active and future blocks may be removed;
past periods are read-only. Repeating a removal is an idempotent no-op.

The Owner-only API verifies the authenticated Owner owns the vehicle and that the block belongs to
that vehicle. Removal releases only the linked Owner occupancy inside the same transaction. Other
bookings, active rentals, turnaround occupancy, operational controls, lifecycle status, and other
availability requirements remain untouched and continue to be evaluated authoritatively.

Owner vehicle projections now carry a small `availabilityToday` summary calculated for the
Asia/Manila calendar day using batched occupancy/block reads. Marketplace/lifecycle unavailability
has first display priority, then booking occupancy, then Owner block, then available. The
marketplace status remains separately visible. A single Owner block may show its normalized reason
and end; an ambiguous multiple-block state does not invent a reason.

The Owner Dashboard obtains `ownerBlockedVehiclesToday` from a dedicated server query. It counts
distinct Owner vehicle IDs having a non-removed Owner-created block whose half-open interval
intersects the current Asia/Manila day. It counts an Owner block even when a booking has higher
vehicle-card display priority, never counts bookings as Owner blocks, and presents an explicit zero
state. Removed, past-only, and future-only-outside-today blocks do not count.

Search inclusion is never promised after removal: a new search or quote still evaluates listing
approval, Owner verification, operational state, documents, policy, spatial criteria, occupancy,
and every other existing public-eligibility rule. Existing rejected or expired quotes are not
mutated.

## Physical QA candidate

Physical review must cover all four combinations, inside/outside radius, insufficient notice, a
free owner service, renter review and detail, owner request/detail before acceptance, long address
wrapping, and the simple pickup/return regression. Availability review must cover current and
future block visibility, removal confirmation, active/future removal, past read-only behavior,
authoritative refresh, vehicle-card status, Dashboard count/zero state, and booking-conflict
preservation. Renter Delivery/Collection picker physical QA has passed. Owner private-location
create/edit, confirmation/cancel, relaunch, pure-Owner authorization, privacy, and
new-versus-historical spatial behavior remain the final physical-review scope. No live provider
call is part of automated verification.

## Google Maps location-picker refinement

Google Maps Platform is the approved V1 provider for renter Delivery and Collection location
selection. The mobile UI uses `react-native-maps` with Google Maps on both platforms and keeps the
resulting booking state provider-neutral. The API owns a narrow authenticated provider boundary for
Places Autocomplete (New), Place Details (New), and reverse geocoding. Raw Google responses, Place
IDs, session tokens, and viewport data are not booking evidence and are neither returned wholesale
nor persisted.

The picker returns only a normalized CarShare location: display name, optional address
line/barangay/postal code, city, province, `PH`, latitude, and longitude.
`PricingQuoteFulfillment` and `BookingFulfillmentSnapshot` remain unchanged and authoritative after
confirmation. Google identifies the selected point; existing PostGIS distance, radius, notice,
policy, availability, fee, quote, and booking rules decide serviceability. Routes, Directions,
Distance Matrix, Navigation, and Street View are not used.

The mobile flow has a 350 ms search debounce, a three-character minimum, stale-response
suppression, one Places session token per search/selection session, Place Details only after a
result is selected, and reverse geocoding only after map movement completes or current location is
explicitly requested. Map exploration is pending state. Only **Confirm delivery location** or
**Confirm collection location** changes booking state and invalidates an existing quote. Cancelling
retains the previously confirmed location.

Current location remains optional, uses foreground `expo-location` permission only, and never
prevents searching for a future destination elsewhere. The textual search/results/address path is
the accessible alternative to manipulating the map. Exact destinations are not routinely logged or
exposed by public vehicle projections.

### Development credential separation

Configure credentials only in the ignored repository-root `.env`:

- `EXPO_ANDROID_GOOGLE_MAPS_KEY`: Android-application-restricted development key for Maps SDK for
  Android.
- `EXPO_IOS_GOOGLE_MAPS_KEY`: iOS-application-restricted development key for Maps SDK for iOS.
- `EXPO_GOOGLE_MAPS_ENV=local`: binds native map keys to the local application identity.
- `GOOGLE_MAPS_SERVER_KEY`: server-only development key restricted to Places API (New) and
  Geocoding API.
- `GEOCODING_PROVIDER=google`: enables the authenticated server provider endpoints locally.

Never put the server key in an `EXPO_PUBLIC_*` variable. Automated verification runs with Google
location services disabled and mocked provider calls. Missing live configuration does not affect
Pickup + Return, app startup, Owner availability, Admin, or Workers; it produces a
location-provider-unavailable state only when a new owner-service destination is selected.

Development native keys must be restricted to `ph.carshare.mobile`. Android additionally requires
the applicable development signing certificate SHA-1 fingerprint. Attach billing, enable only Maps
SDK for Android, Maps SDK for iOS, Places API (New), and Geocoding API, then establish conservative
quotas, a budget, and billing alerts before physical QA. Native dependency/key changes require
rebuilding and reinstalling each development client; generated `ios/` and `android/` projects remain
untracked according to repository policy.
