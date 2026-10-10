# Booking, handover, return, and claims operations

## Authority and presentation boundaries

PostgreSQL and the API remain authoritative for booking timestamps, eligibility, lifecycle,
inspection evidence, recovery, claims, payment, and Security Deposit state. Mobile screens render
those projections and submit intent. Local selection state, countdowns, status badges, and optimistic
layout changes never establish a lifecycle or financial outcome.

The mobile experience consistently uses compact white section cards, lifecycle/status badges,
label/value rows, mutually exclusive segmented choices, adaptive bottom sheets, the shared calendar,
and the native time picker. Owner and renter actions use role-specific copy and hierarchy while
calling the existing commands.

## Renter Explore navigation

Selecting the renter **Explore** tab restores the Explore root instead of preserving a nested
Vehicle Details presentation. The current discovery area, dates, shared time, and filter selections
remain available where intended; only nested presentation state is cleared. A direct Vehicle Details
deep link is still parented to Explore and keeps its existing routing behavior.

## Booking dates and shared handover time

A renter selects a pickup calendar date, a return calendar date, and one shared clock time. The
shared time is applied to both dates, producing two exact ISO timestamps. Those timestamps, not the
date-only calendar values or formatted summaries, are sent to the API and remain authoritative.

- Today is selectable when the domain's availability policy permits it; past calendar dates are
  disabled. Today is disabled only when no valid booking-time slot remains in that calendar day.
- The calendar decides whether a day can contain a valid pickup; the time selector decides which
  slots on that day are valid.
- A same-day pickup time must be later than the current authoritative local threshold. Fulfillment
  minimum notice is evaluated against the composed pickup date and selected shared time rather than
  against a date-only midnight value.
- Booking times are aligned to the current 30-minute increment policy.
- Calendar calculations use local calendar days for selection and presentation. ISO timestamps carry
  the actual instants across the API boundary.
- The native platform time picker is shared by Search, Vehicle Details, and pre-trip amendment UI.
- Active-trip extensions remain governed by the extension-specific amendment rules; the pre-trip
  shared-time editor does not broaden extension eligibility.

Date/time summaries show the pickup-to-return date range followed by the one shared time. They do not
imply the former fixed 9:00 AM presentation assumption.

## Role-specific booking details

Booking-detail screens order state according to the participant's next meaningful decision. Trip
and vehicle identity remain easy to scan; required payment or Security Deposit action precedes
handover progress; current lifecycle guidance appears as the next step; secondary booking actions
remain subordinate; and cancellation appears only while the authoritative lifecycle allows it.

After custody transfer, renter and owner screens project the active-rental, return-pending, and
post-return states instead of retaining pre-trip cancellation or pickup guidance. During
`RETURN_PENDING`, the renter sees the submitted return evidence/readings while the owner sees the
receipt-review action. After receipt, both roles project the authoritative claim window and current
claim state without exposing internal Operations copy.

## Check price and Your trip

When a vehicle supports neither optional owner delivery nor owner collection, **Check price** can
request the quote from the current dates and default handover methods immediately. When delivery or
collection is supported, **Check price** opens **Your trip** first so the renter can choose the
applicable start and end methods and provide only the locations required by those choices.

Date, shared time, handover method, and relevant delivery/collection location changes invalidate the
previous authoritative quote. Before a quote, the sticky summary is labelled **Daily price**. After a
valid quote it is labelled **Total**. The quote, availability, fulfillment fees, and booking rules
remain server-authoritative. If the quote says no Security Deposit is required, no deposit section is
rendered.

## Normal pickup handover

The owner completes the pickup inspection before custody is activated:

1. Record the odometer and the powertrain-appropriate fuel and/or battery state-of-charge reading.
2. Capture the required private evidence perspectives: `FRONT`, `REAR`, `DRIVER_SIDE`,
   `PASSENGER_SIDE`, `INTERIOR`, `DASHBOARD`, `ODOMETER`, and `FUEL_OR_BATTERY_DISPLAY`.
3. Review existing vehicle condition as either **No known issues** or **Report issues**.
4. Submit the immutable inspection when all required readings, photos, and condition disclosure are
   complete.
5. The renter reviews the pickup evidence and completes the existing verification/confirmation
   steps. Only the authoritative handover command establishes custody and the active rental.

Evidence uses the secure camera/upload flow. Checklist slots expose **Capture**, **Added**, and
**Retake** states. `INTERIOR`, `DASHBOARD`, and `ADDITIONAL` support additional photos; additional
evidence is optional and never substitutes for a required perspective.

When the owner chooses **Report issues**, the issue-entry sheet records the issue type, vehicle area,
classification (`COSMETIC`, `OPERATIONAL`, or `SAFETY_CRITICAL`), description, and supporting secure
photos. Its sticky **Save issue** action supports multiple issues. Saved issues can be reviewed,
edited, or removed before inspection submission. Submission remains blocked until the condition
choice is made and at least one issue exists when **Report issues** is selected.

## Normal return and receipt

The renter starts return and submits the return inspection using the same reading and evidence
catalog and checklist language as pickup. Return notes are optional. Submission is gated by all
required photos and an odometer value; the API also rejects a return odometer below the effective
pickup odometer. Fuel and battery requirements continue to follow the vehicle powertrain.

The booking remains `RETURN_PENDING` while the owner reviews the renter's immutable return evidence
and readings. The owner then confirms vehicle receipt or uses the existing discrepancy path. A
confirmed receipt establishes the actual return, advances the booking to `RETURNED`, and opens the
post-return claim window. Cancellation is not offered after custody has begun.

## Overdue handover recovery

Supported B4 bookings may use the durable reduced-evidence recovery when the authoritative handover
is overdue and the vehicle was already transferred without the normal inspection. Unsupported or
legacy bookings must not be offered this action.

The Owner UI uses one shared recovery component with context-specific copy:

- Pickup: **Complete handover without inspection**, **Date of handover**, and **Time of handover**.
- Return: **Complete return without inspection**, **Date of return**, and **Time of return**.

Both use the shared calendar, compact native time picker, adaptive sheet, validation presentation,
and current server constraints. Submission creates the existing durable recovery record and history
or outbox events; it does not invent a parallel audit mechanism. The neutral post-submit card shows
**Handover recorded** or **Return recorded**, the actual reported timestamp, the renter response
deadline, and **Awaiting renter** or **Operations review**.

The renter receives the shared exception response card with **Confirm handover report** or **Confirm
return report**, plus **Dispute report**. The response window is 24 hours. No response uses the
existing automatic-acceptance authority; a dispute routes the record to Operations review. Only an
accepted recovery produces the normal authoritative active/returned transition.

## Post-return claims

The `RETURNED` projection includes measured usage and the authoritative claim deadline. The owner
can open the dedicated **Start a claim** sheet while that window is open. Its sticky **Submit claim**
action requires a description and submits one of the current categories:

- Measured/contextual: `EXCESS_MILEAGE`, `FUEL_DEFICIENCY`, `EV_BATTERY_DEFICIENCY`, and
  `LATE_RETURN`. Each appears only when the corresponding measured amount is greater than zero.
- Subjective: `CLEANING`, `DAMAGE`, and `OTHER`.

Amounts are not entered by either participant; booking records and Operations review remain
authoritative. Submitted claims appear to both roles with their current status. When the deadline
passes, the UI shows the closed-window state and no longer offers claim submission. Open claims,
disputes, incidents, or operational holds continue to block completion according to existing rules.

## Security Deposit visibility and delivery gating

When no deposit is required, price summaries and booking-detail flows omit the Security Deposit card
entirely. When required, the card renders the current authoritative amount and status and updates in
place after authorization. Renter delivery/handover progress is withheld until the required deposit
is successfully authorized for the required amount. The UI does not preserve a stale **Action
required** state after the booking projection reports completion.

These presentation rules do not change provider execution, settlement, capture, release, or recovery
authority. Security Deposit settlement execution remains controlled by its existing phase boundary.

## Cancelled booking summary

A cancelled renter booking is presented as a final receipt-style summary from the existing
cancellation settlement projection. The refund is the primary outcome, refund status remains a
structured status, and the original total is shown only when it already exists in the booking
pricing projection. Zero-value retained/refunded components are suppressed for presentation only;
the cancellation calculation, persisted settlement, payment behavior, and API contracts are
unchanged.
