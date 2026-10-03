import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'PayoutPanels.tsx'),
  'utf8',
);

describe('Owner payout methods list UI', () => {
  it('places the Add payout method action before the saved-method section', () => {
    const add = source.indexOf('label="Add payout method"');
    const list = source.indexOf('title="Your payout methods"');
    expect(add).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(add);
    expect(source.match(/label="Add payout method"/g)).toHaveLength(1);
    expect(source).toContain("navigation.navigate('OwnerAddPayoutMethod')");
  });

  it('uses server-projected method data and opens the selected detail route', () => {
    expect(source).toContain("apiClient.request<OwnerPayoutMethodList>('/owner/payout-methods')");
    expect(source).toContain('method.institution.displayName');
    expect(source).toContain('method.maskedAccountIdentifier');
    expect(source).toContain('method.isPrimary');
    expect(source).toContain("navigation.navigate('OwnerPayoutMethodDetail'");
    expect(source).toContain('payoutMethodId: method.id');
    expect(source).not.toMatch(/PH_BPI|PH_BDO|PH_METROBANK|PH_GCASH|PH_MAYA/);
  });

  it('maps every Owner-safe status and unknown values without crashing', () => {
    expect(source).toContain("status === 'READY'");
    expect(source).toContain("label: 'Ready'");
    expect(source).toContain("status === 'PENDING_VERIFICATION'");
    expect(source).toContain("label: 'Pending verification'");
    expect(source).toContain("status === 'NEEDS_ATTENTION'");
    expect(source).toContain("label: 'Needs attention'");
    expect(source).toContain("label: 'Unavailable'");
  });

  it('keeps loading, error/retry, and empty states distinct', () => {
    expect(source).toContain('title="Loading payout methods…"');
    expect(source).toContain('title="Payout methods unavailable"');
    expect(source).toContain('actionLabel="Retry"');
    expect(source).toContain('title="No payout method yet"');
    expect(source).toContain('message="Add one to receive your earnings."');
  });

  it('announces full row context and keeps icons decorative', () => {
    expect(source).toContain('accessibilityHint="Opens payout method details"');
    expect(source).toContain('method.maskedAccountIdentifier');
    expect(source).toContain("const primary = method.isPrimary ? 'Primary. ' : ''");
    expect(source).toContain('accessibilityElementsHidden');
    expect(source).toContain("flexWrap: 'wrap'");
  });

  it('keeps saved-method rows compact without sacrificing the whole-row target', () => {
    expect(source).toContain('minHeight: 72');
    expect(source).toContain('paddingVertical: spacing.xs');
    expect(source).toContain('height: 34');
    expect(source).toContain('width: 34');
    expect(source).toContain("alignItems: 'center'");
  });

  it('aligns icon, identity, badges, and chevron as one centered horizontal row', () => {
    expect(source).toContain('style={styles.icon}');
    expect(source).toContain('style={styles.methodCopy}');
    expect(source).toContain('style={styles.chevron}');
    expect(source).toContain('methodCopy: {');
    expect(source).toContain('gap: spacing.xxs');
    expect(source).toContain("justifyContent: 'center'");
    expect(source).toContain("alignSelf: 'center'");
    expect(source).toContain('<StatusBadge label="Primary" tone="success" />');
    expect(source).toContain('<StatusBadge label={status.label} tone={status.tone} />');
  });

  it('refreshes on focus, foreground, and return navigation', () => {
    expect(source).toContain('useRefreshOnFocusAndForeground(refresh)');
    expect(source).toContain("invalidateQueries({ queryKey: ['owner-payout-methods'] })");
  });
});
