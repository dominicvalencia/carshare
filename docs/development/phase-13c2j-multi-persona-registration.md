# Phase 13C-2J — Multi-persona registration and onboarding authority

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / MIGRATION VERIFICATION PASS / PHYSICAL OWNER UX ACCEPTANCE PASS**.

Physical Owner acceptance confirmed the complete multi-persona experience, including the corrected RENTER-to-OWNER first-entry transition. The OWNER enrollment response persists the principal-scoped transition intent and Hosting mode before identity refresh, so the root navigator resolves Owner Welcome without bouncing to Renter Home. After the guided Owner experience is first entered, later Hosting switches open Owner Dashboard while Owner verification continues independently through Owner Profile.

## Registration and persona model

Registration creates one `User`, one `UserProfile`, the existing email-verification token, and an authenticated session. It no longer assigns a marketplace role. An authenticated user with neither `RENTER` nor `OWNER` is routed to the required, unselected persona choice:

- **Rent a car** assigns only marketplace `RoleCode.RENTER` and opens Renter onboarding.
- **List my car** assigns only marketplace `RoleCode.OWNER`, initializes one `OwnerProfile`, and opens Vehicle Owner onboarding.

The authenticated `POST /api/v1/me/personas` endpoint accepts only `RENTER` or `OWNER`. It is not a general role-assignment endpoint and cannot assign administrative roles. Marketplace `RoleCode.OWNER` and administrative `AdminRole.OWNER` remain separate authorities.

A single identity may later hold both marketplace personas. Renter-only users can choose **Become a Vehicle Owner** and Vehicle Owner-only users can choose **Start Renting Cars**. Repeated or concurrent enrollment preserves the original `UserRole.assignedAt`, existing `OwnerProfile.createdAt`, Owner state, and Owner data.

`UserProfile.initialMarketplacePersona` records the first explicit RENTER or OWNER choice. Enrollment sets it only while it is null, so adding a second persona never changes the initial choice. Login workspace resolution uses a valid saved active mode first, then this authoritative initial persona, then a deterministic currently enabled role fallback. Missing or malformed device state is treated as absent rather than silently becoming Renting. Logout may clear the device-local active mode; the next login therefore falls back to the initial persona.

## Authoritative onboarding state

`UserProfile.renterOnboardingCompletedAt` is the server authority for the guided Renter onboarding gate:

- no RENTER role: Renter capability is not enabled;
- RENTER plus a null completion timestamp: guided setup is in progress;
- RENTER plus a non-null completion timestamp: guided setup was completed or acknowledged by intentionally skipping it.

Completion and Skip use the authenticated, idempotent `POST /api/v1/me/personas/renter/onboarding-completion` mutation. The first non-null timestamp is preserved. The former `renter-onboarding_<userId>` SecureStore marker is no longer a navigation authority, so relaunch, login, reinstall, and cross-device recovery use persisted server state.

`renterVerificationDraftStep` remains independent and records only saved Renter verification form progress. Neither field represents email verification, mobile verification, identity approval, driver-license approval, or booking eligibility. The existing Renter eligibility service remains authoritative for booking.

`UserProfile.ownerOnboardingFirstEnteredAt` is the authoritative first-entry marker for the introductory Owner guide. The authenticated Owner-entry mutation sets it only while null, when the guided screen is actually entered, and preserves the first timestamp. After that first entry, all future Hosting switches open Owner Dashboard regardless of whether `OwnerProfile.status` is DRAFT, PENDING_VERIFICATION, VERIFIED, REJECTED, or SUSPENDED. Owner verification remains a separate recurring workflow through Owner Profile; the new timestamp is neither verification completion nor operational authorization.

## Migration and compatibility

Migration `20260910100000_phase13c2j_renter_onboarding_authority` adds nullable PostgreSQL `TIMESTAMPTZ(3)` column `user_profiles.renter_onboarding_completed_at`.

Every pre-migration user who already held RENTER is backfilled with the migration timestamp as a **compatibility marker**. It is not the historical time that person completed onboarding and must never be used for historical analytics. Users without RENTER remain null. The migration assigns no roles and changes no `UserRole.assignedAt`, `OwnerProfile`, verification, KYC, or financial data.

Existing Renter and dual-persona users therefore do not repeat guided onboarding. Existing Vehicle Owner roles and profiles retain their state.

Migration `20260910200000_phase13c2j_initial_persona_owner_first_entry` adds the restricted PostgreSQL enum `MarketplacePersona` (`RENTER`, `OWNER`) and nullable `user_profiles.initial_marketplace_persona` and `user_profiles.owner_onboarding_first_entered_at` columns. RENTER-only and OWNER-only histories receive the corresponding initial persona. Dual-role histories use strict first-assignment ordering; ties and other ambiguous histories remain null for deterministic runtime fallback rather than inventing intent. Established Owners receive an Owner-guide compatibility timestamp so migration does not unexpectedly reopen introductory onboarding. Roleless users retain null values. The migration does not alter roles, assignment timestamps, OwnerProfile status, verification, KYC, or financial history.

## Reporting and authorization boundaries

- New Renters remains the first RENTER `UserRole.assignedAt`.
- New Vehicle Owners remains `OwnerProfile.createdAt`.
- `renterOnboardingCompletedAt` and `User.createdAt` do not attribute New Renters.
- RENTER enrollment does not create an OwnerProfile.
- OWNER enrollment does not grant RENTER or booking permission.
- Completing guided Renter onboarding does not bypass verification or eligibility.
- Owner listing/publication and operational restrictions remain unchanged.
- Blocked, suspended, and deactivated users cannot self-enroll a persona.
- Persona responses expose only safe enabled/onboarding/status presentation state.

No ledger, payment, payout, commission, Owner Payable, revenue, trend, or other accounting behavior changes in this milestone.

## Navigation

Roleless users see Persona Selection. RENTER users with incomplete guided setup see Renter onboarding only while Renting mode is active. Owner-first registration opens guided Vehicle Owner setup from the authoritative initial OWNER persona. A later explicit OWNER enrollment writes a principal-scoped transient first-entry intent and Hosting mode before the authenticated identity refresh, so the root navigator remount cannot lose the transition from Renter Profile to Owner Welcome. The guide records authoritative first entry only when it mounts and then clears the transient intent. Ordinary later Hosting entry never infers onboarding from DRAFT or REJECTED verification state. Any user with marketplace OWNER can switch to Hosting and reach the Owner Dashboard, while verification continues to gate protected operations. Dual-persona users reuse a valid Renting/Hosting preference; absent or invalid saved state falls back to the initial marketplace persona when available and valid, then to a currently enabled persona. Server roles always override device-local preferences for authorization and protected operations.

The transient `owner-first-entry-intent_<userId>` SecureStore value is navigation recovery state, not historical or authorization authority. It is written only when the OWNER enrollment response says `newlyEnrolled: true`, survives the immediate identity refresh, and is removed only after the Owner onboarding-entry API succeeds. If enrollment succeeds but immediate navigation is interrupted, a later explicit Hosting switch while the authoritative entry timestamp is still null recreates the narrow recovery intent. This does not globally force onboarding for existing Owners and never changes `initialMarketplacePersona`; a RENTER-first account therefore still defaults to Renting after logout clears its active-mode preference.

A future lightweight mode-switch refinement may improve discoverability, but a major navigation redesign and persona removal are out of scope.

### Guided Vehicle Owner setup

Vehicle Owner setup uses the same Welcome treatment and horizontal pager as Renter onboarding, followed by four Owner-specific steps: Personal, Address, Document, and Review. It presents accessible finite progress, uses the shared keyboard-aware screens and validation primitives, and retains in-progress form data when navigating backward. Valid non-empty partial profile fields are saved when leaving Personal or Address; missing or currently invalid fields do not prevent guided navigation and remain required by the authoritative submission endpoint.

Swipe left advances through Welcome, Personal, Address, Document, and Review; swipe right and the visible Back button use the same bounded step transition. A horizontal gesture is captured only after it exceeds eight points and is at least 1.5 times the vertical movement, preserving ordinary vertical scrolling and field interaction. Swiping to Review never submits verification. Native stack swipe-back remains disabled because it would pop the entire route rather than navigate one wizard step.

**Skip onboarding** is available throughout the Owner guide. The guide's first actual entry is already recorded server-side, so leaving or skipping it does not cause it to reopen on later login, relaunch, reinstall, cross-device use, or Hosting switch. The account-scoped device preference remains only a non-authorizing current-device presentation cache. Neither marker changes the OWNER role or OwnerProfile state, marks verification complete, submits evidence, publishes a vehicle, or affects payout readiness. DRAFT and REJECTED remain resumable in Owner Profile, PENDING_VERIFICATION remains submitted for review, VERIFIED remains operational according to policy, and SUSPENDED remains restricted.

Renter Profile has one Owner entry point rather than a duplicate Hosting section. Its accepted CTA copy is **List your car** with **Start verification and build your first listing.** Existing Owners can switch to Hosting without introducing another lower Hosting section. Both Renting Profile and Hosting Profile expose the same confirmed **Log out** action, and an OWNER-only account can start Renting without losing its Owner state.

### Owner profile and verification

The first-time guided Owner experience and the recurring Owner verification workflow are separate presentations over the same authoritative `OwnerProfile` data and endpoints:

- **Owner guided onboarding** contains Welcome, horizontal paging, relaxed step progression, progress indicators, and Skip. It is entered when OWNER is first selected or enrolled.
- **Owner Profile** opens the previously accepted four-step required verification layout: Personal, Address, Document, and Review. It contains no Welcome, Get started action, or Skip. Back and Save and continue navigate the required steps, saved OwnerProfile values are prefilled, and Review provides the only explicit submission action.
- **Owner verification state** remains exclusively `OwnerProfile.status`; dismissing the guide never changes it.

Hosting Profile contains one **Owner Profile** entry point and announces a customer-safe authoritative status: DRAFT is **Verification required**, PENDING_VERIFICATION is **Verification pending**, VERIFIED is **Verified**, REJECTED is **Changes required**, and SUSPENDED is **Account restricted**. The status is text, not color-only. DRAFT and REJECTED open the correction/submission form directly; pending, verified, and suspended profiles open the appropriate status presentation. Protected Owner actions route to Owner Profile rather than restarting the introductory guide.

An incomplete second-persona Renter guide is represented independently. When RENTER exists and `renterOnboardingCompletedAt` is null, Hosting Profile shows **Continue Renter Setup** while Owner Profile continues to show its own Owner verification status. Returning to Hosting does not force Renter onboarding, and returning to Renting does. Once Owner guided onboarding has been entered, server persistence ensures Hosting returns to the dashboard even while OwnerProfile is DRAFT, including after login, reinstall, or cross-device use.

### Renter contact verification step

The recurring Renter Verification screen presents Contact information as step 1 of one coherent eight-step verification experience, followed by Personal information, Residential address, Driver information, Emergency contact, Identity documents, Selfie, and Review and submit. Existing email verification and mobile OTP mechanics are unchanged. Contact is a presentation-only leading step: the persisted `renterVerificationDraftStep` continues to number the seven authoritative KYC data stages exactly as before, so existing drafts are not silently reinterpreted and no migration is required. Continuing from Contact resumes the server-saved KYC stage; Back from Personal returns to Contact.

## Session storage and physical QA reset

Mobile refresh tokens remain in Expo SecureStore using iOS Keychain or the Android secure-storage implementation. On iOS, Keychain-backed values can survive deleting and reinstalling an app with the same bundle identifier, so reinstall is not a reliable clean-session procedure. This does not come from `renterOnboardingCompletedAt`, OwnerProfile, the saved Renting/Hosting preference, or a development-client cache. Production secure token persistence is unchanged.

Logout is the supported physical-QA reset. It attempts the authenticated server logout and, whether that request succeeds or fails, clears the in-memory access token, SecureStore refresh token, cached authenticated user, account-scoped app-lock material, and saved Renting/Hosting mode. It does not remove marketplace roles, renter onboarding authority, OwnerProfile state, verification/KYC records, or reporting history. The principal-keyed application subtree is then remounted as the unauthenticated experience, which discards its query cache.

Reliable physical test sequence:

1. Choose **Log out** from either Renting Profile or Hosting Profile and confirm the prompt.
2. Confirm the login/registration screen appears.
3. Register a unique controlled test account.
4. Exercise Persona Selection and the required onboarding path.

No separate development-only session reset was added because the shared logout action provides the necessary safe reset without introducing a production-adjacent diagnostic control.

## Acceptance boundary

Automated verification must complete before physical review. Physical review covers Renter-first, Owner-first, both second-persona paths, roleless interruption, onboarding interruption, relaunch/login/reinstall/cross-device behavior, legacy accounts, Profile states, Admin single-identity presentation, reporting regression, access control, and accessibility.

No real email, SMS, push, payment, payout, KYC, storage, or webhook provider operation is part of this milestone.
