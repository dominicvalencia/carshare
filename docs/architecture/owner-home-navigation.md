# Owner Home navigation

Owner mode uses four visible bottom destinations:

| Destination | Purpose                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| Today       | Owner operational home                                                        |
| Vehicles    | Fleet and listing management                                                  |
| Messages    | Owner conversations and activity notifications                                |
| More        | Active-rental access, earnings and payouts, owner profile, help, and settings |

Today opens Owner Home with three local top tabs. Fresh Owner-mode entry selects **Today**. **Upcoming**
contains server-authoritative future accepted rentals, and **Requests** contains actionable new-booking
and Change Booking requests with the server-owned combined count. The selected top tab remains mounted
while a booking or request detail is pushed, so Back restores the originating context.

Requests is actionable-first. Its History link opens the retained bounded booking/amendment request
surface with the **All** scope selected. Closed request details remain read-only. The legacy Requests tab
route is retained without a visible or focusable tab button only for route compatibility; it does not
carry a second badge. Cold Owner booking/request links establish Owner Home with Requests selected
before opening the authoritative booking destination. The legacy Owner Rentals stack route remains for
active-rental compatibility, while primary future-rental navigation comes from Upcoming cards directly
to booking detail.

The former Dashboard KPI grid is retired rather than relocated as duplicate analytics. Its fleet and
draft information is available in Vehicles; current operational counts and exceptions are represented
by Today; future rentals by Upcoming; actionable work by Requests; active rentals through More; and
financial information through Earnings & payouts. No analytics calculation or backend authority was
added.

Calendar is deferred and has no visible or disabled navigation placeholder.
