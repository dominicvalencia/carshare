# Phase 13C-2K-B3.5 — Map-Based Vehicle Discovery

## B4 physical-QA refinement

Clusters continue to use only deterministic `APPROXIMATE_CELL` coordinates. Tapping a multi-car
cluster zooms toward the shared public point and opens a compact browser for its member vehicles;
vehicles are never scattered into invented positions and no exact pickup location is exposed.

The persistent **Search this area** button is retired. User-driven pan/zoom completion schedules one
authoritative Search after an 800 ms debounce, ignores trivial region jitter, resets during rapid
movement, and suppresses searches caused by programmatic centering or cluster zoom. Explicit Place
selection and filter/date changes remain direct searches. The successful map area becomes the
shared List/Map search area, and a non-blocking `Searching this area…` indicator preserves gestures.

## Status

Implemented. Automated verification passed, and final physical Owner/Renter UX acceptance passed on
September 12, 2026. The accepted physical review covers List and Map Search, Google map rendering,
Google Places and current-location Search, Search this area, price pins, selected-vehicle preview,
return-from-detail state, clustering, handover and date filters, server-authoritative delivery
presentation, empty states, responsive behavior, accessibility, and privacy-safe approximate pins at
high zoom.

## Product behavior

Renter Search keeps List as its default and adds an accessible List/Map presentation toggle. Both presentations use one search state for area, rental dates, vehicle filters, pricing filters, and handover filters. Selecting a Google Places result or current location establishes a discovery center; it does not establish a contractual Delivery or Collection destination. Those destinations still require explicit confirmation through the existing exact-point `LocationPicker`.

Map mode displays bounded, server-returned results as compact per-day price pins. Selecting a pin highlights it without relying only on color and opens a compact preview containing the existing safe vehicle, price, general-area, distance, and fulfillment projection. The preview opens the existing Vehicle Detail and booking path.

Manual pan or zoom does not query. After movement settles, **Search this area** submits the visible center and a clamped radius derived from the visible region. Explicit filter, date, or Search-location changes remain explicit authoritative searches. Existing pins and the map position remain visible while a viewport request is loading or fails.

## Spatial contract and performance

The existing radius contract was retained instead of introducing viewport bounds:

- `latitude` and `longitude` are the discovery center.
- `radius` is 1–100 km.
- `mode=LIST|MAP` selects pagination/presentation projection semantics.
- List retains cursor pagination and a default page size of 10.
- Map requests at most 50 results and exposes `resultCount`, `resultLimit`, and `hasNextPage` metadata; it does not use an invisible infinite marker feed.

PostGIS remains authoritative. Candidate selection continues using `ST_DWithin` against `VehicleLocation.point`, followed by the existing public-readiness, own-vehicle exclusion, availability, turnaround, filter, and handover rules. `ST_Distance` is used only by the server for relevance and contextual fulfillment. The existing geography GiST index is the intended spatial index; no migration, new index, cache, projection table, or persisted search snapshot is introduced.

## Public-pin privacy strategy

The API projects each exact private `VehicleLocation` into the center of a fixed 0.02-degree public grid cell (approximately two kilometers at Philippine latitudes). The projection is:

- computed only on the server;
- stable across users and repeated requests;
- presentation-only;
- independent of Search center and zoom;
- shared by vehicles in the same cell, allowing clustering;
- never used for eligibility, distance, fulfillment, quotes, or bookings.

If an exact coordinate coincides with the default cell representative, the server selects another fixed point inside that cell so the returned point is deliberately not the exact coordinate. The public contract names the fields `mapLatitude` and `mapLongitude` and labels precision as `APPROXIMATE_CELL`; it never overloads authoritative `latitude`/`longitude` names.

Repeated queries do not produce random samples that can be averaged. High zoom never increases precision. Multiple vehicles at the same location remain co-located or clustered rather than being scattered around the private point.

Map-mode distance is rounded to whole kilometers. This avoids combining an approximate pin with high-precision distances that could make repeated-center triangulation materially easier. The existing server-authoritative `Delivery to your location` boolean remains available, but map coordinates never participate in that calculation and exact service-radius or policy internals are not exposed.

## Clustering and accessibility

Clustering is a small JavaScript presentation layer over privacy-safe returned coordinates, so it adds no native dependency. Nearby public cells are grouped into a count marker. Activating a cluster zooms toward its public coordinates and never selects a random vehicle. List remains the complete accessible alternative to map gestures. Toggle buttons, price pins, clusters, Search this area, and the preview expose labels and selected state.

## Failure boundaries

- A map-search failure preserves the current region and offers Retry.
- An empty area is a normal empty state.
- Places failure preserves the prior Search context.
- List search remains usable independently of map rendering.
- No reverse-geocoding request is made after map pans.
- No Routes, Directions, Distance Matrix, Navigation, Street View, live tracking, or background location is used.

## Deferred

B4 handover, full B5 accounting, With-driver, Admin/Owner maps, booking navigation maps, saved searches, public staging, DigitalOcean, production Google configuration, and new provider credentials remain out of scope.
