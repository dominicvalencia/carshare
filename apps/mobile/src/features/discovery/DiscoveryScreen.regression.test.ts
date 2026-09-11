import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);

describe('vehicle-detail responsive regression', () => {
  it('sizes the hero gallery from the viewport instead of a device-specific width', () => {
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('{ width: viewportWidth }');
    expect(source).not.toMatch(/heroImage:\s*\{[^}]*width:\s*390/);
  });

  it('scrolls once only after successful quote data renders', () => {
    expect(source).toContain("properties.mode === 'quote' && quoteData");
    expect(source).toContain('lastScrolledQuoteId.current === quoteData.id');
    expect(source).toContain('scrollRef.current?.scrollTo');
  });

  it('uses server cursors for incremental loading and preserves the result offset', () => {
    expect(source).toContain('useInfiniteQuery');
    expect(source).toContain('getNextPageParam');
    expect(source).toContain('onEndReachedThreshold={0.25}');
    expect(source).toContain('search.fetchNextPage()');
    expect(source).toContain('resultScrollOffset.current');
  });

  it('renders only projected positive long-trip discounts before price check', () => {
    expect(source).toContain('positiveDurationDiscounts(vehicle.pricing.durationDiscounts)');
    expect(source).toContain('durationDiscounts.length > 0');
    expect(source).toContain('Save more on longer trips');
    expect(source).toContain('Discount is applied automatically when your rental dates qualify.');
    expect(source.indexOf('Save more on longer trips')).toBeLessThan(
      source.indexOf('<SectionHeader title="Your trip" />'),
    );
    expect(source).not.toContain('policyVersionId');
  });
});

describe('fulfillment discovery presentation', () => {
  it('keeps server-owned handover filtering and contextual badges', () => {
    expect(source).toContain("query.set('handover', handover)");
    expect(source).toContain('Pickup & delivery available');
    expect(source).toContain('Delivery to your location');
    expect(source).not.toContain('Self-drive');
    expect(source).toContain(
      "vehicle.fulfillment.deliveryToSearchLocationReason === 'INSUFFICIENT_NOTICE'",
    );
    expect(source).toContain('Delivery requires');
    expect(source).not.toContain(
      "vehicle.fulfillment.deliveryToSearchLocationReason === 'OUTSIDE_SERVICE_RADIUS'",
    );
  });

  it('presents safe handover policy detail without booking selection or point fabrication', () => {
    expect(source).toContain('title="Handover options"');
    expect(source).toContain(
      'Actual booking total and handover eligibility are confirmed during booking.',
    );
    expect(source).toContain('approximately ${Math.round');
    expect(source).toContain('Delivery & collection notice');
    expect(source).toContain('This notice period only applies to owner delivery or collection.');
    expect(source).toContain("'No minimum notice.'");
    expect(source).not.toContain('Owner Payable Liability');
  });
});
