import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const navigationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../navigation/AppNavigation.tsx'),
  'utf8',
);

describe('Task 14B vehicle-detail top', () => {
  const detail = source.slice(
    source.indexOf('function VehicleView('),
    source.indexOf('function QuoteCard('),
  );

  it('uses one bounded paged FlatList for each gallery surface and viewport-derived sizing', () => {
    expect(detail.match(/<FlatList\n/g)).toHaveLength(2);
    expect(detail).not.toContain('<ScrollView horizontal');
    expect(detail).toContain(
      'const heroHeight = Math.round(Math.min(viewportWidth / (4 / 3), 480))',
    );
    expect(detail).toContain('style={[styles.detailGalleryShell, { height: heroHeight }]}');
    expect(detail).toContain('pagingEnabled');
  });

  it('keeps hero and full-screen selection synchronized with truthful counters', () => {
    expect(detail).toContain('selectedGalleryIndex.current = index');
    expect(detail).toContain('heroGalleryRef.current?.scrollToIndex');
    expect(detail).toContain('fullGalleryRef.current?.scrollToIndex');
    expect(detail).toContain('{galleryIndex + 1} / {galleryPhotos.length}');
    expect(detail).toContain(
      'accessibilityLabel={`Vehicle photo ${index + 1} of ${galleryPhotos.length}`}',
    );
  });

  it('places accessible Back and Wishlist controls over the hero media', () => {
    expect(detail).toContain('accessibilityLabel="Back"');
    expect(detail).toContain('styles.detailGalleryBack');
    expect(detail).toContain("vehicle.favorite ? 'Remove from Wishlist' : 'Save to Wishlist'");
    expect(detail).toContain('accessibilityState={{ selected: vehicle.favorite }}');
    expect(detail).toContain('top: topSafeArea + spacing.sm');
  });

  it('presents the requested information hierarchy and preserves review navigation', () => {
    expect(detail).toContain(
      'const vehicleTitle = [vehicle.make, vehicle.model, vehicle.variant, vehicle.year]',
    );
    expect(detail).toContain('style={styles.detailTitle}');
    expect(detail).toContain("navigation.navigate('PublicReviews'");
    expect(detail).toContain("label: 'Category'");
    expect(detail).toContain("label: 'Seats'");
    expect(detail).toContain("label: 'Doors'");
    expect(detail).toContain("label: 'Transmission'");
    expect(detail).toContain("label: 'Powertrain'");
    expect(detail.indexOf('style={styles.detailTitle}')).toBeLessThan(
      detail.indexOf('<SectionHeader title="Your trip" />'),
    );
  });

  it('restores the correct origin without collapsing Explore into Results', () => {
    expect(source).toContain("initialMode === 'favorites' ? 'favorites' : 'form'");
    expect(source).toContain(
      "mode === 'favorites' ? 'favorites' : mode === 'results' ? 'results' : 'form'",
    );
    expect(source).toContain('setMode(detailOrigin.current)');
    expect(navigationSource).toContain('initialVehicleId={route.params.vehicleId}');
    expect(navigationSource).toContain('onExit={() => closeToMarketplace(navigation)}');
  });

  it('retains the existing server-backed Wishlist and view-history authorities', () => {
    expect(source).toContain('apiClient.request(`/favorites/${id}`');
    expect(source).toContain("'/me/discovery-history/vehicles'");
  });
});
