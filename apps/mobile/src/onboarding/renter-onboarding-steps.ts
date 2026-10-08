export const RENTER_ONBOARDING_STEPS = [
  { id: 'PERSONAL_INFORMATION', kycStep: 0 },
  { id: 'CONTACT_VERIFICATION' },
  { id: 'RESIDENTIAL_ADDRESS', kycStep: 1 },
  { id: 'DRIVERS_LICENSE', kycStep: 2 },
  { id: 'EMERGENCY_CONTACT', kycStep: 3 },
  { id: 'IDENTITY_DOCUMENTS', kycStep: 4 },
  { id: 'IDENTITY_PHOTOS', kycStep: 5 },
  { id: 'REVIEW', kycStep: 6 },
] as const;

export type RenterOnboardingStepId = (typeof RENTER_ONBOARDING_STEPS)[number]['id'];

export const RENTER_PROFILE_VERIFICATION_STEPS = RENTER_ONBOARDING_STEPS;

export function renterVerificationPageForStep(id: RenterOnboardingStepId) {
  return RENTER_PROFILE_VERIFICATION_STEPS.findIndex((step) => step.id === id);
}

export function renterOnboardingPageForKycStep(kycStep: number) {
  return RENTER_ONBOARDING_STEPS.findIndex((step) => 'kycStep' in step && step.kycStep === kycStep);
}

export function adjacentRenterOnboardingPage(current: number, delta: -1 | 1) {
  return Math.max(0, Math.min(RENTER_ONBOARDING_STEPS.length - 1, current + delta));
}

export function renterOnboardingResumePage(snapshot: {
  readonly definitions: readonly { readonly code: string; readonly required: boolean }[];
  readonly emailVerifiedAt: string | null;
  readonly mobileVerifiedAt: string | null;
  readonly profile: { readonly renterVerificationDraftStep: number } | null;
  readonly verifications: readonly {
    readonly documents: readonly {
      readonly definition: { readonly code: string } | null;
      readonly replacedAt: string | null;
    }[];
  }[];
}) {
  const completedProfileStep = snapshot.profile?.renterVerificationDraftStep ?? 0;
  if (completedProfileStep < 1) return 0;
  if (!snapshot.emailVerifiedAt || !snapshot.mobileVerifiedAt) return 1;
  if (completedProfileStep < 2) return 2;
  if (completedProfileStep < 3) return 3;
  if (completedProfileStep < 4) return 4;

  const activeDocumentCodes = new Set(
    snapshot.verifications.flatMap(({ documents }) =>
      documents
        .filter(({ replacedAt }) => !replacedAt)
        .map(({ definition }) => definition?.code)
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const requiredDocumentsComplete = snapshot.definitions
    .filter(
      ({ code, required }) =>
        required && code !== 'PROFILE_PHOTO' && code !== 'SELFIE_WITH_LICENSE',
    )
    .every(({ code }) => activeDocumentCodes.has(code));
  if (!requiredDocumentsComplete) return 5;
  if (!activeDocumentCodes.has('PROFILE_PHOTO') || !activeDocumentCodes.has('SELFIE_WITH_LICENSE'))
    return 6;
  return 7;
}
