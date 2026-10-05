import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';

const here = dirname(fileURLToPath(import.meta.url));
const sheetSource = readFileSync(resolve(here, './SecurityDepositInfoSheet.tsx'), 'utf8');
const discoverySource = readFileSync(resolve(here, '../discovery/DiscoveryScreen.tsx'), 'utf8');

describe('Security Deposit information sheet', () => {
  it('opens from the whole renter vehicle-detail row with an informational hint', () => {
    expect(discoverySource).toContain('onPress={() => setSecurityDepositInfoOpen(true)}');
    expect(discoverySource).toContain('accessibilityHint="Opens deposit information"');
    expect(discoverySource).toContain('<SecurityDepositInfoSheet');
    expect(discoverySource).toContain('deposit={vehicle.securityDeposit}');
  });

  it('uses a concise required-deposit hierarchy and keeps no-deposit copy unchanged', () => {
    expect(sheetSource).toContain('{money(amount, currency)} refundable deposit');
    expect(sheetSource).toContain('This deposit is separate from the rental price.');
    expect(sheetSource).toContain('CarShare may require this deposit before pickup.');
    expect(sheetSource).toContain('After the trip is cleared, the');
    expect(sheetSource).toContain('unless approved charges apply.');
    expect(sheetSource).not.toContain('After the vehicle is returned and');
    expect(sheetSource).toContain('No security deposit required');
    expect(sheetSource).toContain('No deposit will be held for this booking.');
  });

  it('presents non-exhaustive approved-charge examples as an accessible compact list', () => {
    expect(sheetSource).toContain('Examples of approved charges');
    expect(sheetSource).toContain('accessibilityRole="list"');
    expect(sheetSource).toContain("{'\\u2022'} Damage");
    expect(sheetSource).toContain("{'\\u2022'} Late return");
    expect(sheetSource).toContain("{'\\u2022'} Other eligible trip-related costs");
    expect(sheetSource).not.toMatch(/covers only|only covers/);
  });

  it('keeps execution gating truthful and prohibits off-platform deposits', () => {
    expect(sheetSource).toContain('{!executionAvailable && (');
    expect(sheetSource).toContain('Deposit processing isn’t active yet.');
    expect(sheetSource).toContain('pickup won’t be');
    expect(sheetSource).toContain('Security deposits are handled through CarShare.');
    expect(sheetSource).toContain('cash or off-platform deposit.');
    expect(sheetSource).not.toMatch(/Pay deposit|Place hold|Retry|Release deposit/);
  });

  it('uses intrinsic height for short content and capped scrolling for large text', () => {
    const compact = adaptiveSheetLayout({
      contentHeight: 280,
      headerHeight: 0,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 0,
    });
    const accessible = adaptiveSheetLayout({
      contentHeight: 1_100,
      headerHeight: 0,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 0,
    });
    expect(compact).toEqual({ height: 280, intrinsicHeight: 280, scrollEnabled: false });
    expect(accessible).toEqual({ height: 780, intrinsicHeight: 1_100, scrollEnabled: true });
    expect(sheetSource).toContain('onContentSizeChange={(_width, height) =>');
    expect(sheetSource).toContain('scrollEnabled={measuredLayout.scrollEnabled}');
    expect(sheetSource).not.toMatch(/0\.7|0\.8|70%|80%/);
  });

  it('announces the title and exposes one safe dismissal action', () => {
    expect(sheetSource).toContain('accessibilityRole="header"');
    expect(sheetSource).toContain('<Button label="Got it" onPress={onDismiss} />');
    expect(sheetSource.match(/label="Got it"/g)).toHaveLength(1);
    expect(sheetSource).toContain('paddingBottom: bottomAllowance');
  });
});
