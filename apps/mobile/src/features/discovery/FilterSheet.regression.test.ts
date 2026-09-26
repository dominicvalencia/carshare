import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const priceSlider = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'PriceRangeSlider.tsx'),
  'utf8',
);
const minimumSeatsSlider = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'MinimumSeatsSlider.tsx'),
  'utf8',
);

const sheet = source.slice(
  source.indexOf('type FilterProperties'),
  source.indexOf('function activeFilterCount'),
);

describe('Results Filters sheet', () => {
  it('edits a cloned draft and applies one committed payload', () => {
    expect(sheet).toContain('cloneDiscoveryFilters(properties.committed)');
    expect(sheet).toContain('setDraft((current) => ({ ...current, [key]: value }))');
    expect(sheet).toContain('properties.onApply(draft)');
    expect(sheet).not.toContain('setMake');
    expect(sheet).not.toContain('setCategoryId');
  });

  it('discards Close and swipe-dismiss edits while Clear all only resets draft', () => {
    expect(sheet).toContain('onRequestClose={close}');
    expect(sheet).toContain('accessibilityLabel="Close filters"');
    expect(sheet).toContain('setDraft(cloneDiscoveryFilters(properties.committed))');
    expect(sheet).toContain('setDraft(cloneDiscoveryFilters(DEFAULT_DISCOVERY_FILTERS))');
    expect(sheet).toContain('label="Clear all"');
  });

  it('uses a fixed shell with independent scrolling and fixed actions', () => {
    expect(sheet).toContain('style={styles.filterHeader}');
    expect(sheet).toContain('<ScrollView');
    expect(sheet).toContain('styles.filterActions,');
    expect(sheet).toContain("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}");
    expect(sheet).toContain('label="Show cars"');
    expect(sheet).not.toContain('Show N cars');
  });

  it('keeps both fixed actions fully above an open keyboard', () => {
    expect(sheet).toContain("Keyboard.addListener('keyboardDidShow'");
    expect(sheet).toContain("Keyboard.addListener('keyboardDidHide'");
    expect(sheet).toContain('(keyboardVisible ? spacing.md : 0)');
    expect(sheet).toContain('label="Clear all"');
    expect(sheet).toContain('label="Show cars"');
  });

  it('renders only the supported initial filter sections and enum values', () => {
    for (const title of [
      'Search area',
      'Vehicle type',
      'Make',
      'Powertrain',
      'Price per day',
      'Minimum seats',
      'Transmission',
      'Handover options',
    ]) {
      expect(sheet).toContain(`title="${title}"`);
    }
    expect(sheet).toContain("'PLUG_IN_HYBRID'");
    expect(sheet).toContain("'DCT'");
    expect(sheet).toContain("'OTHER'");
    expect(sheet).toContain("['PICKUP_AVAILABLE', 'Pick up the car']");
    expect(sheet).toContain("['DELIVERY_AVAILABLE', 'Owner delivery']");
    expect(sheet).toContain("['RENTER_RETURN_AVAILABLE', 'Return it yourself']");
    expect(sheet).toContain("['OWNER_COLLECTION_AVAILABLE', 'Owner collection']");
    expect(sheet).toContain("updateDraft('returnHandover', value!)");
    expect(sheet).not.toContain('Fuel type');
    expect(sheet).not.toContain('Unlimited mileage');
  });

  it('uses truthful sliders for minimum seats and authoritative price bounds', () => {
    expect(minimumSeatsSlider).toContain('Show cars with at least this many seats');
    expect(sheet).not.toContain('label="Minimum"');
    expect(sheet).not.toContain('label="Maximum"');
    expect(sheet).toContain('<MinimumSeatsSlider');
    expect(sheet).toContain('value={draft.seats}');
    expect(minimumSeatsSlider).toContain('const maximumSeats = 20');
    expect(minimumSeatsSlider).toContain("displayedSeats === 0 ? 'Any'");
    expect(minimumSeatsSlider).toContain('<GestureDetector gesture={gesture}>');
    expect(minimumSeatsSlider).toContain('runOnJS(updateDisplayedSeats)(progress.value)');
    expect(minimumSeatsSlider).toContain("onChange(seats === 0 ? '' : String(seats))");
    expect(sheet).toContain('const error = priceRangeError(draft)');
    expect(sheet).toContain('Prices in Philippine pesos (PHP)');
    expect(sheet).toContain('<PriceRangeSlider');
    expect(priceSlider).toContain('accessibilityRole="adjustable"');
    expect(priceSlider.match(/<GestureDetector/g)).toHaveLength(2);
    expect(priceSlider).toContain('translationX / trackWidth');
    expect(priceSlider.match(/runOnJS\(updateDisplayedPrices\)/g)).toHaveLength(2);
    expect(priceSlider).toContain('accessibilityLabel="Minimum daily price"');
    expect(priceSlider).toContain('accessibilityLabel="Maximum daily price"');
    expect(priceSlider).toContain("onChangeText={(text) => updateFromInput('minimum', text)}");
    expect(priceSlider).toContain("onChangeText={(text) => updateFromInput('maximum', text)}");
    expect(priceSlider).toContain('minimumProgress.value = (nextMinimum - lower) / span');
    expect(priceSlider).toContain('maximumProgress.value = (nextMaximum - lower) / span');
    expect(priceSlider).toContain('height: 44');
    expect(priceSlider).toContain("textAlign: 'center'");
    expect(sheet).toContain("properties.priceRange?.currency === 'PHP'");
  });

  it('places minimum seats after transmission and before handover options', () => {
    expect(sheet.indexOf('title="Minimum seats"')).toBeGreaterThan(
      sheet.indexOf('title="Transmission"'),
    );
    expect(sheet.indexOf('title="Minimum seats"')).toBeLessThan(
      sheet.indexOf('title="Handover options"'),
    );
  });
});
