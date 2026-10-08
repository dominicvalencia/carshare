import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { driverError } from './renter-verification-form';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe("Renter onboarding driver's license layout", () => {
  const onboarding = source('features/account/RenterOnboardingPages.tsx');
  const workflow = source('features/account/RenterVerificationWorkflow.tsx');
  const dateField = source('ui/DateOnlyField.tsx');
  const calendar = source('ui/CalendarMonth.tsx');
  const guided = source('onboarding/GuidedOnboarding.tsx');

  it('uses one page heading and a compact form surface without the legacy inner heading', () => {
    expect(onboarding).toContain("2: 'Driver’s license'");
    expect(onboarding).toContain("2: 'Add the license you’ll use when renting.'");
    expect(workflow).toContain('<Card style={styles.driverFormCard}>{driverFields}</Card>');
    expect(workflow).toContain('driverFields: { gap: spacing.xs }');
    expect(workflow).toContain('driverFormCard: {');
    expect(workflow).toContain('paddingHorizontal: spacing.md');
    expect(workflow).toContain('paddingVertical: spacing.xs');
  });

  it('uses user-facing privacy copy and explicit field labels and placeholders', () => {
    expect(workflow).toContain(
      'Your license number is stored securely and used only for verification.',
    );
    expect(workflow).not.toContain(
      'The full license number is normalized, hashed, and never returned by the API.',
    );
    expect(workflow).toContain('"Driver\'s license number *"');
    expect(workflow).toContain("'Enter license number'");
    expect(workflow).toContain('label="Expiration date *"');
    expect(dateField).toContain(": 'Select date'");
    expect(workflow).toContain('label="License classification *"');
    expect(workflow).toContain('placeholder="e.g. A, A1, B, B1"');
    expect(workflow).toContain('label="Restrictions · Optional"');
    expect(workflow).toContain('placeholder="e.g. Corrective lenses"');
  });

  it('keeps classification as free text and preserves the optional existing-license state', () => {
    const driverFields = workflow.slice(
      workflow.indexOf('const driverFields = ('),
      workflow.indexOf('const onboardingPrimaryAction'),
    );
    expect(driverFields).toContain('<Field');
    expect(driverFields).toContain("'Replace license number · Optional'");
    expect(driverFields).toContain('`Current ends in ${profile.driverLicenseLastFour}`');
    expect(driverFields).toContain('License number on file');
    expect(driverFields).toContain('Ending in {profile.driverLicenseLastFour}');
    expect(driverFields).not.toContain('driverLicenseNumberHash');
    expect(driverFields).toContain('minimumDate={tomorrow()}');
  });

  it('uses the shared adaptive calendar sheet with temporary selection controls', () => {
    expect(dateField).toContain('<CalendarMonth');
    expect(dateField).not.toContain('display="spinner"');
    expect(dateField).toContain('<BackControl label="Back" onPress={() => setOpen(false)} />');
    expect(dateField).not.toContain('label="Cancel"');
    expect(dateField).toContain('const nextDraft = dateWithinBounds(parseDate(value)');
    expect(dateField).toContain('setDraft(nextDraft)');
    expect(dateField).toContain('onSelect={(selected) => setDraft(normalizeDateOnly(selected))}');
    expect(dateField).toContain('label="Use this date"');
    expect(dateField).toContain('function YearPicker');
    expect(dateField).toContain('label="Earlier years"');
    expect(dateField).toContain('label="Later years"');
    expect(dateField).toContain('onTitlePress={() =>');
    expect(dateField).toContain('adaptiveSheetLayout({');
    expect(dateField).toContain('scrollEnabled={measuredLayout.scrollEnabled}');
    expect(calendar).toContain('accessibilityLabel="Previous month"');
    expect(calendar).toContain('accessibilityLabel="Next month"');
    expect(calendar).toContain('accessibilityState={{ disabled, selected: isSelected }}');
  });

  it('uses literal-entry keyboard behavior and field-specific validation presentation', () => {
    expect(workflow).toContain('autoCapitalize="characters"');
    expect(workflow).toContain('autoCorrect={false}');
    expect(workflow).toContain('spellCheck={false}');
    expect(workflow).toContain('error={driverLicenseError}');
    expect(workflow).toContain('{...(driverExpiryError ? { error: driverExpiryError } : {})}');
    expect(workflow).toContain('error={driverClassError}');
  });

  it('preserves validation and the driver-information save payload', () => {
    expect(
      driverError(
        {
          driverLicenseClass: 'B',
          driverLicenseExpiry: '2999-12-31',
          driverLicenseNumber: 'N01-23-456789',
        },
        false,
      ),
    ).toBe('');
    expect(
      driverError(
        { driverLicenseClass: 'B', driverLicenseExpiry: '', driverLicenseNumber: '' },
        false,
      ),
    ).toBeTruthy();
    expect(workflow).toContain('driverLicenseClass: form.driverLicenseClass.trim()');
    expect(workflow).toContain('driverLicenseExpiry: form.driverLicenseExpiry');
    expect(workflow).toContain('driverLicenseNumber: form.driverLicenseNumber.trim()');
    expect(workflow).toContain('driverLicenseRestrictions: form.driverLicenseRestrictions.trim()');
    expect(workflow).toContain("stage: 'DRIVER_INFORMATION'");
  });

  it('keeps Back and Continue in the shared sticky footer and preserves skip', () => {
    expect(workflow).toContain('<RenterOnboardingFooter');
    expect(workflow).toContain('if (step === 2) return advanceDriver()');
    expect(workflow).toContain('primaryLabel={onboardingPrimaryLabel}');
    expect(guided).toContain('<Button label="Skip onboarding" onPress={onSkip} variant="ghost" />');
  });
});
