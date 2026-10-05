import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, './DiscoveryScreen.tsx'), 'utf8');
const card = source.slice(
  source.indexOf('function SearchResultVehicleCard('),
  source.indexOf('function ExploreVehicleSection('),
);
const badge = source.slice(
  source.indexOf('function SecurityDepositBadge('),
  source.indexOf('function QuoteCard('),
);

describe('discovery Security Deposit badge', () => {
  it('renders current projected policy amount inside the search-result image', () => {
    const frameStart = card.indexOf('<View style={styles.vehicleImageFrame}>');
    const imageFrame = card.slice(frameStart, card.indexOf('</View>', frameStart));
    expect(imageFrame).toContain('<SecurityDepositBadge');
    expect(card).toContain('amountMinor={vehicle.securityDeposit.amountMinor}');
    expect(card).toContain('required={vehicle.securityDeposit.required}');
    expect(card).not.toContain('booking.securityDeposit');
  });

  it('uses concise one-line formatted copy and renders nothing for no-deposit vehicles', () => {
    expect(badge).toContain('if (!required || amountMinor == null) return null;');
    expect(badge).toContain('{money(amountMinor, currency)} deposit');
    expect(badge).toContain('numberOfLines={1}');
    expect(badge).toContain('minimumFontScale={0.9}');
    expect(source).toContain("maxWidth: '68%'");
  });

  it('keeps the visual badge secondary and clear of the top-right favorite control', () => {
    expect(source).toContain("backgroundColor: 'rgba(255,255,255,0.9)'");
    expect(source).toContain('left: spacing.sm');
    expect(source).toContain('top: spacing.sm');
    expect(source).toContain("exploreFavorite: { position: 'absolute', right: spacing.sm");
    expect(source).toContain("favorite: {\n    backgroundColor: 'rgba(255,255,255,0.92)'");
  });

  it('adds an explicit deposit announcement to required vehicle cards only', () => {
    expect(card).toContain('Security deposit required, ${money(');
    expect(card).toContain('vehicle.securityDeposit.required &&');
    expect(card).toContain(': null,');
    expect(badge).toContain('importantForAccessibility="no-hide-descendants"');
  });
});
