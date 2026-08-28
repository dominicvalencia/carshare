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
});
