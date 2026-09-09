# ADR 0028: Owner analytics metric contract

Status: Accepted for Phase 13C-2H-A

Definition version: `owner-analytics-v1`

## Decision

Owner analytics is calculated by the API from authoritative transactional and accounting records.
Frontend code must not redefine financial semantics. All money uses integer minor units, is grouped
by currency, and is serialized as decimal strings. There is no implicit foreign-exchange conversion.

`Asia/Manila` is the authoritative business timezone. Period predicates use an inclusive instant at
the start and an exclusive instant at the end. Browser time is not authoritative.

## Initial metrics

| Canonical metric               | Human label                    | Source and timestamp                                                                                          | Included                                                                                           | Excluded                                                                                                                            | Refund/reversal behavior                                                                                                 |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `capturedRentalGbv`            | Captured-rental GBV            | Immutable `BookingPricingSnapshot.totalMinor`, attributed to the first successful rental `Payment.capturedAt` | `CAPTURED`, `PARTIALLY_REFUNDED`, or `REFUNDED` rental payments that do not require reconciliation | Authorizations, failed/voided payments, security deposits, additional charges, retries after the first captured payment per booking | Remains historical after partial or full refund                                                                          |
| `recognizedCarShareCommission` | Recognized CarShare commission | Posted `LedgerEntry` values for `PLATFORM_COMMISSION_REVENUE`, attributed by `LedgerTransaction.postedAt`     | All posted credits and debits in the period                                                        | Current commission rules and unposted projections                                                                                   | Credits use the ledger's negative sign and are presented as positive; refund/reversal debits reduce the result naturally |
| `completedRefunds`             | Completed refunds              | `Refund.amountMinor`, attributed by `Refund.completedAt`                                                      | `COMPLETED`                                                                                        | Requested, approved, processing, failed, and rejected                                                                               | Reported separately and never subtracted from historical GBV                                                             |
| `bookingsCreated`              | Bookings created               | `Booking.createdAt`                                                                                           | Every initial booking state                                                                        | None                                                                                                                                | Not affected by later status                                                                                             |
| `confirmedBookings`            | Confirmed bookings             | First `BookingStatusHistory` transition to `CONFIRMED`, using `occurredAt`                                    | One per booking                                                                                    | Repeated transitions                                                                                                                | Later cancellation does not erase historical confirmation                                                                |
| `completedRentals`             | Completed rentals              | First `BookingStatusHistory` transition to `COMPLETED`, using `occurredAt`                                    | One per booking                                                                                    | Repeated transitions                                                                                                                | Historical completion remains recorded                                                                                   |
| `activeRentalsNow`             | Active rentals now             | Current `Booking.status` at response generation                                                               | `ACTIVE`, `RETURN_PENDING`                                                                         | All other statuses                                                                                                                  | Point-in-time only; no period comparison                                                                                 |

GBV, renter payments, CarShare revenue, owner earnings, refunds, and payouts are distinct concepts.
Total renter payments must never be called CarShare revenue. The ledger is authoritative for
recognized CarShare commission; `CommissionSnapshot` is a reconciliation source, not a replacement.

## Periods and comparisons

- `TODAY`: Manila midnight to the next Manila midnight.
- `THIS_WEEK`: Monday 00:00 to the following Monday 00:00.
- `THIS_MONTH`: first calendar day to the first day of the following month.
- `CUSTOM`: inclusive local start/end calendar dates converted by the server to an exclusive instant
  following the end date; maximum 366 calendar days.

Each period is compared with the immediately preceding equivalent period. Calendar months compare
with the preceding calendar month; fixed/custom ranges compare with the immediately preceding range
of equal day count. When the previous value is zero, absolute change remains available while
percentage change is `null` and `comparisonAvailable` is false.

## Integrity and environment boundary

Captured rental payments included in reporting must have immutable pricing and commission snapshots.
Their capture-allocation ledger commission must match the stored commission snapshot. Unexpected
disagreement fails safely rather than substituting another value.

Responses state the application environment and mark every non-production dataset as synthetic.
Environment isolation remains database-level; this phase adds no row-level environment field.
Provider certification activity and hosted sandbox success are not production revenue.

## Deliberately unavailable

True net platform revenue, renter payment-provider fees, tax liability, cancellation-fee revenue,
chargebacks, historical fleet utilization, and production payment conversion remain unavailable.
They may not be inferred or displayed as authoritative without a separately reviewed data model.
