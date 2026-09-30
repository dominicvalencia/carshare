# Manual amendment-refund reconciliation

Use this only when automated retrieval/reconciliation cannot establish provider truth and the Admin
amendment/finance detail shows a settlement requiring evidence. Do not edit `Payment`, `Refund`, ledger,
amendment, or migration rows manually.

1. Confirm the environment, booking, amendment, settlement, original payment, amount, currency,
   provider request reference, operation state, and expected refund correlation.
2. Check provider evidence outside the customer-facing application. Evidence must identify the same
   payment/refund, amount, currency, and outcome. Preserve its external reference and safe metadata.
3. Through an authenticated Admin identity with `refunds.approve`, submit
   `POST /api/v1/admin/finance/amendment-refunds/:settlementId/manual-resolution` with the evidence type,
   outcome, reference, and required notes defined by the API DTO.
4. Reopen Admin detail. Confirm evidence/history was appended, settlement/payment/refund states agree,
   balanced ledger entries exist when success is established, and the amendment either becomes ready
   for application or remains `FINANCIAL_RECOVERY_PENDING` for a justified unresolved result.
5. Confirm the worker can run again idempotently and renter/owner projections refetch the authoritative
   result. Never describe funds as received until provider settlement is confirmed.

Conflicting evidence, correlation mismatch, insufficient refundable balance, missing provider
references, or an unexpected environment is a stop condition for engineering/finance investigation.
Do not move an applied migration, clear reconciliation flags, or synthesize ledger entries.
