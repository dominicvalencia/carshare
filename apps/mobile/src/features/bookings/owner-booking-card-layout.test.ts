import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerBookingRequestsScreen.tsx'),
  'utf8',
);

describe('owner booking card responsive metadata', () => {
  it('lets long statuses shrink or wrap while preserving the complete price', () => {
    expect(source).toContain('<View style={styles.statusSlot}>');
    expect(source).toContain("flexWrap: 'wrap'");
    expect(source).toContain('gap: spacing.xs');
    expect(source).toContain('statusSlot: { flexShrink: 1 }');
    expect(source).toContain('flexShrink: 0');
    expect(source).toContain("marginLeft: 'auto'");
    expect(source).toContain('{money(booking.pricing.totalMinor, booking.pricing.currency)}');
  });

  it('retains the standard card inset and booking-card interaction', () => {
    expect(source).toContain('<Card style={styles.requestCard}>');
    expect(source).toContain(
      'onPress={() => (onOpenBookingRequest ?? setSelected)(booking.publicReference)}',
    );
    expect(source).toContain("requestCard: { flexDirection: 'row', gap: spacing.sm }");
    expect(source).not.toContain(
      "requestCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm }",
    );
  });
});
