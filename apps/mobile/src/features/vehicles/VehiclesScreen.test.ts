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
    expect(source).toContain('disabled={disabled || mutation.isPending}');
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

  it('shows clean photo cards, attached document preview, shared private location picker, and owner blocks', () => {
    expect(source).toContain("photo.isCover ? 'Cover' : 'Vehicle photo'");
    expect(source).not.toContain('Position ${photo.displayOrder + 1}');
    expect(source).not.toContain('label="←"');
    expect(source).toContain('label="Set cover"');
    expect(source).toContain('label="Remove"');
    expect(source).toContain('variant="danger"');
    expect(source).toContain('documentPreview');
    expect(source).toContain('<LocationPicker');
    expect(source).toContain('Your exact location is kept private from public browsing');
    expect(source).toContain('kind="pickup"');
    expect(source).not.toContain('Use this device at the pickup point');
    expect(source).toContain("['vehicle-blocks', id]");
    expect(source).toContain('Remove unavailable period?');
    expect(source).toContain("text: 'Remove block'");
    expect(source).toContain('Past period · read-only');
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
    expect(source).toContain('<DetailSection title="Private pickup location">');
    expect(source).toContain('ownerPrivateLocationLabel(value.location)');
    expect(source).toContain('<Button label="Change location" onPress={() => onEdit(4)}');
  });

  it('keeps availability in vehicle detail and live-refreshes transitional review states', () => {
    const stepList = source.slice(source.indexOf('const steps = ['), source.indexOf('] as const;'));
    expect(stepList).not.toContain("'Availability'");
    expect(source).toContain('transitionalVehicleStatuses');
    expect(source).toContain('refetchInterval: (query)');
    expect(source).toContain('refetchOnWindowFocus: true');
    expect(source).toContain('Owner-blocked today');
    expect(source).toContain('Booked today');
    expect(source).toContain("timeZone: 'Asia/Manila'");
    expect(source).toContain("queryKey: ['owner-vehicle-dashboard-summary']");
  });

  it('lets owners configure fulfillment through the immutable policy-version flow', () => {
    expect(source).toContain('label="Edit handover options"');
    expect(source).toContain('label="Renter pickup"');
    expect(source).toContain('label="I can deliver the car"');
    expect(source).toContain('label="Renter returns the car"');
    expect(source).toContain('label="I can collect the car"');
    expect(source).toContain('/policy-versions');
    expect(source).toContain('fulfillmentServiceRadiusMeters: radiusMeters');
    expect(source).toContain('fulfillmentMinimumNoticeMinutes: ownerService ? minimumNotice : 0');
  });

  it('uses safe defaults, conditional service controls, and friendly validation', () => {
    expect(source).toContain('current?.supportsRenterPickup ?? true');
    expect(source).toContain('current?.supportsOwnerDelivery ?? false');
    expect(source).toContain('current?.supportsRenterReturn ?? true');
    expect(source).toContain('current?.supportsOwnerCollection ?? false');
    expect(source).toContain('Choose at least one way for renters to receive the car.');
    expect(source).toContain('Choose at least one way for the car to be returned.');
    expect(source).toContain('{ownerService && (');
    expect(source).toContain('[5, 10, 15, 25, 50]');
    expect(source).toContain("[10080, '7 days']");
    expect(source).toContain('Delivery & collection notice');
    expect(source).toContain(
      'This only applies when you deliver or collect the vehicle. Renter pickup and return are',
    );
  });

  it('keeps every long-booking field with its existing description before handover', () => {
    const description = source.indexOf('Enter a percentage from 0 to 40.');
    const shortTier = source.indexOf('label="3+ days (%)"');
    const weeklyTier = source.indexOf('label="7+ days (%)"');
    const extendedTier = source.indexOf('label="14+ days (%)"');
    const monthlyTier = source.indexOf('label="30+ days (%)"');
    const handover = source.indexOf('<Text style={styles.label}>Handover options</Text>');

    expect(description).toBeGreaterThan(-1);
    expect(description).toBeLessThan(shortTier);
    expect(shortTier).toBeLessThan(weeklyTier);
    expect(weeklyTier).toBeLessThan(extendedTier);
    expect(extendedTier).toBeLessThan(monthlyTier);
    expect(monthlyTier).toBeLessThan(handover);
    expect(source.match(/Long-booking discounts \(optional\)/g)).toHaveLength(1);
  });

  it('explains authoritative per-day mileage and whole-kilometer excess fees conditionally', () => {
    expect(source).toContain('label="Included mileage per rental day (km)"');
    expect(source).toContain(
      'How many kilometers are included per rental day before excess mileage charges apply.',
    );
    expect(source).toContain('label="Excess mileage fee (PHP per whole km)"');
    expect(source).toContain(
      'Amount charged for each whole kilometer driven beyond the included mileage allowance.',
    );
    expect(source.indexOf('label="Included mileage per rental day (km)"')).toBeLessThan(
      source.indexOf('label="Excess mileage fee (PHP per whole km)"'),
    );
    expect(source).toContain('{limited && (');
    expect(source).toContain('current?.includedKilometersPerDay ?? 150');
    expect(source).toContain('current?.excessKilometerRateMinor ?? 1500');
  });

  it('preserves unrelated latest policy values and explains marketplace lifecycle', () => {
    expect(source).toContain('minimumRentalDays: current?.minimumRentalDays ?? 1');
    expect(source).toContain('availabilityPolicy: current?.availabilityPolicy ??');
    expect(source).toContain('fuelReturnPolicy: current?.fuelReturnPolicy ??');
    expect(source).toContain('title="Marketplace status"');
    expect(source).toContain('CarShare Operations must approve this vehicle');
    expect(source).toContain('apiClient.request(`/owner/vehicles/${id}/operational-status`');
    expect(source).toContain("? 'Mark temporarily unavailable'");
    expect(source).toContain(": 'Mark available'");
    expect(source).not.toContain('Available for search');
  });
});
