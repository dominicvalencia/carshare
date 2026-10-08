import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';
import { addressError } from './renter-verification-form';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(
  resolve(root, 'features/account/RenterVerificationWorkflow.tsx'),
  'utf8',
);
const onboarding = readFileSync(
  resolve(root, 'features/account/RenterOnboardingPages.tsx'),
  'utf8',
);
const guided = readFileSync(resolve(root, 'onboarding/GuidedOnboarding.tsx'), 'utf8');

describe('Renter onboarding residential address layout', () => {
  it('uses one page heading and a compact form surface without the legacy inner heading', () => {
    expect(onboarding).toContain("1: 'Enter the address shown on your proof of address.'");
    expect(workflow).toContain('<Card style={styles.addressFormCard}>{addressFields}</Card>');
    expect(workflow).toContain('paddingHorizontal: spacing.md');
    expect(workflow).toContain('paddingVertical: spacing.sm');
    expect(workflow).toContain('addressFields: { gap: spacing.sm }');
  });

  it('keeps the street field semantic and multiline for complete address details', () => {
    const addressFields = workflow.slice(
      workflow.indexOf('const addressFields = ('),
      workflow.indexOf('const onboardingPrimaryAction'),
    );
    expect(addressFields).toContain('label="House / building / street *"');
    expect(addressFields).toContain('placeholder="e.g. 123 Rizal St., ABC Residences"');
    expect(addressFields).toContain('value={form.addressLine1}');
    expect(addressFields).toContain('multiline');
  });

  it('preserves dependent selectors with explicit enabled and disabled placeholders', () => {
    expect(workflow).toContain('placeholder="Select region"');
    expect(workflow).toContain('disabled={!form.regionCode}');
    expect(workflow).toContain('disabledPlaceholder="Select region first"');
    expect(workflow).toContain('disabled={!form.addressScopeCode}');
    expect(workflow).toContain('disabledPlaceholder="Select province first"');
    expect(workflow).toContain('disabled={!form.cityMunicipalityCode}');
    expect(workflow).toContain('disabledPlaceholder="Select city first"');
    expect(workflow).toContain('placeholder="Select barangay"');
    expect(workflow).toContain('accessibilityState={{ disabled }}');
  });

  it('uses one adaptive searchable sheet pattern with user-facing titles and top Back', () => {
    expect(workflow).not.toContain('eyebrow="Searchable selector"');
    expect(workflow).toContain('sheetTitle="Select region"');
    expect(workflow).toContain('sheetTitle="Select province"');
    expect(workflow).toContain('sheetTitle="Select city or municipality"');
    expect(workflow).toContain('sheetTitle="Select barangay"');
    expect(workflow).toContain('<BackControl onPress={close} />');
    expect(workflow).not.toContain('<Button label="Cancel"');
    expect(workflow).toContain('adaptiveSheetLayout({');
    expect(workflow).toContain('scrollEnabled={measuredLayout.scrollEnabled}');

    expect(
      adaptiveSheetLayout({
        contentHeight: 120,
        headerHeight: 150,
        maxSafeViewportHeight: 760,
        safeAreaAllowance: 34,
      }),
    ).toEqual({ height: 304, intrinsicHeight: 304, scrollEnabled: false });
    expect(
      adaptiveSheetLayout({
        contentHeight: 1_200,
        headerHeight: 150,
        maxSafeViewportHeight: 760,
        safeAreaAllowance: 34,
      }),
    ).toEqual({ height: 760, intrinsicHeight: 1_384, scrollEnabled: true });
  });

  it('keeps filtering, empty results, wrapping, and selected-state semantics accessible', () => {
    expect(workflow).toContain('name.toLowerCase().includes(query.trim().toLowerCase())');
    expect(workflow).toContain('searchPlaceholder="Search regions"');
    expect(workflow).toContain('emptyTitle="No matching regions found."');
    expect(workflow).toContain('emptyTitle="No matching barangays found."');
    expect(workflow).toContain('accessibilityRole="radio"');
    expect(workflow).toContain('accessibilityState={{ checked: selected }}');
    expect(workflow).toContain('name="checkmark-circle"');
    expect(workflow).toContain('lineHeight: 20');
    expect(workflow).not.toContain('name="chevron-forward"');
  });

  it('keeps postal validation and the address save payload unchanged', () => {
    expect(workflow).toContain('placeholder="e.g. 4301"');
    expect(workflow).toContain('keyboardType="number-pad"');
    expect(workflow).toContain('addressLine1: form.addressLine1.trim()');
    expect(workflow).toContain('addressScopeCode: form.addressScopeCode');
    expect(workflow).toContain('barangayCode: form.barangayCode');
    expect(workflow).toContain('cityMunicipalityCode: form.cityMunicipalityCode');
    expect(workflow).toContain('postalCode: form.postalCode');
    expect(workflow).toContain('regionCode: form.regionCode');
    expect(workflow).toContain("stage: 'RESIDENTIAL_ADDRESS'");
    expect(
      addressError({
        addressLine1: '123 Rizal St.',
        addressScopeCode: 'scope',
        barangayCode: 'barangay',
        cityMunicipalityCode: 'city',
        postalCode: '430',
        regionCode: 'region',
      }),
    ).toBe('Enter a four-digit postal code.');
  });

  it('keeps the shared Back and Continue footer and onboarding skip behavior', () => {
    expect(workflow).toContain('<RenterOnboardingFooter');
    expect(workflow).toContain('primaryLabel={onboardingPrimaryLabel}');
    expect(workflow).toContain('{...(step === 0 ? {} : { onBack: () => back(step - 1) })}');
    expect(guided).toContain('<Button label="Skip onboarding" onPress={onSkip} variant="ghost" />');
  });
});
