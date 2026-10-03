import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'PayoutMethodDetailScreen.tsx'),
  'utf8',
);
const navigation = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../navigation/AppNavigation.tsx'),
  'utf8',
);

describe('Owner payout method detail and management', () => {
  it('loads only the Owner-safe detail projection into a normal pushed screen', () => {
    expect(source).toContain('`/owner/payout-methods/${payoutMethodId}`');
    expect(source).toContain('title={method.institution.displayName}');
    expect(source).toContain('subtitle={method.maskedAccountIdentifier}');
    expect(source).toContain('method.accountHolderName');
    expect(source).toContain('dateLabel(method.createdAt)');
    expect(source).not.toContain('encryptedAccountIdentifier');
    expect(source).not.toContain('safeValidationReference');
    expect(source).not.toContain('Edit payout method');
  });

  it('shows restrained Primary and every Owner-safe readiness status', () => {
    expect(source).toContain('method.isPrimary && <StatusBadge label="Primary"');
    expect(source).toContain('payoutMethodStatusPresentation(method.status)');
    expect(source).toContain("status === 'PENDING_VERIFICATION'");
    expect(source).toContain('verification is complete');
    expect(source).toContain("status === 'NEEDS_ATTENTION'");
    expect(source).toContain('needs attention before it can be used');
    expect(source).toContain("status === 'UNAVAILABLE'");
    expect(source).toContain('unavailable for future payouts');
  });

  it('offers set-primary only for a server-capable ready non-primary method', () => {
    expect(source).toContain("method.status === 'READY' && method.actions.canSetPrimary");
    expect(source).toContain('label={setPrimary.isPending ?');
    expect(source).toContain('Future payouts will use this method.');
    expect(source).toContain('Payouts already in progress keep their current destination.');
    expect(source).toContain('`/owner/payout-accounts/${payoutMethodId}/default`');
  });

  it('requires explicit destructive confirmation and explains primary removal', () => {
    expect(source).toContain("Alert.alert(\n      'Remove payout method?'");
    expect(source).toContain("style: 'destructive'");
    expect(source).toContain("text: 'Remove payout method'");
    expect(source).toContain('add or select another ready method');
    expect(source).toContain('`/owner/payout-accounts/${payoutMethodId}/disable`');
  });

  it('disables removal and gives explicit copy while a payout is in progress', () => {
    expect(source).toContain("method.actions.removalBlockedReason === 'PAYOUT_IN_PROGRESS'");
    expect(source).toContain('can’t be removed while a payout is in progress');
    expect(source).toContain('method.actions.canRemove && (');
    expect(source).not.toContain('disabled={removalBlocked ||');
  });

  it('keeps allowed removal destructive and tightens action-section spacing', () => {
    expect(source).toContain('variant="danger"');
    expect(source).toContain('disabled={remove.isPending || setPrimary.isPending}');
    expect(source).toContain('actionsTitle:');
    expect(source).toContain('paddingTop: spacing.md');
    expect(source).not.toContain('marginTop: spacing.sm');
  });

  it('refreshes detail, list, earnings, and payouts after mutations', () => {
    expect(source).toContain("queryKey: ['owner-payout-method-detail', payoutMethodId]");
    expect(source).toContain("queryKey: ['owner-payout-methods']");
    expect(source).toContain("queryKey: ['owner-earnings-summary']");
    expect(source).toContain("queryKey: ['owner-payouts']");
    expect(source).toContain("navigation.navigate('OwnerPayoutMethods')");
  });

  it('uses whole-surface loading, error, and safe not-found states', () => {
    expect(source.match(/<FullScreenState/g)).toHaveLength(2);
    expect(source).toContain("error.code === 'PAYOUT_METHOD_NOT_FOUND'");
    expect(source).toContain("title={notFound ? 'Payout method not found'");
    expect(source).not.toContain('detail.error.message');
  });

  it('prevents duplicate mutations and keeps mutation errors Owner-safe', () => {
    expect(source).toContain('if (!setPrimary.isPending) setPrimary.mutate()');
    expect(source).toContain('if (!remove.isPending) remove.mutate()');
    expect(source).toContain('disabled={setPrimary.isPending || remove.isPending}');
    expect(source).toContain('We could not update this payout method. Try again.');
  });

  it('announces masked method context and registers the real detail screen', () => {
    expect(source).toContain('method.maskedAccountIdentifier');
    expect(source).toContain('Account holder ${method.accountHolderName}');
    expect(navigation).toContain('component={OwnerPayoutMethodDetailScreen}');
    expect(navigation).not.toContain('Payout-method details will be available');
  });
});
