# Phase 9 owner payouts

> Historical phase guide. Current payout eligibility also respects unresolved Change Booking payment,
> refund, application, and financial-recovery blockers. Amendment economics adjust the payout-facing
> owner earning without rewriting capture evidence. See
> [Payments, refunds, ledger, and payouts](../architecture/payments-refunds-ledger.md).

Phase 9 settles only `AVAILABLE` owner earnings. It does not expose an owner withdrawal command and it does not change security-deposit behavior.

## Local configuration

Local and test environments use the deterministic provider:

```dotenv
PAYOUT_PROVIDER=fake
PAYOUT_MINIMUM_AMOUNT_MINOR=10000
PAYOUT_AUTO_CREATE=false
PAYOUT_AUTO_SUBMIT=false
PAYOUT_RECONCILE_INTERVAL_SECONDS=30
PAYOUT_SUBMITTING_STALE_SECONDS=60
PAYOUT_PROCESSING_STALE_SECONDS=300
PAYOUT_FOUR_EYES_ENABLED=false
PAYOUT_WITHHOLDING_ENABLED=false
PAYOUT_DATA_ENCRYPTION_KEY_BASE64=<base64-encoded 32-byte key>
PAYOUT_IDENTIFIER_HASH_SECRET=<independent high-entropy secret>
```

Never reuse the encryption key as the hash secret. Store both in the deployment secret manager, rotate them under an explicit data migration, and never expose either to browser or mobile builds.

Production rejects `PAYOUT_PROVIDER=fake`. Xendit also requires:

```dotenv
PAYOUT_PROVIDER=xendit
XENDIT_ENVIRONMENT=production
XENDIT_SECRET_KEY=<secret API key>
XENDIT_WEBHOOK_TOKEN=<callback verification token>
```

## Operational flow

1. A verified owner adds a Philippine bank or e-wallet destination. Validation is adapter-authoritative and ordinary responses contain only the masked value.
2. Finance sets the independently managed payout eligibility to `ELIGIBLE` and reviews the queue blockers.
3. An administrator creates an owner payout or a multi-owner batch. Selection is oldest-first, whole-earning only, row-locked, and revalidated.
4. An administrator with approval permission approves the payout. If four-eyes is enabled, the creator cannot approve it.
5. An administrator explicitly submits it. The service claims `SUBMITTING`, commits, calls the provider with the stable idempotency key, then records `PROCESSING` only after acknowledgment.
6. An authenticated webhook or reconciliation retrieval confirms `PAID` or `FAILED`. Repeated submits, webhooks, and worker runs converge idempotently.

Batch state is only an operational projection. Investigate and reconcile each member payout independently.

## Failure handling

- A lost create response leaves the payout reconcilable under its original key; never create a replacement transfer.
- A definitive invalid destination fails the payout, posts a balanced clearing reversal when required, releases the active earning allocation, marks the destination `REQUIRES_ACTION`, and emits masked notification events.
- Retry only ambiguous or adapter-classified retryable outcomes. Compliance and invalid-destination failures require action.
- A suspended owner blocks pre-submission commands. A transfer already processing continues through reconciliation.
- Stale `SUBMITTING` and `PROCESSING` payouts produce one operational alert and are returned to the reconciliation queue.

## Xendit readiness

The adapter owns the v3 endpoint, API-version header, Basic authentication, channel mapping, reference/idempotency fields, retrieval, error normalization, and callback-token verification. Before enabling a real environment:

1. Obtain separate Xendit test and production secret keys.
2. Configure the payout callback URL as `/api/v1/webhooks/xendit/payouts` and set the matching callback token.
3. Confirm the exact Philippine bank and e-wallet channel codes enabled for the account.
4. Confirm provider minimum/maximum and per-channel transaction limits; do not infer or auto-split transfers.
5. Exercise destination validation, creation, retrieval, success, failure, reversal, and duplicate/out-of-order webhooks in Xendit's test environment.
6. Reconcile provider reports against payout clearing and payout cash before production activation.

The adapter is implemented and contract-tested without live credentials; this is not a claim of live Xendit certification.

## Verification

```bash
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm test:integration
pnpm verify
```

The Phase 9 integration suite exercises allocation races, 20 concurrent submissions, lost responses, duplicate webhooks, webhook/retrieve races, failed destinations, isolated multi-owner batches, ledger balance, masking, and role/owner scope.
