# Phase 13C-2B Postmark local certification

Status: **COMPLETE / PASS**.

Real local certification completed using the `CarShare Local` Postmark server. The explicit
CarShare certification CLI ran successfully, Postmark accepted the transactional message, and the
fixed safe subject and body arrived in the confirmed permitted inbox from the confirmed sender.
The message contained no customer, booking, KYC, payment, or other private information.

The provider boundary remains `certification command → LocalEmailCertificationProvider → PostmarkEmailProvider`. The explicit command never runs during API startup. Validated configuration restricts it to `local` or `test`, uses `POSTMARK_SERVER_TOKEN` only in the Postmark server-token header, and sends only to `POSTMARK_CERTIFICATION_RECIPIENT` from `POSTMARK_FROM_EMAIL`.

The command uses Postmark's `outbound` Default Transactional Stream unless `POSTMARK_MESSAGE_STREAM` is explicitly changed. It sends the fixed subject `CarShare Postmark local certification` and a fixed non-sensitive text body. A local ignored `.data/provider-certifications/postmark-local.sent` marker is atomically reserved before transmission and prevents repeat sends. The marker stores no recipient, token, or provider message ID.

Configure the ignored repository-root `.env` with `APP_ENV=local`, `EMAIL_ENABLED=true`, `EMAIL_PROVIDER=postmark`, `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, `POSTMARK_MESSAGE_STREAM=outbound`, `POSTMARK_CERTIFICATION_ENABLED=true`, and `POSTMARK_CERTIFICATION_RECIPIENT`. Run exactly once with `pnpm --filter @carrental/api certify:postmark`. After inbox confirmation, restore `POSTMARK_CERTIFICATION_ENABLED=false` and return email provider flags to their intended local defaults.

The response reports only provider, provider message ID, and normalized `ACCEPTED` status. Requests
time out after ten seconds and normal application failures remain provider-neutral. The explicit
local certification CLI may additionally report only the HTTP status, Postmark numeric error code,
redacted reason, and a validated provider request identifier. Email addresses, credentials, raw
headers, private environment values, and raw provider payloads are not logged.

The server token authenticated successfully against the `CarShare Local` server, its server type is
Live, and the `outbound` Default Transactional Stream was verified. The account/server remains
subject to Postmark Test/pending-approval restrictions. Delivery succeeded using a recipient
permitted by that restriction; arbitrary or unrestricted recipient delivery is not certified, and
the account must not be described as production-approved.

This checkpoint certifies only:

`CarShare local API → EmailProvider abstraction → Postmark adapter → outbound transactional stream → real controlled inbox delivery`

It does not certify unrestricted recipient delivery, production Postmark approval, production
sender/domain authentication, public delivery/bounce/complaint webhooks, inbound email, public
staging, or production email operations. Those capabilities remain deferred.
