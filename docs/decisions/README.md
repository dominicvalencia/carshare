# Architecture Decision Records

- [ADR-0001: pnpm and Turborepo monorepo](0001-pnpm-turborepo-monorepo.md)
- [ADR-0002: NestJS modular monolith](0002-modular-monolith.md)
- [ADR-0003: one mobile application and owner authorization](0003-single-mobile-and-owner-authorization.md)
- [ADR-0004: PostgreSQL and Redis authority boundaries](0004-data-authority-boundaries.md)
- [ADR-0005: versioned API and observability conventions](0005-api-observability-conventions.md)
- [ADR-0006: locked MVP operating decisions](0006-locked-mvp-operating-decisions.md)
- [ADR-0007: Expo React Native toolchain](0007-expo-react-native-toolchain.md)
- [ADR-0008: identity, rotating sessions, and administrative access](0008-identity-tokens-and-administrative-access.md)
- [ADR-0009: vehicle lifecycle, spatial location, and immutable policy versions](0009-vehicle-supply-and-policy-versions.md)
- [ADR-0010: public discovery, advisory availability, and immutable quotes](0010-public-discovery-availability-and-quotes.md)
- [ADR-0011: authoritative booking holds and unified vehicle occupancy](0011-authoritative-booking-occupancy.md)
- [ADR-0012: provider-independent payments and immutable financial ledger](0012-provider-independent-payments-and-ledger.md)
- [ADR-0013: server-authoritative rental operations and immutable evidence](0013-rental-operations-and-evidence.md)
- [ADR-0014: controlled claims, additional charges, and earning release](0014-claims-disputes-and-earning-release.md)
- [ADR-0015: provider-independent owner payout settlement](0015-provider-independent-owner-payout-settlement.md)
- [ADR-0016: marketplace communications, notifications, reputation, and support](0016-marketplace-communications-notifications-reputation-support.md)
- [ADR-0017: mobile product experience and development location resolver](0017-mobile-product-experience-layer.md)
- [ADR-0018: renter verification and rental eligibility](0018-renter-verification-and-rental-eligibility.md)
- [ADR-0019: local app lock and platform-owned PSGC reference](0019-phase12-app-lock-and-psgc-reference.md)
- [ADR-0020: platform-controlled late returns and booking extensions](0020-platform-controlled-late-return-and-extensions.md)
- [ADR-0021: criteria-bound cursor pagination for marketplace search](0021-marketplace-search-cursors.md)
- [ADR-0022: server-authoritative duration discounts in immutable pricing](0022-duration-discount-pricing.md)
- [ADR-0023: double-blind review publication and public reputation](0023-double-blind-review-publication.md)
- [ADR-0024: opaque public Host Profile and privacy boundary](0024-public-host-profile-privacy.md)
- [ADR-0025: biometric-only local app lock](0025-biometric-only-local-app-lock.md)
- [ADR-0026: environment separation and application identities](0026-environment-separation-and-application-identities.md)
- [ADR-0027: secret management and provider activation](0027-secret-management-and-provider-activation.md)

ADRs 0001–0020 remain historical/current decisions as amended by later ADRs. In particular, ADR-0010's
Phase 4 cursor/pricing scope is extended by ADRs 0021–0022, and ADR-0016's immediate-publication review
model is amended by ADRs 0023–0024. No ADR is silently rewritten as though the earlier phase did not
exist.

ADR-0025 supersedes only the custom PIN/PBKDF2 portion of ADR-0019. ADR-0019's PSGC reference-data
decision remains current.
