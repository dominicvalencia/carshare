import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bookingHoldRevealOffset } from './booking-hold-scroll';

const here = dirname(fileURLToPath(import.meta.url));
const discoverySource = readFileSync(resolve(here, './DiscoveryScreen.tsx'), 'utf8');

describe('booking hold post-state reveal', () => {
  it('scrolls only enough to reveal a newly inserted hold block', () => {
    expect(
      bookingHoldRevealOffset({
        currentOffset: 500,
        edgePadding: 16,
        obscuredTop: 80,
        sectionHeight: 220,
        sectionTop: 1_150,
        viewportHeight: 700,
      }),
    ).toBe(686);
  });

  it('does not move when the block is already comfortably visible', () => {
    expect(
      bookingHoldRevealOffset({
        currentOffset: 500,
        edgePadding: 16,
        obscuredTop: 80,
        sectionHeight: 180,
        sectionTop: 650,
        viewportHeight: 700,
      }),
    ).toBeNull();
  });

  it('uses the measured target and viewport without fixed scroll offsets', () => {
    expect(discoverySource).toContain('onHoldLayout={revealBookingHold}');
    expect(discoverySource).toContain('onScrollLayout={(event) => {');
    expect(discoverySource).toContain('event.nativeEvent.layout.height');
    expect(discoverySource).toContain('event.nativeEvent.layout.y');
    expect(discoverySource).not.toMatch(/setTimeout\([^)]*scrollTo|scrollToEnd\(/s);
  });

  it('runs only for a successful mounted hold and only once per booking reference', () => {
    expect(discoverySource).toContain('{reserve.data && (');
    expect(discoverySource).toContain('lastRevealedBookingReference.current === reference');
    expect(discoverySource).toContain('lastRevealedBookingReference.current = reference');
    expect(discoverySource).toContain('onLayout={(event) =>');
  });
});
