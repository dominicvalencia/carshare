# ADR-0025: biometric-only local app lock

- Status: Accepted (Phase 12 stabilization)
- Date: 2026-09-04
- Supersedes: the custom PIN/PBKDF2 portions of
  [ADR-0019](0019-phase12-app-lock-and-psgc-reference.md); its PSGC decision remains current.

## Decision

The optional local app lock delegates authentication entirely to enrolled operating-system biometrics
through Expo Local Authentication. The application stores only account-scoped enablement and inactivity
state in SecureStore and never receives biometric templates. Cold start and five minutes in the
background restore the protected surface as locked. Cancellation or failure leaves it locked and
allows an explicit biometric retry.

The former custom six-digit PIN/PBKDF2 path is not part of the current product. Storage loading deletes
legacy PIN records so an old local record cannot trap a user behind an unsupported unlock mechanism.
Normal sign-out and account switching preserve account isolation.

## Consequences

There is no application PIN fallback. A user must enroll supported device biometrics before enabling
the lock. Physical iOS/Android device testing remains necessary; simulator or Expo behavior is not a
production biometric-security certification. The API session and authorization model remain unchanged.
