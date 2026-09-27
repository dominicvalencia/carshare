import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const detail = source.slice(
  source.indexOf('function VehicleView'),
  source.indexOf('function QuoteCard'),
);

describe('Task 14D-1 Vehicle Detail lower content', () => {
  it('presents Owner-authored description as expandable About content', () => {
    expect(detail).toContain('title="About this car"');
    expect(detail).toContain('text={vehicle.description}');
    expect(detail).toContain('function ExpandableDetailText');
    expect(detail).toContain("expanded ? 'Show less' : 'Show more'");
    expect(detail).toContain('numberOfLines={expandable && !expanded ? 4 : undefined}');
  });

  it('renders projected features in a compact subset and complete accessible sheet', () => {
    expect(detail).toContain('const visibleFeatures = vehicle.features.slice(0, 6)');
    expect(detail).toContain('visibleFeatures.map((feature)');
    expect(detail).toContain('label={`Show all ${vehicle.features.length} features`}');
    expect(detail).toContain('title="All features"');
    expect(detail).toContain('vehicle.features.map((feature)');
  });

  it('presents only projected mileage and excess-mileage policy', () => {
    expect(detail).toContain("vehicle.mileagePolicy.type === 'UNLIMITED'");
    expect(detail).toContain('Unlimited mileage');
    expect(detail).toContain('includedKilometersPerChargeableDay');
    expect(detail).toContain('excessKilometerRateMinor');
    expect(detail).toContain('per excess whole kilometer, based on inspection readings');
  });

  it('uses EV-specific charging copy only for battery-electric vehicles', () => {
    expect(detail).toContain("vehicle.powertrain === 'BATTERY_ELECTRIC'");
    expect(detail).toContain('title="Charging on return"');
    expect(detail).toContain('vehicle.returnPolicy.evRequiredPercentage');
    expect(detail).toContain("vehicle.powertrain !== 'BATTERY_ELECTRIC'");
    expect(detail).toContain('title="Fuel on return"');
  });

  it('shows real preparation and Owner-authored rental requirements without fallback copy', () => {
    expect(detail).toContain('title="Vehicle preparation"');
    expect(detail).toContain('noticeLabel(vehicle.turnaroundMinutes)');
    expect(detail).toContain('title="Rental requirements"');
    expect(detail).toContain('text={vehicle.rentalRequirements}');
    expect(detail).not.toContain('Bring the verified identity and driving documents');
  });

  it('places the authoritative cancellation policy in Things to know without duplicating discounts', () => {
    const lower = detail.slice(detail.indexOf('title="About this car"'));
    const thingsToKnow = lower.slice(
      lower.indexOf('title="Things to know"'),
      lower.indexOf('title="Rental requirements"'),
    );
    expect(thingsToKnow).toContain('title="Cancellation policy"');
    expect(lower).not.toContain('Booking & cancellation');
    expect(lower).not.toContain('Cancellation availability and payment consequences');
    expect(lower).not.toContain('Save more on longer trips');
    expect(lower).not.toContain('durationDiscountMessage(');
  });
});
