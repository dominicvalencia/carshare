import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { money, payoutStatusLabel } from '../../ui/format';

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(directory, 'OwnerEarningsScreen.tsx'), 'utf8');
const payoutPanelsSource = readFileSync(resolve(directory, 'PayoutPanels.tsx'), 'utf8');

describe('Owner Earnings activity and details UI', () => {
  it('preserves the accepted summary authority and visual balance hierarchy', () => {
    expect(source).toContain("apiClient.request<OwnerEarningsSummary>('/owner/earnings/summary')");
    expect(source).toContain('<Text style={styles.balanceLabel}>Available</Text>');
    expect(source).toContain('summary.payoutReadyMinor > 0');
    expect(source).toContain('<Text style={styles.cardTitle}>Upcoming payout</Text>');
    expect(source).not.toContain('expectedAt');
    expect(source).not.toContain('eyebrow="Owner finances"');
  });

  it('uses the three accepted server scopes and defaults to Upcoming', () => {
    expect(source).toContain("useState<OwnerFinancialActivityScope>('UPCOMING')");
    expect(source).toContain("{ label: 'Upcoming', value: 'UPCOMING' }");
    expect(source).toContain("{ label: 'Paid', value: 'PAID' }");
    expect(source).toContain("{ label: 'Adjustments', value: 'ADJUSTMENTS' }");
    expect(source).toContain('accessibilityRole="tablist"');
    expect(source).toContain('accessibilityState={{ selected: scope === option.value }}');
  });

  it('uses bounded paginated activity, stable cache keys, deduplication, and load more', () => {
    expect(source).toContain("queryKey: ['owner-earnings-activity', scope]");
    expect(source).toContain('pageSize=20');
    expect(source).toContain('getNextPageParam: (page) => page.nextPage ?? undefined');
    expect(source).toContain('const seen = new Set<string>()');
    expect(source).toContain("item.detailTarget?.resource === 'PAYOUT'");
    expect(source).toContain('item.detailTarget.id === summary.data?.upcomingPayout?.id');
    expect(source).toContain("label={activity.isFetchingNextPage ? 'Loading…' : 'Load more'}");
  });

  it('keeps activity failures isolated from the summary and provides per-scope empty states', () => {
    expect(source).toContain('title="Balance unavailable"');
    expect(source).toContain('Your activity is still available below.');
    expect(source).toContain('title={`${scopeLabel(scope)} activity unavailable`}');
    expect(source).toContain('Completed payouts will appear here.');
    expect(source).toContain('Compensations, penalties, and reversals will appear here.');
    expect(source).toContain("return 'No upcoming earnings'");
    expect(source).toContain("return 'No paid payouts yet'");
    expect(source).toContain("return 'No adjustments'");
  });

  it('renders compact whole-row activity navigation with readable signed amounts', () => {
    expect(source).toContain('style={({ pressed }) => [styles.activityRow');
    expect(source).toContain("accessibilityHint={detail ? 'Opens financial activity details'");
    expect(source).toContain('return `−${money(-amountMinor, currency)}`');
    expect(source).toContain('return `+${money(amountMinor, currency)}`');
    expect(source).toContain("item.type === 'PENALTY'");
    expect(source).toContain('Negative amount');
    expect(source).toContain('styles.activityFinancial');
    expect(source).toContain('styles.activityStatus');
  });

  it('loads Owner-safe earning and payout details from accepted detail authorities', () => {
    expect(source).toContain('apiClient.request<OwnerEarningDetail>(`/owner/earnings/${id}`)');
    expect(source).toContain('apiClient.request<OwnerPayoutDetail>(`/owner/payouts/${id}`)');
    expect(source).toContain('<Text style={styles.detailTitle}>Breakdown</Text>');
    expect(source).toContain('<Text style={styles.detailTitle}>Included earnings</Text>');
    expect(source).toMatch(/rows\s*\.filter\(\(\[, amount\]\) => amount !== 0\)/);
    expect(source).toContain('payout.adjustmentAmountMinor !== 0');
  });

  it('offers a projected penalty detail without adding a backend authority', () => {
    expect(source).toContain('<DetailShell eyebrow="Adjustment detail" title="Penalty"');
    expect(source).toContain('Reason: {domainLabel(item.reasonCode)}');
    expect(source).toContain('Booking: {item.bookingReference}');
  });

  it('makes Paid the payout history and removes configuration from Earnings', () => {
    expect(source).not.toContain('<PayoutPanels />');
    expect(payoutPanelsSource).not.toContain('Manage payout settings');
    expect(payoutPanelsSource).not.toContain('Payout history');
    expect(payoutPanelsSource).not.toContain('apiClient.request<readonly PayoutHistoryItem[]>');
  });

  it('keeps informational payout destination data in the summary', () => {
    expect(source).toContain('upcoming.method.channel');
    expect(source).toContain('upcoming.method.maskedIdentifier');
    expect(source).toContain('<SectionHeader flush title="Activity" />');
  });

  it('refreshes summary and scoped activity on focus and foreground', () => {
    expect(source).toContain('useRefreshOnFocusAndForeground(refresh)');
    expect(source).toContain("invalidateQueries({ queryKey: ['owner-earnings-activity'] })");
  });

  it('keeps owner-facing formatting responsive for varied amounts and statuses', () => {
    expect(money(90_000, 'PHP')).toBe('₱900');
    expect(money(125_000_000, 'PHP')).toBe('₱1,250,000');
    expect(payoutStatusLabel('PROCESSING')).toBe('Processing');
    expect(source).toContain('flexShrink: 1');
    expect(source).not.toContain('numberOfLines={1}');
  });
});
