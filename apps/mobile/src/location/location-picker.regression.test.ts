import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const picker = readFileSync(resolve(process.cwd(), 'src/location/LocationPicker.tsx'), 'utf8');
const booking = readFileSync(
  resolve(process.cwd(), 'src/features/discovery/DiscoveryScreen.tsx'),
  'utf8',
);
const vehicles = readFileSync(
  resolve(process.cwd(), 'src/features/vehicles/VehiclesScreen.tsx'),
  'utf8',
);

describe('contractual location picker', () => {
  it('provides search, map, pin, current location and explicit accessible confirmation', () => {
    for (const value of [
      'Search address or place',
      'PROVIDER_GOOGLE',
      'Use my current location',
      'Confirm ${kind} location',
      'Selected address',
    ])
      expect(picker).toContain(value);
    expect(picker).toContain('request.current');
    expect(picker).toContain('requestForegroundPermissionsAsync');
  });
  it('removes renter coordinate entry and preserves provider-neutral confirmed locations', () => {
    expect(booking).not.toContain('label="Latitude"');
    expect(booking).not.toContain('label="Longitude"');
    expect(booking).toContain('ConfirmedLocationCard');
    expect(booking).toContain('Same as delivery location');
    expect(booking).toContain('properties.quote.reset()');
  });
  it('keeps point exploration pending until explicit confirmation', () => {
    expect(picker).toContain('onConfirm(pending)');
    expect(picker).toContain('onRegionChangeComplete');
    expect(booking).toContain('setDraftDeliveryLocation(location)');
    expect(booking).toContain('setDraftCollectionLocation(location)');
    expect(booking).toContain('setDeliveryLocation(draftDeliveryLocation)');
    expect(booking).toContain('setCollectionLocation(draftCollectionLocation)');
  });
  it('reuses the same picker for the owner private vehicle location without raw coordinates', () => {
    expect(vehicles).toContain('<LocationPicker');
    expect(vehicles).toContain('kind="pickup"');
    expect(vehicles).toContain('title="Private pickup location"');
    expect(vehicles).toContain('Selected pickup location');
    expect(vehicles).toContain('Change location');
    expect(vehicles).toContain('presentation="vehicleSetup"');
    expect(vehicles).toContain(
      "endpointBase.match(/^\\/owner\\/workspaces\\/([^/]+)\\/vehicles\\//)?.[1]",
    );
    expect(vehicles).toContain('ownerProfileId={ownerProfileId}');
    expect(picker).toContain(
      'provider.reverseGeocode(next.latitude, next.longitude, ownerProfileId)',
    );
    expect(vehicles).toContain('dismissLabel="Back"');
    expect(vehicles).toContain('initial={location}');
    expect(vehicles).toContain('onCancel={() => setPickerOpen(false)}');
    expect(vehicles).toContain('setLocation(value)');
    expect(vehicles).toContain('<WizardSaveFooter disabled={!location}');
    expect(vehicles).not.toContain('label="Latitude"');
    expect(vehicles).not.toContain('label="Longitude"');
    expect(vehicles).not.toContain('Use this device at the pickup point');
  });
  it('keeps the vehicle setup picker compact without changing shared picker behavior', () => {
    expect(picker).toContain("presentation?: 'default' | 'vehicleSetup'");
    expect(picker).toContain("presentation === 'vehicleSetup'");
    expect(picker).toContain('accessibilityLiveRegion="polite"');
    expect(picker).toContain('Finding location…');
    expect(picker).toContain('locationDisplayLabel(pending)');
    expect(picker).toContain('useSafeAreaInsets()');
    expect(picker).toContain('paddingTop: Math.max(safeArea.top, spacing.xxl) + spacing.sm');
    expect(picker).toContain('paddingBottom: Math.max(safeArea.bottom, spacing.sm) + spacing.sm');
    expect(picker).toContain('vehicleSetup && styles.vehicleSetupTitle');
    expect(picker).toContain('compact={vehicleSetup}');
    expect(picker).toContain("icon={vehicleSetup ? 'navigate-outline' : undefined}");
    expect(picker).toContain('vehicleSetup && styles.vehicleSetupConfirm');
  });
  it('keeps general discovery and booking details map-free', () => {
    expect(booking).toContain('function LocationSheet');
    expect(booking).toContain('Pickup area:');
    expect(vehicles.match(/<LocationPicker/g)).toHaveLength(1);
  });
});
