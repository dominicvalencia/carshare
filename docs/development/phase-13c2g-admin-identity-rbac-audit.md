# Phase 13C-2G — Admin Identity, Staff Accounts, RBAC, and Audit Foundation

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / PHYSICAL MANUAL ACCEPTANCE PASS**

Phase 13C-3 staging remains paused. This checkpoint introduces no DigitalOcean, DNS, public HTTPS,
provider webhook, production credential, or staging deployment work.

## Previous limitation and transition

The Admin application previously authenticated ordinary marketplace `User` records and treated the
presence of broad `ADMIN`, `SUPER_ADMIN`, `SUPPORT`, or `FINANCE_ADMIN` roles as the administrative
identity. Staff had no dedicated lifecycle, explicit per-person permission grants, invitation
state, owner protections, or immutable Admin-domain actor record. A normal access token carrying a
legacy administrative role could call Admin endpoints even when it had not entered through the
Admin login screen.

Phase 13C-2G adds a dedicated `AdminUser` identity linked one-to-one to the existing credential
`User`. Password hashing, brute-force protection, JWTs, refresh-token rotation, and session
revocation continue to use the established identity subsystem; role, status, explicit permissions,
invitations, and administrative attribution now belong to the Admin domain. Every protected
`/admin` request requires an active `AdminUser`; legacy roles alone no longer authorize it.

The existing deliberately seeded administrative account becomes the single `OWNER` only when both
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are explicitly supplied to the seed process. The seed
contains no password and creates no default account. A partial unique database index prevents more
than one OWNER. Existing deployed administrative credentials must be deliberately converted through
this environment-aware seed/bootstrap path after identity review; no migration silently creates or
promotes an OWNER.

## Identity, roles, and status

`AdminUser` stores its own email/display name, role, status, creator, invitation/activation/login
timestamps, password-change timestamp, and suspension/disable attribution. Revocation never deletes
the administrator record.

- `OWNER`: receives the complete approved permission registry at authorization time. It cannot be
  created, modified, demoted, suspended, or disabled through staff-management APIs. Ownership
  transfer has no general UI/API.
- `SUPER_ADMIN`: may manage STAFF only when explicitly granted the relevant staff permissions. It
  cannot create or modify OWNER or create/promote another SUPER_ADMIN.
- `STAFF`: receives only explicit permission rows. There is no wildcard or implicit broad access.
- Statuses: `INVITED`, `ACTIVE`, `SUSPENDED`, and `DISABLED`.

Suspension, disablement, role changes, and permission changes revoke all active credential sessions.
The access guard reloads current Admin status and permissions on every protected request, so stale
tokens cannot preserve removed access.

## Permission registry and profiles

The allowlisted registry maps the real repository capabilities already enforced by Admin
controllers and adds only staff lifecycle permissions: `staff.view`, `staff.create`, `staff.edit`,
`staff.suspend`, `staff.disable`, and `staff.permissions.manage`. Unknown permission names are
rejected. Convenience profiles cover Verification Staff, Support Staff, and Operations Staff; they
are initial selections only, not authorization identities. Backend permission rows remain
authoritative.

The Admin frontend filters navigation and dashboard requests by permission and rejects direct URLs
to unauthorized modules. Controllers remain authoritative through `AccessTokenGuard` and
`PolicyGuard`; hiding UI never grants or substitutes for authorization.

## Invitation lifecycle

An OWNER, or a SUPER_ADMIN holding the required staff permissions, supplies display name, email,
non-owner role, and explicit permissions. CarShare creates an `INVITED` Admin identity and a
cryptographically random opaque invitation. Only an HMAC hash is persisted. The invitation expires
after 24 hours, is single-use, and may be revoked or reissued; reissue revokes all older active
invitations. Activation atomically consumes the invitation, revokes siblings, applies the existing
password policy and Argon2id hashing, and activates the staff identity.

Delivery uses `EmailProvider`; Postmark is never called directly. Tests use deterministic provider
substitutes. The local/test development inbox is the only environment allowed to expose the raw
link for controlled QA. Invitation values are excluded from logs, Sentry, audit snapshots, and API
list/detail responses.

For repeatable local QA, an OWNER can use **Copy local invite link** on an `INVITED` staff row. The
API reconstructs the link only from the current process's in-memory development delivery, validates
that token against the active hashed invitation, and exposes it only when `APP_ENV` is `local` or
`test` and `EMAIL_PROVIDER=development`. The action is unavailable to STAFF/SUPER_ADMIN, after API
restart, for expired/revoked/consumed invitations, with Postmark, and in staging/production. The
Owner shares the copied link privately with the intended synthetic invitee; it is never logged or
persisted in plaintext.

## Staff management and audit

`/admin/staff` provides permission-aware listing, creation, editing, suspension, reactivation,
disablement, and invitation reissue/revocation. `/staff-invitation` lets the invitee set their own
password. `/admin/audit` provides an OWNER/permission-scoped read-only view.

`AdminAuditLog` records immutable Admin ID, captured actor role, action, entity type/ID, safe
allowlisted before/after state, reason, correlation ID, limited request metadata, and timestamp. A
database trigger rejects updates and deletes. It never stores passwords, invitation/session tokens,
raw KYC documents, card data, provider secrets, signed URLs, or arbitrary request bodies.

Staff invitation, activation, role/permission changes, suspension, reactivation, disablement, and
invitation revoke/reissue are audited. Renter verification decisions additionally persist
`reviewedByAdminId` and an Admin audit transition containing previous/resulting status. The UI
resolves the immutable Admin identity when showing the reviewer.

Existing legacy operational audit records remain intact. Owner verification, vehicle, booking,
claim, refund, payout, and system-setting actions retain their current audit paths and are candidates
for incremental dedicated `AdminUser` attribution after the required first renter-verification and
staff-lifecycle coverage is physically accepted.

## Refined Owner and staff experience

The authenticated `OWNER` now lands in a distinct CarShare Owner workspace rather than the dense
operations console. Its navigation is organized around business overview, finance, rentals,
marketplace participants, reports, staff activity, access management, audit/security, and business
settings. A deliberate **Operations Console** switch retains access to the original operational
modules when hands-on queue work is required.

The Owner overview provides a Today/Week/Month/Custom period control and labels the source and scope
of every displayed count. Custom date filtering, gross booking value, revenue, commissions, average
booking value, and unavailable trend comparisons are explicitly deferred until authoritative
server-side aggregates exist; the UI does not invent financial values from incomplete list data.

Staff creation now uses a dedicated `/admin/staff/new` workflow. The creator chooses a supported
role and one of four curated STAFF profiles—Operations, Verification, Support, or Finance—before
reviewing grouped effective permissions. Advanced customization is collapsed by default and warns
before a role/profile change replaces manual permission changes. `OWNER` is never offered as a
creatable role, while OWNER-only creation of `SUPER_ADMIN` initializes the approved non-commission
administrative permission set. Staff list rows show the matching profile or “Custom permissions,”
and `/admin/staff/:id` provides a dedicated identity/access editor. Staff activity is derived from
immutable audit events and displays factual actor, role, action, entity, and time only; it makes no
productivity or performance inference.

## Database checkpoint

Migration `20260909123000_phase13c2g_admin_identity_rbac_audit` is additive and forward-only. It
adds Admin roles/statuses, identities, explicit permissions, invitations, append-only audit logs,
and renter-verification Admin attribution. Previously applied migrations are unchanged. The
candidate repository now contains 39 migrations.

The migration is applied to the isolated `carrental_test` integration database with no pending
migrations. It is intentionally still pending in the local `carrental` development database until
the business owner supplies the existing controlled Admin email and a private bootstrap password;
this prevents a silent/default OWNER from being created and prevents the existing Admin transition
from being performed without review.

## Automated verification

- `pnpm verify`: PASS (format, Compose validation, lint, TypeScript, package tests, Prisma
  validation, API/Admin/worker builds, and iOS/Android Expo exports)
- `pnpm test:integration`: PASS (8 files, 48 tests; `carrental_test`, 39 migrations, none pending)
- `pnpm db:validate`: PASS
- `git diff --check`: PASS
- `npx expo-doctor`: PASS (18/18 checks)
- `npx expo install --check`: PASS (dependencies up to date)
- Focused Admin web tests: PASS (36/36); production build: PASS
- Focused Admin RBAC/staff/policy API tests: PASS (11/11)

## Required local manual QA

The business owner physically reviewed and accepted all 22 scenarios below on September 9, 2026.
This records the acceptance fact only; it does not assert separate timestamps or screenshots for
each scenario.

1. In the ignored root `.env`, set `SEED_ADMIN_EMAIL` to the reviewed existing Admin email and
   `SEED_ADMIN_PASSWORD` to the private local OWNER password (minimum 12 characters). Do not paste
   either value into chat or commit them. Then run `pnpm --filter @carrental/database prisma:migrate:dev`
   followed by `pnpm --filter @carrental/database prisma:seed`. Confirm the target printed by Prisma
   is the local `carrental` database before proceeding.
2. OWNER signs in and sees Staff Management and Audit Log.
3. OWNER lands in the Owner workspace, verifies its labeled operational counts, and confirms
   unavailable financial metrics are explicitly deferred rather than fabricated.
4. OWNER deliberately enters and returns from the Operations Console.
5. OWNER opens the dedicated Create Staff page, selects each STAFF profile, and verifies the
   grouped permission summary changes to the documented defaults.
6. OWNER customizes an advanced permission, changes profile, and verifies the overwrite warning.
7. OWNER creates Staff A with a controlled email and a narrow profile/permission set; OWNER is not a
   role option.
8. OWNER copies Staff A's local invitation link, shares it privately with the intended synthetic
   invitee, and Staff A creates their own password. Confirm retrieval is unavailable to non-OWNER
   accounts and outside local/test development delivery.
9. Reusing the invitation fails with a generic invalid/expired response.
10. Staff A signs in and sees only permitted modules.
11. Staff A enters an unauthorized route directly and receives Access denied.
12. A direct unauthorized Admin API call returns 403.
13. OWNER edits Staff A through the dedicated detail page and changes permissions; Staff A's old
    session is revoked and new access reflects the change after signing in again.
14. Staff A reviews and approves a synthetic renter verification.
15. OWNER sees Staff A's name and immutable Admin identity attribution on that verification.
16. Audit Log shows actor, captured role, action, entity, time, and status transition without
    secrets or raw evidence.
17. Staff Activity shows the same factual immutable audit attribution without inferred performance
    or productivity scoring.
18. OWNER suspends Staff A; the active session stops working and login is rejected.
19. OWNER reactivates Staff A and verifies a new login, then tests disablement if desired.
20. A SUPER_ADMIN with staff permissions can manage STAFF but cannot create, modify, suspend, or
    disable OWNER or promote STAFF to OWNER/SUPER_ADMIN.
21. Staff B uses distinct credentials and produces distinct session/audit attribution.
22. Filters and profile labels on Staff Management remain accurate after creation and edits.

Use synthetic staff and renter identities only. Real staff credentials and customer/KYC evidence
must not be used for this local acceptance.

Phase 13C-2G manual acceptance: **PASS**.

## Deferred

- Admin MFA provider integration and recovery ceremony
- Full Owner analytics/business dashboard
- Dedicated Admin attribution retrofit for every existing operational action
- Production invitation templates/domain delivery certification
- Public staging, DigitalOcean, DNS, provider callbacks, and production activation
