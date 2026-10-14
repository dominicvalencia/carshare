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

Every Manager and Staff membership includes `audit.view_own_actions` as a non-configurable
baseline permission. It exposes only the actor's own Owner-workspace activity and does not grant
workspace-wide or platform audit visibility. Presets and Custom Staff receive this baseline
automatically, including existing memberships when effective permissions are resolved; the Custom
permission editor therefore does not present it as a removable choice.

Delegated operational permissions cover, only when explicitly granted:

- vehicle and availability reads/updates;
- booking-request reads and accept/reject decisions;
- rental reads, pickup handover, inspections, return/receipt, and recovery submission;
- conversation reads/replies;
- incident creation;
- claim reads/creation/responses and read-only dispute visibility;
- Staff directory and ordinary-Staff administration for eligible Managers.

Managers receive `vehicles.create` by default. The permission authorizes creation within an
authorized Owner workspace and is intentionally not vehicle-scoped because no target vehicle exists
before creation. Operations Staff, Support Staff, and Custom Staff cannot receive it in the initial
implementation. This permission definition is schema and policy foundation only; delegated vehicle
creation endpoints are introduced separately.

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

New invitations are SMS-first and remain limited to Owner-workspace Manager and Staff delegation;
ordinary Owner and Renter registration, login, password reset, and account identity remain
email-based. Legacy EMAIL invitations remain valid through the same channel-flexible lifecycle.
Destinations are normalized server-side, while invitations store only a one-way token hash plus
channel, normalized destination, expiry, consumption, and revocation state. Raw tokens are returned
only to the delivery boundary and are not persisted or logged. Invitations expire after 24 hours.
Rate limits apply to the actor, workspace, destination, and source address. Reissue revokes prior
live invitations; revoke, expiry, consumption, and replay fail closed.

SMS acceptance requires an authenticated marketplace user whose normalized mobile matches the
invitation and is already verified. A matching but unverified mobile is directed through the
existing secondary mobile-verification flow; a different account fails without disclosing the raw
destination. EMAIL acceptance retains the existing verified-email match. Existing users sign in
normally, while new users create an ordinary marketplace account and then add and verify the
invited mobile. Acceptance refreshes the authenticated `ownerWorkspaces` projection so delegated
Owner mode becomes available without synthesizing `RoleCode.OWNER`. Transactional conditional
consumption permits exactly one concurrent winner and transitions the membership from `INVITED` to
`ACTIVE`.

Invitation deep links open an invitation-specific CarShare screen before authentication. A public,
token-bound preview returns only lifecycle state, expiry, channel, workspace display label, and a
human-readable delegated role/preset. It does not reveal the destination, permission keys, Owner
identity details, membership IDs, token hash, or whether the destination belongs to an account;
the landing therefore offers both normal email login and concise account setup without enabling
account enumeration. The raw token remains in volatile application state, is never rendered or
logged, and survives login/registration because the invitation screen owns the ordinary auth flow.

The invitation experience reuses shared CarShare `Card`, `Button`, `BackControl`, `StatusBadge`,
`StateView`, auth fields, password policy, and mobile-verification flow. Existing users explicitly
accept after authentication. New mobile-only Staff users provide Password and Confirm password;
the server derives the invited mobile and verifies it through the invitation-bound OTP flow before
atomically creating the User and activating membership. The link alone never verifies the mobile
or activates membership. Wrong-account, unverified-mobile, expired, revoked, consumed, and
invalid-link states use the shared state presentation and do not expose another user's identity.

After acceptance, identity and `ownerWorkspaces` are refreshed, the accepted workspace is selected,
Owner mode is activated, and the normal Owner shell chooses Today or its first permission-accessible
destination. No Staff-specific home or authentication system exists; ordinary Owner/Renter email
login, registration, recovery, and onboarding remain unchanged.

Phase E adds the mobile entry points for the stable workspace link and one-time setup without adding
a Staff entry to generic authentication. A stable `owner/staff-access/<handle>` deep link resolves
minimal public validity first. Logged-out active Staff and Managers see the shared CarShare auth
composition with mobile number and password only; there is no email field or account-creation action.
An already-authenticated user is authorized directly. Successful contextual authentication uses the
ordinary access/refresh-token store, selects the returned Owner workspace, enters Owner mode, and
lets the permission-aware shell choose Today, Vehicles, Messages, or More.

Initial activation remains exclusive to the one-time invitation. New mobile-only Staff setup asks
for Password and Confirm password only; the server derives the invited mobile. The shared OTP
presentation then verifies the invitation-bound mobile before the normal session is issued. The
token and stable handle remain volatile navigation context and are neither rendered nor persisted as
credentials. Existing-account invitations retain the ordinary invitation-context login, explicit
acceptance, verified-mobile, and wrong-account behavior. Generic Renter/Owner Login, Create Account,
password recovery, and OTP utilities remain unchanged. Owner Copy/Share/Regenerate controls remain
outside Phase E.

Phase F places stable access-link management near the top of **More → Operations → Staff** for the
actual Owner only. The mobile client retrieves the environment-correct URL from the authoritative
workspace endpoint and never reconstructs its handle. The compact shared Card supports copying the
full URL through the platform clipboard and sharing concise workspace context through the native
share sheet; the visually truncated URL never changes the copied or shared value. Managers and
Staff do not mount the link query or controls, while server Owner authorization remains the final
guard.

Regeneration uses the existing slide-up confirmation pattern and explains that the old link stops
working immediately while Staff accounts and active sessions remain unaffected. A successful
rotation replaces the query cache with the response before copy/share can run again, preventing a
stale link from remaining actionable. This stable Staff access link is solely for existing ACTIVE
Staff and Managers signing in on another device; the one-time SMS invitation remains the only
first-time activation path.

Staff password recovery is available only from a currently valid stable workspace link. It asks
for the Staff mobile number, returns an enumeration-safe response, and sends a dedicated
`STAFF_PASSWORD_RESET` OTP only when an ACTIVE Manager/Staff membership, verified mobile, active
User, and resolved workspace all match. The OTP challenge and the short-lived post-verification
reset capability are bound to the access-link row and version; rotating the link invalidates an
in-flight recovery. Completion reuses the normal password policy and global password-reset session
policy: all active sessions for that User are revoked and active push tokens are disabled. It does
not alter memberships, permissions, or vehicle scope and does not automatically sign the User in.
Generic Renter/Owner email recovery remains unchanged, and there is no generic mobile Staff login
or recovery entry on Welcome.

The `STAFF_INVITATION` SMS provider template contains the workspace label, delegated role, expiry
expectation, and environment-specific app deep link. Development uses the captured-message provider
for end-to-end testing; disabled and external providers preserve the same contract. A provider
failure does not erase the already-created live invitation: the Owner sees a safe partial-success
message and can reissue it. Tokens, normalized destinations, and provider errors are redacted from
product UI and audit metadata.

## Vehicle and workspace scope

A Manager-created vehicle remains owned by the actual Owner: `ownerProfileId` and `ownerUserId`
continue to identify the Owner workspace and Owner user, while separate creator user/membership
fields preserve the human actor. Existing vehicles are backfilled to their Owner user with no
historical Staff membership attribution. A vehicle revision begins at zero as the durable foundation
for later aggregate optimistic concurrency.

Manager-created drafts require a separate Owner-approval request before entering the existing
CarShare review flow. Owner approval states are `PENDING`, `CHANGES_REQUIRED`, `APPROVED`, and
`WITHDRAWN`; they do not alter `VehicleLifecycleStatus`, and `PENDING_APPROVAL` continues to mean
CarShare/platform review. Approval requests preserve submitter, reviewer, submitted vehicle revision,
and decision history, while database constraints keep the vehicle, membership, and request in the
same Owner workspace and allow only one pending request per vehicle.

A Manager-created plain `DRAFT` is private to its creating Manager and is excluded from the actual
Owner's normal Fleet until its latest Owner-approval request is `PENDING`. A `CHANGES_REQUIRED`
draft remains visible because the Owner has established review context; a latest `WITHDRAWN`
request hides the draft again. Owner-created drafts and vehicles that have advanced to platform
review remain visible as before. The creating Manager alone may discard their own `DRAFT`, including
`PENDING`, `CHANGES_REQUIRED`, or `WITHDRAWN` approval states. Discard atomically withdraws a pending
request, transitions the draft to the durable archived tombstone, and preserves creator provenance,
approval history, status history, vehicle assignments, and an actor-attributed audit record. This
does not grant Managers the Owner archive/remove operation for platform-review or live vehicles.

An active Manager with `vehicles.update_operational_fields` may update only the approved vehicle's
day-to-day description/requirements, features, operational availability, weekly availability,
turnaround, rental-duration limits, handover modes, service radius/minimum notice, fuel or EV return
settings, and mileage settings. Pricing, discounts, fees, Security Deposits, plate/VIN and other core
identity, documents, photos, private location, ownership, lifecycle/review state, and archive/remove
of platform-review or live vehicles remain Owner-only. Each Manager operational save locks the Vehicle, compares `expectedRevision`,
increments the revision once, and writes the actual Manager audit plus one transactional Owner
outbox event. Actual-Owner changes to overlapping operational fields also advance the revision, so a
stale Manager save fails instead of overwriting newer Owner state. Notifications carry only the
Manager and vehicle display names and deep-link to a destination that rechecks current authority.

`ALL_VEHICLES` means all vehicles belonging to the selected Owner workspace, never all marketplace
vehicles. `SELECTED_VEHICLES` requires an explicit same-owner assignment. Database constraints and
the assignment trigger reject cross-owner links; API list and direct-resource operations repeat the
workspace and assignment checks.

Vehicle scope applies to vehicles, availability, booking requests, rentals, inspections, handover,
return, conversations, unread counts, incidents, claims, disputes, recovery visibility, and Today
projections. Removing a permission, assignment, or active membership takes effect on the next
authoritative request even when a client still holds stale UI state.

Operational Staff vehicle reads add a lifecycle ceiling after workspace and assignment scope:
only `APPROVED` vehicles are returned from lists or direct detail reads. Creator provenance never
grants ordinary Staff access to a draft, Owner-review submission, changes-required submission,
withdrawn submission, or platform-review vehicle. Managers retain creator-only pre-live visibility,
and Owners retain their review visibility.

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
- Requests is available only to the actual Owner or a Manager with booking-request permission.

Today independently authorizes booking-request, rental, vehicle, and message summaries and omits
unauthorized counts. “No assigned vehicles” is distinct from an empty Owner fleet. Booking Requests
and Active rentals use their shared destinations from Today rather than duplicate delegated
shortcuts in More. Actual Owner tabs and Owner-only areas remain unchanged.
Operational Staff Today never includes pre-booking request counts or actions, while retaining its
authorized pickup, handover, active-rental, return, overdue, recovery, inspection, and operational
work. A stale Requests selection is normalized back to Today when the active workspace is Staff.

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

Delegated blocked-period creation and removal deliberately remain part of that existing availability
subsystem rather than the Manager live-operational-edit aggregate. They require the established
`availability.update` permission and vehicle-scope check, and their occupancy row plus blocked-period
row commit atomically under the database exclusion constraint. They do not bump `Vehicle.revision`
or emit the live-edit Owner notification. Adding those effects would require introducing a Vehicle
row lock into transactions that already participate in booking/occupancy exclusion locking, while
removal has no request idempotency key beyond the mutable blocked-period row. Until a single lock
order and stable operation identity are defined across booking and availability flows, this narrow
exception avoids a lock-order inversion or duplicate side effects. The existing delegated audit
entry remains best-effort after the availability commit; this limitation must be resolved as an
availability-architecture change, not by weakening occupancy correctness.

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
`SectionHeader`, `StatusBadge`, `Field`, `Chip`, `SegmentedControl`, `Button`, `StateView`,
selectable-option, adaptive-sheet, sticky-footer, confirmation-sheet, and Danger-zone patterns. No
parallel Staff design system exists. Custom permissions are edited in the shared adaptive-sheet
presentation with grouped human-readable choices and section-level bulk selection.

Permission and vehicle selectors expose labels plus selected state; status badges have textual
labels; destructive actions are explicit; hidden unauthorized controls are absent from the
accessibility tree; interactive controls preserve the shared touch-target standard. Loading,
network error/retry, no-access, no-assignment, and normal empty-data states remain distinct.

## Database and deployment

Migration `20261010140000_owner_staff_authority_foundation` is forward-only. It creates memberships,
explicit permission rows, invitations, selected-vehicle assignments, indexes, uniqueness rules, and
same-owner assignment protection without rewriting historical migrations. Stable access and
first-time setup are added by `20261012100000_owner_staff_access_links` and
`20261012130000_owner_staff_invitation_setup`. Password recovery is added by
`20261012160000_owner_staff_password_recovery`, including link/version-bound OTP challenges and
reset capabilities. Deployment must run the normal Prisma migration process before enabling
clients that depend on these projections. Migration
`20261012190000_delegated_vehicle_creation_foundation` adds Manager-default vehicle-creation
authority, immutable creator provenance, vehicle revisioning, and the separate Owner-approval
request foundation without enabling the later delegated creation or approval endpoints.

## Trusted Manager authority

`OwnerStaffMembership.ownerApprovalBypassEnabled` is a narrow, Owner-controlled trust setting for
members whose role remains `MANAGER`. It is separate from permission grants: it adds no permission,
does not confer the Owner role, and cannot make an otherwise unauthorized action valid. The database
prevents the setting from being enabled for ordinary Staff, and only the actual workspace Owner may
change it for an active Manager.

Trust changes apply only to future actions and submissions. Enabling trust never auto-approves an
existing request, and disabling it never rewrites an action or platform-review submission that was
already made. CarShare review, workspace and vehicle scope, lifecycle checks, and every existing
permission check remain authoritative.

Trusted authority must never bypass Owner identity, ownership transfer, workspace deletion, payout
or bank settings, payout destinations, Owner-only financial ledger/reporting, manual refunds or
charges, Security Deposit settlement, Manager administration, trust configuration, Owner-only live
vehicle archive/removal, or platform review and compliance.

No successful vehicle mutation that uses trusted authority may be silent. Future vehicle-action
implementation must create an in-app notification for the actual Owner and request push delivery
when enabled:

- Safe applied change: **Vehicle updated** — `[Manager name] updated [Vehicle name] using trusted authority.`
- Review-sensitive submission: **Vehicle changes submitted** — `[Manager name] submitted changes to [Vehicle name] for CarShare review.`
- New trusted vehicle submission: **Vehicle submitted for review** — `[Manager name] submitted [Vehicle name] to CarShare review using trusted authority.`

Push copy must not contain sensitive raw values. This phase records the invariant only; it does not
implement approval bypass for any vehicle mutation.

## Vehicle change proposal foundation

Manager configuration changes use a dedicated `VehicleChangeProposal` aggregate rather than
writing pending values into the live vehicle aggregate. A proposal owns a complete canonical
`VehicleChangeProposalSnapshotV1` (`snapshotSchemaVersion = 1`) covering configurable vehicle
specifications, feature IDs, ordered photos, documents, private location, Known issues, and the
complete current policy. Ownership identity, lifecycle state, payout data, workspace assignment,
and audit internals are excluded.

Creating or storing a proposal does not change `Vehicle`, increment its revision, create a
`VehiclePolicyVersion`, replace live features/photos/documents/location, or affect the public
listing. The proposal records the live `Vehicle.revision` as `baseVehicleRevision`; later submission
and application must fail with `VEHICLE_CHANGE_PROPOSAL_STALE` when that revision no longer matches.

Changed fields are derived server-side by a deterministic canonical-snapshot diff. Owner-approval
fields include description, rental requirements, features, and policy configuration. Identity,
specification, photo, document, and private-location changes are classified
`PLATFORM_REVIEW_REQUIRED`. Operational availability and blocked periods remain in their existing
authority paths, while Owner-only ownership, lifecycle, financial, settlement, administration, and
trust controls cannot enter a proposal.

Only one active proposal (`DRAFT`, either changes-required state, or either pending-review state)
may exist per vehicle. Terminal proposals remain immutable history and do not prevent a new cycle.
Composite foreign keys keep the vehicle and submitting membership in the same Owner workspace.
The database submitter guard accepts `GENERAL` proposals only from active Managers and accepts
`STAFF_KNOWN_ISSUE` proposals only from active Staff memberships that still hold
`known_issues.create`. Submitter provenance preserves the delegated user and membership separately
from the Owner of record; service-level snapshot validation provides the narrower field ceiling.

Proposal photo/document references are proposal-owned and must use non-public file assets. Database
guards prevent active proposal assets from being published or attached to live `VehiclePhoto` or
`VehicleDocument` rows. Terminalizing a proposal preserves its asset references as history; later
promotion/cleanup must be explicit.

Trust decision fields default safely and are populated only by submission orchestration. The
foundation was introduced without review behavior; the current submission, Owner review, trusted
bypass, Admin review, and asset-promotion behavior is described by the consolidated sections below.

### Phase 3: Manager proposal draft API

Phase 3 exposes workspace-scoped create, creator-read, update, and withdraw operations for Manager
vehicle-change proposals. These operations require an `ACTIVE` Manager membership, the existing
`vehicles.update_operational_fields` permission, and access to the vehicle under the membership's
`ALL_VEHICLES` or selected-vehicle scope. This broad permission is the narrowest existing authority
for editing an existing vehicle; every canonical proposal field maps to it until a future permission
model introduces narrower field capabilities. The target must be an `APPROVED` live vehicle, which
matches the existing Manager operational-edit lifecycle ceiling; suspended, archived, and
pre-approval vehicles are ineligible.

Only the Manager who created a proposal may read, edit, or withdraw it in this phase, and only
`DRAFT` proposals are editable or withdrawable. Withdrawal records the `WITHDRAWN` transition and
retains proposal history. The database partial unique index continues to permit at most one active
proposal per vehicle.

Create copies the current canonical V1 snapshot and current `Vehicle.revision`. Update accepts only
a complete, validated V1 snapshot. The server reloads the live canonical snapshot, rejects an
outdated base with `VEHICLE_CHANGE_PROPOSAL_STALE`, and recomputes `changedFields`, classification,
and `platformReviewRequired`. Clients cannot write those authority fields, and proposals are never
silently rebased.

Proposal mutations use serializable transactions and audit the actual Manager user and membership.
They do not write the live vehicle, policy versions, photos, documents, location, availability, or
blocked periods. Availability remains on its existing operational authority path and is not part of
proposal editing.

Operational Staff may create, read, update, submit, and withdraw only their own proposal and only
when its server-derived diff contains `knownIssues`. The narrow `known_issues.create` permission
authorizes entry to the proposal aggregate, while a server field whitelist prevents
Staff from changing vehicle specifications, pricing, policy, handover configuration, photos,
documents, or location. A Staff Known-issue proposal remains non-live until Owner approval. Known
issues are Owner-approval-only changes; they do not require platform review unless combined with a
separately review-sensitive change. New issue attribution remains the submitting delegated user,
not the approving Owner or reviewing Admin.

Operational Staff Today skips booking-request queries entirely when request authority is absent.
Its request projection is a stable zero-count result, while pickup, active-rental, return, overdue,
recovery, inspection, and other authorized operational reads continue under `rentals.view`.

The initial Phase 3 slice did not add proposal asset upload. The current flow does: proposal photo
and document uploads remain private proposal assets, are authorized through proposal-scoped preview
grants, and cannot enter live vehicle tables until an approved promotion transaction.

Trusted and non-trusted Managers have identical draft behavior. Trust is not read or consumed until
a later submission decision. This phase does not provide submission, Owner approval or bypass,
Owner notifications, Admin review, live application, or a mobile vehicle editor.

### Phase 4: normal submission and Owner review

The creating Manager may submit a non-empty, valid, fresh `DRAFT`. Submission re-reads the live
canonical snapshot, recomputes changed fields and classification, and freezes the result as
`PENDING_OWNER_APPROVAL` for a normal Manager. Trusted submission behavior is described in Phase 6;
trust is always re-read transactionally and is never accepted from the client.

Only the actual vehicle Owner can use the pending-proposal list, comparison detail, approval, and
change-request routes. A change request requires a meaningful reason and transitions
`PENDING_OWNER_APPROVAL` to `OWNER_CHANGES_REQUIRED` without touching live data. The creating Manager
reopens the same proposal by updating it: the first valid update atomically moves it back to
`DRAFT`, after which it can be resubmitted. No second proposal row is created. The creator may also
withdraw either a `DRAFT` or `PENDING_OWNER_APPROVAL` proposal; platform-review and terminal states
cannot be withdrawn through this flow.

Owner approval recomputes the classification once more under vehicle and proposal locks. An
`OWNER_APPROVAL_ONLY` proposal applies description, rental requirements, the complete feature set,
and a new durable policy version in one serializable transaction. The vehicle revision increments
exactly once, and the proposal becomes `APPLIED`. A failure in any live update, policy creation,
proposal transition, or audit rolls back the transaction.

A `PLATFORM_REVIEW_REQUIRED` proposal instead moves only the proposal to
`PENDING_PLATFORM_REVIEW`. The live vehicle stays `APPROVED`; its revision, configuration, active
policy, features, photos, documents, private location, public listing, and proposal-owned private
assets remain unchanged. Phase 4 does not implement the Admin queue, Admin decision, or later
proposal promotion. The proposal-specific Admin queue and decision flow now performs that promotion
as described below.

Submission and Owner decisions reject a stale base with `VEHICLE_CHANGE_PROPOSAL_STALE` and never
silently rebase. Mutation audits remain transactional and distinguish the Manager submission actor
from the actual Owner reviewer. The completed workflow emits transactional outbox events for normal
submission and Owner decisions. Delivery uses privacy-safe templates; Owner submissions deep-link
to the proposal review screen, while Manager outcomes return to the currently authorized vehicle
state. No SMS delivery is introduced by this proposal workflow.

### Phase 6: trusted proposal submission

Submission now re-reads the current `ACTIVE` Manager membership, exact edit permission, workspace,
vehicle assignment, and `ownerApprovalBypassEnabled` value inside the serializable transaction.
Client or proposal-creation-time trust is never authoritative. Trust remains future-actions-only:
changing it does not rewrite proposals already awaiting Owner or platform review.

A normal Manager still transitions a fresh `DRAFT` to `PENDING_OWNER_APPROVAL`. A trusted Manager's
`OWNER_APPROVAL_ONLY` proposal instead applies atomically, creates exactly one new policy version,
replaces the feature set, increments the vehicle revision once, and becomes `APPLIED`. A trusted
review-sensitive proposal becomes `PENDING_PLATFORM_REVIEW` without changing any live vehicle,
policy, media, document, location, lifecycle, revision, or public-listing state. Trusted authority
never bypasses CarShare review.

Both trusted outcomes record the Manager actor, membership, workspace, permission, changed fields,
base/result revision, trust decision, approval-bypass decision, platform-review requirement, and
resulting proposal status. They also create an Owner-directed notification outbox event in the same
transaction. Stable proposal/action/revision identities deduplicate worker retries. Notifications
support in-app delivery and push when enabled, contain only safe Manager and vehicle display names,
and deep-link to the current authorized Owner vehicle state. They never become Owner approval tasks.

Trust adds no permissions and does not change the Manager role. Ownership/workspace changes,
payout/bank controls, manual money movement, Security Deposit settlement, trust configuration,
Manager administration, live-vehicle archive/removal, and platform compliance remain Owner-only.

Trusted bypass also applies to future Manager-created **new vehicle** submissions through the
existing workspace-scoped submission endpoint. Submission re-reads the active Manager membership,
the exact `vehicles.create` permission, and `ownerApprovalBypassEnabled` under the vehicle lock. A
normal Manager still creates a `VehicleOwnerApprovalRequest`; a trusted Manager creates no Owner
approval request and moves the complete draft directly from `DRAFT` to `PENDING_APPROVAL` for
CarShare review. The transition, trust decision, Manager provenance, audit record, and privacy-safe
Owner notification are committed atomically. Existing pending Owner-approval requests are not
retroactively bypassed, and CarShare review remains mandatory.
