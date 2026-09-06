# Provider webhook security and retry standard

Webhook adapters verify the provider-specific scheme against the raw request body before parsing or mutating domain state. JSON content type and a 256 KiB default limit are enforced. Timestamped schemes use a five-minute default age window and constant-time HMAC comparison. Provider/event identifiers are claimed once; duplicate events converge through replay storage or the existing unique financial webhook records. Missing/invalid signatures, stale events, malformed bodies and unsupported events fail closed. Only digest, normalized status, operation reference and safe error metadata may be retained or logged.

Provider-specific schemes remain authoritative: Maya's approved source/signature contract and Xendit's callback-token contract are not replaced by the generic HMAC utility. Unsigned staging or production events are forbidden.

Operational failures are classified as:

- Retryable: connection failures, 408/429 and selected 5xx responses. Use bounded exponential backoff (1, 2, 4, 8 seconds; maximum 30 seconds and four attempts by default).
- Non-retryable: authentication/configuration, validation, malformed beneficiary and unsupported operations.
- Reconcile: a timeout after a financial request may have been accepted, an ambiguous state or a missing callback. Retrieve provider state before any repeat financial action.

No payment or payout is blindly retried. Existing `PaymentOperation`, `PaymentWebhookEvent`, `PayoutOperation`, `PayoutWebhookEvent`, and `NotificationDelivery` records remain the domain-specific source of audit, attempt, provider reference and reconciliation state.
