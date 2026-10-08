import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adjacentRenterOnboardingPage,
  RENTER_ONBOARDING_STEPS,
  RENTER_PROFILE_VERIFICATION_STEPS,
  renterOnboardingPageForKycStep,
  renterOnboardingResumePage,
  renterVerificationPageForStep,
} from './renter-onboarding-steps';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
const pager = readFileSync(resolve(root, 'src/onboarding/GuidedOnboarding.tsx'), 'utf8');
const profilePages = readFileSync(
  resolve(root, 'src/features/account/RenterOnboardingPages.tsx'),
  'utf8',
);
const account = readFileSync(resolve(root, 'src/features/account/AccountScreen.tsx'), 'utf8');

describe('renter onboarding navigation', () => {
  it('defines one unique, stable eight-page sequence', () => {
    const ids = RENTER_ONBOARDING_STEPS.map(({ id }) => id);
    expect(ids).toEqual([
      'PERSONAL_INFORMATION',
      'CONTACT_VERIFICATION',
      'RESIDENTIAL_ADDRESS',
      'DRIVERS_LICENSE',
      'EMERGENCY_CONTACT',
      'IDENTITY_DOCUMENTS',
      'IDENTITY_PHOTOS',
      'REVIEW',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('projects the Profile verification flow from the same stable identity-step registry', () => {
    expect(RENTER_PROFILE_VERIFICATION_STEPS).toBe(RENTER_ONBOARDING_STEPS);
    expect(new Set(RENTER_PROFILE_VERIFICATION_STEPS.map(({ id }) => id)).size).toBe(
      RENTER_PROFILE_VERIFICATION_STEPS.length,
    );
    expect(renterVerificationPageForStep('PERSONAL_INFORMATION')).toBe(0);
    expect(renterVerificationPageForStep('CONTACT_VERIFICATION')).toBe(1);
    expect(renterVerificationPageForStep('EMERGENCY_CONTACT')).toBe(4);
    expect(renterVerificationPageForStep('REVIEW')).toBe(7);
  });

  it('keeps optional emergency contact as the shared fifth verification step', () => {
    expect(RENTER_ONBOARDING_STEPS[4]).toEqual({ id: 'EMERGENCY_CONTACT', kycStep: 3 });
  });

  it('renders Profile verification with the shared redesigned pages and no Skip action', () => {
    const flow = profilePages.slice(
      profilePages.indexOf('export function RenterProfileVerificationFlow'),
      profilePages.indexOf('export function RenterOnboardingContactPage'),
    );
    expect(flow).toContain('RENTER_PROFILE_VERIFICATION_STEPS.map');
    expect(flow).toContain('<RenterOnboardingContactPage');
    expect(flow).toContain('<RenterOnboardingKycPage');
    expect(flow).toContain('pageCount={RENTER_PROFILE_VERIFICATION_STEPS.length}');
    expect(flow).not.toContain('onSkip=');
    expect(account).toContain('<RenterProfileVerificationFlow');
  });

  it('walks forward and backward exactly once through every visible page', () => {
    const forward = [0];
    while (forward.at(-1)! < RENTER_ONBOARDING_STEPS.length - 1)
      forward.push(adjacentRenterOnboardingPage(forward.at(-1)!, 1));
    expect(forward).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const backward = [RENTER_ONBOARDING_STEPS.length - 1];
    while (backward.at(-1)! > 0) backward.push(adjacentRenterOnboardingPage(backward.at(-1)!, -1));
    expect(backward).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('maps domain KYC steps to their single visible pages without changing their values', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(renterOnboardingPageForKycStep)).toEqual([
      0, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('drives header progress and page translation from the same current page', () => {
    expect(pager).toContain('<PageIndicator count={pageCount} current={currentPage} />');
    expect(pager).toContain('toValue: -currentPage * width');
    expect(pager).toContain('accessibilityLabel={`Onboarding page ${current + 1} of ${count}`}');
    expect(app).toContain('currentPage={stage}');
    expect(app).toContain('onPageChange={setStage}');
  });

  it('commits a swipe target immediately and animates only from the authoritative page', () => {
    const settle = pager.slice(pager.indexOf('const settle'), pager.indexOf('const pager'));
    expect(settle).toContain('onPageChange(nextPage);');
    expect(settle.indexOf('onPageChange(nextPage);')).toBeGreaterThan(
      settle.indexOf('if (nextPage === currentPage)'),
    );
    expect(pager).toContain('toValue: -currentPage * width');
    expect(pager).not.toContain('}).start(({ finished }) =>');
  });

  it('uses one-step Continue and Back transitions and stable page keys', () => {
    expect(app).toContain('onBack={() => setStage(page - 1)}');
    expect(app).toContain("definition.id === 'REVIEW' ? onSkip() : setStage(page + 1)");
    expect(app).toContain('pageKeys={RENTER_ONBOARDING_STEPS.map(({ id }) => id)}');
    expect(pager).toContain('key={pageKeys?.[index] ?? index}');
  });

  it('keeps persisted completion and Skip separate from visible pager state', () => {
    expect(app).toContain('const [stage, setStage] = useState(0)');
    expect(app).toContain('setStage(renterOnboardingResumePage(verification.data))');
    expect(app).toContain('resumeApplied.current = true');
    expect(app).toContain('<RenterOnboardingDraftProvider>');
    expect(app).toContain('onSkip={onSkip}');
  });

  it('resumes at the next incomplete stable page without treating completion as the live index', () => {
    const base = {
      definitions: [
        { code: 'DRIVERS_LICENSE_FRONT', required: true },
        { code: 'DRIVERS_LICENSE_BACK', required: true },
      ],
      emailVerifiedAt: '2026-10-08T00:00:00.000Z',
      mobileVerifiedAt: '2026-10-08T00:00:00.000Z',
      profile: { renterVerificationDraftStep: 3 },
      verifications: [{ documents: [] }],
    };
    expect(renterOnboardingResumePage({ ...base, profile: null })).toBe(0);
    expect(renterOnboardingResumePage({ ...base, mobileVerifiedAt: null })).toBe(1);
    expect(
      renterOnboardingResumePage({
        ...base,
        profile: { renterVerificationDraftStep: 1 },
      }),
    ).toBe(2);
    expect(
      renterOnboardingResumePage({
        ...base,
        profile: { renterVerificationDraftStep: 2 },
      }),
    ).toBe(3);
    expect(renterOnboardingResumePage(base)).toBe(4);

    expect(
      renterOnboardingResumePage({
        ...base,
        profile: { renterVerificationDraftStep: 4 },
      }),
    ).toBe(5);

    const requiredDocuments = base.definitions.map(({ code }) => ({
      definition: { code },
      replacedAt: null,
    }));
    expect(
      renterOnboardingResumePage({
        ...base,
        profile: { renterVerificationDraftStep: 4 },
        verifications: [{ documents: requiredDocuments }],
      }),
    ).toBe(6);
    expect(
      renterOnboardingResumePage({
        ...base,
        profile: { renterVerificationDraftStep: 4 },
        verifications: [
          {
            documents: [
              ...requiredDocuments,
              { definition: { code: 'PROFILE_PHOTO' }, replacedAt: null },
              { definition: { code: 'SELFIE_WITH_LICENSE' }, replacedAt: null },
            ],
          },
        ],
      }),
    ).toBe(7);
  });
});
