# Owner Staff and Manager delegation

This document is the authoritative description of CarShare's delegated Owner-workspace access.
Delegation extends operational access to marketplace users without changing marketplace roles,
platform administration, payment authority, or the Owner of record.

## Identity and authority boundaries

- The Owner remains the root authority for one `OwnerProfile` workspace.
- A Manager or Staff member remains a normal marketplace `User` linked through an
  `OwnerStaffMembership`. Delegation never grants `RoleCode.OWNER`.
- `SUPER_ADMIN`, Admin roles, platform Staff, and Verification Staff are separate platform
  authorities. Owner delegation does not create an `AdminUser`, reuse the Admin permission
  registry, or grant access to `/admin`.
- Capacity is presentation context. Every operation is authorized from the current membership,
  exact permission, workspace, resource lifecycle, and vehicle scope loaded by the server.

## Hierarchy and permissions

The Owner can administer Manager and Staff memberships. Managers may administer ordinary Staff
only. They cannot invite, edit, suspend, disable, or promote another Manager; change the Owner; or
modify their own access. Ordinary Staff cannot administer access.

Owner-workspace permissions come from one explicit registry. Wildcards and unknown permission
codes are rejected. Presets (Operations and Support) expand to explicit stored permissions and are
configuration conveniences, not authorization sources. Manager grants are limited by both the
Manager ceiling and the Manager's own current permissions. Staff grants exclude Staff
administration and Owner-only authority.

Delegated operational permissions cover, only when explicitly granted:

- vehicle and availability reads/updates;
- booking-request reads and accept/reject decisions;
- rental reads, pickup handover, inspections, return/receipt, and recovery submission;
- conversation reads/replies;
- incident creation;
- claim reads/creation/responses and read-only dispute visibility;
- Staff directory and ordinary-Staff administration for eligible Managers.

Cancellation, amendments, payout/bank management, provider money movement, refund or manual-charge
execution, Security Deposit settlement, Owner profile/settings, ownership transfer, business
deletion, platform administration, dispute adjudication, and renter-verification adjudication are
not delegated.

## Membership and invitation lifecycle

Operational access requires an `ACTIVE` membership. `INVITED`, `SUSPENDED`, and `DISABLED`
memberships fail closed at request time. Suspension and disable affect only that Owner membership:
the marketplace account, renter access, and other Owner memberships remain usable. Reactivation is
supported only from `SUSPENDED` and restores configured permissions and scope. `DISABLED` is
terminal through the normal management API.

Invitations store only a one-way token hash plus expiry, consumption, and revocation state. Raw
tokens are returned only to the delivery boundary and are not persisted or logged. Invitations
expire after 24 hours. Reissue revokes prior live invitations; revoke, expiry, consumption, and
replay fail closed. Acceptance requires an authenticated marketplace user with a verified,
normalized email matching the invitation. Transactional conditional consumption permits exactly
one concurrent winner and transitions the membership from `INVITED` to `ACTIVE`.

## Vehicle and workspace scope

`ALL_VEHICLES` means all vehicles belonging to the selected Owner workspace, never all marketplace
vehicles. `SELECTED_VEHICLES` requires an explicit same-owner assignment. Database constraints and
the assignment trigger reject cross-owner links; API list and direct-resource operations repeat the
workspace and assignment checks.

Vehicle scope applies to vehicles, availability, booking requests, rentals, inspections, handover,
return, conversations, unread counts, incidents, claims, disputes, recovery visibility, and Today
projections. Removing a permission, assignment, or active membership takes effect on the next
authoritative request even when a client still holds stale UI state.

Users with multiple active Owner workspaces select one explicitly. Mobile stores the selection
under an authenticated-user-scoped key and accepts it only while present in the latest auth
projection. Switching workspace invalidates all workspace-scoped query roots. Query keys place the
workspace before resource identity so one workspace cannot reuse another's cached projection.

## Owner app and navigation

Delegated Owner-mode eligibility comes from `ownerWorkspaces`, not a synthesized Owner role. The
shell identifies the current workspace and capacity and shows only destinations supported by exact
permissions:

- Today appears when at least one useful delegated summary can be shown.
- Vehicles appears with `vehicles.view`.
- Messages appears with `messages.view`; replies additionally require `messages.reply`.
- More remains available and exposes Staff under **More → Operations → Staff** with `staff.view`.

Today independently authorizes booking-request, rental, vehicle, and message summaries and omits
unauthorized counts. “No assigned vehicles” is distinct from an empty Owner fleet. Booking Requests
and Active rentals use their shared destinations from Today rather than duplicate delegated
shortcuts in More. Actual Owner tabs and Owner-only areas remain unchanged.

Delegated deep links for vehicles, bookings, rentals, conversations, claims, and Staff members
require an explicit active workspace, destination permission, vehicle scope, and applicable
lifecycle. The app never guesses another workspace. Unauthorized or stale routes fall back to the
shared access-unavailable state or another current workspace. Server checks remain authoritative if
stale UI survives until the next request.

## Operational behavior

Availability mutations reuse existing occupancy transactions and exclusion constraints. Booking
decisions reuse the locked `AWAITING_OWNER` path. Rental, inspection, pickup, return, receipt, and
recovery operations reuse existing lifecycle, evidence, travel, deposit-gating, history, outbox,
and analytics rules. The authoritative return inspection remains renter-authored.

Conversation access is limited to scoped bookings. Renter-facing messages retain the Owner business
identity while audit records retain the human actor. Incidents and claims reuse existing lifecycle,
evidence, measured-usage, claim-window, and duplicate rules. Dispute visibility is read-only;
resolution stays with its existing platform or renter authority. Delegated actions do not imply
financial execution authority.

## Audit attribution and privacy

Delegated mutations record the real `actorUserId`, membership ID, capacity, Owner workspace,
required permission, target resource, associated vehicle when applicable, and request correlation
metadata. The Owner remains the ownership identity but is never substituted for the human actor.

Staff projections expose only permission-appropriate operational data. They do not expose global
renter identity evidence, `SELFIE_WITH_LICENSE`, verification approval/rejection controls, payout
credentials, or platform-only financial tooling. Signed evidence access remains bound to the
authorized scoped resource.

## Financial and platform exclusions

Owner delegation grants no payout destination management, manual payout, manual charge, refund
execution, ownership transfer, business deletion, or Owner-settings authority. Required Security
Deposit gating before handover remains unchanged, and Security Deposit settlement execution remains
disabled. No delegated permission exists for capture, release, or settlement.

The feature does not change Maya provider configuration, credentials, certification guards,
certification-state protections, or live-provider behavior. Platform Admin/SUPER_ADMIN, platform
Staff, and Verification Staff remain separate systems with their existing authorization and audit
requirements.

## UI and accessibility

Staff management and delegated operations reuse shared CarShare `Screen`/`NestedScreen`, `Card`,
`SectionHeader`, `StatusBadge`, `Field`, `Chip`, `Button`, `StateView`, selectable-option,
adaptive-sheet, sticky-footer, confirmation-sheet, and Danger-zone patterns. No parallel Staff
design system exists.

Permission and vehicle selectors expose labels plus selected state; status badges have textual
labels; destructive actions are explicit; hidden unauthorized controls are absent from the
accessibility tree; interactive controls preserve the shared touch-target standard. Loading,
network error/retry, no-access, no-assignment, and normal empty-data states remain distinct.

## Database and deployment

Migration `20261010140000_owner_staff_authority_foundation` is forward-only. It creates memberships,
explicit permission rows, invitations, selected-vehicle assignments, indexes, uniqueness rules, and
same-owner assignment protection without rewriting historical migrations. Deployment must run the
normal Prisma migration process before enabling clients that depend on the workspace projection.
