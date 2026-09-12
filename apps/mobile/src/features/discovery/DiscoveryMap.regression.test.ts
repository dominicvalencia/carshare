import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mapSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryMap.tsx'),
  'utf8',
);
const screenSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);

describe('map discovery regression', () => {
  it('uses only privacy-safe map fields and keeps price pins accessible', () => {
    expect(mapSource).toContain('mapPosition.mapLatitude');
    expect(mapSource).toContain('mapPosition.mapLongitude');
    expect(mapSource).not.toContain('location.latitude');
    expect(mapSource).not.toContain('location.longitude');
    expect(mapSource).toContain('per day`');
    expect(mapSource).toContain('accessibilityState={{ selected: active }}');
  });

  it('clusters privacy-safe positions and expands clusters without a dependency', () => {
    expect(mapSource).toContain('clusterMapItems(mapItems)');
    expect(mapSource).toContain('vehicles in this area');
    expect(mapSource).toContain('animateToRegion');
  });

  it('queries only after Search this area and distinguishes user movement', () => {
    expect(mapSource).toContain('onPanDrag');
    expect(mapSource).toContain('setAreaPending(true)');
    expect(mapSource).toContain("label={loading ? 'Searching…' : 'Search this area'}");
    expect(mapSource).not.toContain('onRegionChange=');
  });

  it('keeps List as default and one shared filter/date/search state', () => {
    expect(screenSource).toContain("useState<'list' | 'map'>('list')");
    expect(screenSource).toContain("query.set('handover', handover)");
    expect(screenSource).toContain("mode: presentationMode === 'map' ? 'MAP' : 'LIST'");
    expect(screenSource).toContain('setActivePlace(place)');
  });

  it('preserves a complete List fallback, map errors, empty state, and privacy copy', () => {
    expect(screenSource).toContain('<FlatList');
    expect(mapSource).toContain('No cars found in this area');
    expect(mapSource).toContain('The map position is preserved. Try this search again.');
    expect(mapSource).toContain('Vehicle locations are approximate to protect owner privacy.');
  });
});
