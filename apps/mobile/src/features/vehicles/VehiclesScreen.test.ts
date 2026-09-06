import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'VehiclesScreen.tsx'),
  'utf8',
);

describe('Phase 12 owner vehicle acceptance UX', () => {
  it('uses dependent reference selectors with a safe custom-model escape hatch', () => {
    expect(source).toContain("['vehicle-models', selectedMake?.id]");
    expect(source).toContain('Other / Model not listed');
    expect(source).toContain('label="Vehicle type"');
    expect(source).toContain('label="Powertrain"');
  });

  it('saves before continuing and protects against duplicate taps', () => {
    expect(source).toContain('label="Save and continue"');
    expect(source).toContain('disabled={mutation.isPending}');
    expect(source).toContain('lastCompletedSection');
  });

  it('is keyboard-aware on Android and requests the rear camera for vehicle evidence', () => {
    expect(source).toContain('KeyboardAvoidingView');
    expect(source).toContain('useKeyboardAwareBottomPadding(spacing.xl)');
    expect(source).toContain('{ paddingBottom: keyboardAwareBottomPadding }');
    expect(source).not.toContain("Platform.OS === 'android' ? 'height' : undefined");
    expect(source).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}");
    expect(
      source.match(/cameraType: ImagePicker\.CameraType\.back/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('shows clean photo cards, attached document preview, PSGC hierarchy, and owner blocks', () => {
    expect(source).toContain("photo.isCover ? 'Cover' : 'Vehicle photo'");
    expect(source).not.toContain('Position ${photo.displayOrder + 1}');
    expect(source).not.toContain('label="←"');
    expect(source).toContain('label="Set cover"');
    expect(source).toContain('label="Remove"');
    expect(source).toContain('variant="danger"');
    expect(source).toContain('documentPreview');
    expect(source).toContain("['geography', 'regions']");
    expect(source).toContain("['geography', 'barangays'");
    expect(source).toContain("['vehicle-blocks', id]");
    expect(source).toContain('Remove future block');
  });

  it('makes photo wizard navigation explicit, validated, and duplicate-safe', () => {
    expect(source).toContain('setSelectedStep(Math.max(0, step - 1))');
    expect(source).toContain('if (continueDraft.isPending) return;');
    expect(source).toContain('step === 2 && value.photos.length < 5');
    expect(source).toContain('more required vehicle photo');
    expect(source).toContain('onPress={continueEditor}');
  });

  it('opens a read-only fleet detail before edit mode', () => {
    expect(source).toContain('function VehicleDetail');
    expect(source).toContain('Edit vehicle');
    expect(source).toContain('Registration / verification');
    expect(source).toContain('Pricing & usage');
    expect(source).toContain('label="Manage availability"');
  });

  it('keeps availability in vehicle detail and live-refreshes transitional review states', () => {
    const stepList = source.slice(source.indexOf('const steps = ['), source.indexOf('] as const;'));
    expect(stepList).not.toContain("'Availability'");
    expect(source).toContain('transitionalVehicleStatuses');
    expect(source).toContain('refetchInterval: (query)');
    expect(source).toContain('refetchOnWindowFocus: true');
  });
});
