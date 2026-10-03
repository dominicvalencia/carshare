import type {
  OwnerEarningDetail,
  OwnerEarningsSummary,
  OwnerFinancialActivityItem,
  OwnerFinancialActivityPage,
  OwnerFinancialActivityScope,
  OwnerPayoutDetail,
} from '@carrental/api-contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { colors, radius, shadows, spacing, typography } from '../../theme/tokens';
import {
  channelLabel,
  dateTimeLabel,
  domainLabel,
  money,
  payoutStatusLabel,
} from '../../ui/format';
import { Button, Card, NestedScreen, SectionHeader, StateView } from '../../ui/primitives';

const activityScopes: readonly { label: string; value: OwnerFinancialActivityScope }[] = [
  { label: 'Upcoming', value: 'UPCOMING' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Adjustments', value: 'ADJUSTMENTS' },
];

type DetailSelection =
  | { readonly id: string; readonly resource: 'EARNING' }
  | { readonly id: string; readonly resource: 'PAYOUT' }
  | { readonly item: OwnerFinancialActivityItem; readonly resource: 'PENALTY' };

export function OwnerEarningsScreen() {
  const client = useQueryClient();
  const [scope, setScope] = useState<OwnerFinancialActivityScope>('UPCOMING');
  const [detail, setDetail] = useState<DetailSelection | null>(null);
  const summary = useQuery({
    queryKey: ['owner-earnings-summary'],
    queryFn: () => apiClient.request<OwnerEarningsSummary>('/owner/earnings/summary'),
  });
  const activity = useInfiniteQuery({
    queryKey: ['owner-earnings-activity', scope],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiClient.request<OwnerFinancialActivityPage>(
        `/owner/earnings/activity?scope=${scope}&page=${pageParam}&pageSize=20`,
      ),
    getNextPageParam: (page) => page.nextPage ?? undefined,
  });
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['owner-earnings-summary'] });
    void client.invalidateQueries({ queryKey: ['owner-earnings-activity'] });
    void client.invalidateQueries({ queryKey: ['owner-payouts'] });
  }, [client]);
  useRefreshOnFocusAndForeground(refresh);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return (activity.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [activity.data]);
  const visibleItems = items.filter(
    (item) =>
      !(
        scope === 'UPCOMING' &&
        item.detailTarget?.resource === 'PAYOUT' &&
        item.detailTarget.id === summary.data?.upcomingPayout?.id
      ),
  );

  if (detail) return <FinancialDetail detail={detail} onBack={() => setDetail(null)} />;

  return (
    <NestedScreen title="Earnings & payouts">
      {summary.isPending && <SummaryLoading />}
      {summary.isError && (
        <StateView
          compact
          icon="cloud-offline-outline"
          title="Balance unavailable"
          message="Your activity is still available below."
          actionLabel="Retry balance"
          onAction={() => void summary.refetch()}
        />
      )}
      {summary.data && <FinancialSummary summary={summary.data} />}

      <SectionHeader flush title="Activity" />
      <View accessibilityRole="tablist" style={styles.tabs}>
        {activityScopes.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === option.value }}
            style={[styles.tab, scope === option.value && styles.tabActive]}
            onPress={() => setScope(option.value)}
          >
            <Text style={[styles.tabText, scope === option.value && styles.tabTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {activity.isPending && <StateView compact loading title="Loading activity…" />}
      {activity.isError && (
        <StateView
          compact
          icon="cloud-offline-outline"
          title={`${scopeLabel(scope)} activity unavailable`}
          message={activity.error.message}
          actionLabel="Retry activity"
          onAction={() => void activity.refetch()}
        />
      )}
      {!activity.isPending && !activity.isError && items.length === 0 && (
        <StateView
          compact
          icon="receipt-outline"
          title={emptyTitle(scope)}
          message={emptyMessage(scope)}
        />
      )}
      {visibleItems.map((item) => (
        <ActivityRow key={item.id} item={item} onOpen={(selection) => setDetail(selection)} />
      ))}
      {activity.hasNextPage && (
        <Button
          label={activity.isFetchingNextPage ? 'Loading…' : 'Load more'}
          variant="secondary"
          disabled={activity.isFetchingNextPage}
          onPress={() => void activity.fetchNextPage()}
        />
      )}
    </NestedScreen>
  );
}

function ActivityRow({
  item,
  onOpen,
}: {
  readonly item: OwnerFinancialActivityItem;
  readonly onOpen: (detail: DetailSelection) => void;
}) {
  const detail = item.detailTarget
    ? { id: item.detailTarget.id, resource: item.detailTarget.resource }
    : item.type === 'PENALTY'
      ? { item, resource: 'PENALTY' as const }
      : null;
  const signed = signedMoney(
    item.amountMinor,
    item.currency,
    item.type === 'ADJUSTMENT' || item.type === 'COMPENSATION',
  );
  const spokenAmount =
    item.amountMinor < 0 ? `Negative amount ${money(-item.amountMinor, item.currency)}` : signed;

  return (
    <Pressable
      accessibilityHint={detail ? 'Opens financial activity details' : undefined}
      accessibilityLabel={`${item.title}. ${item.subtitle}. ${spokenAmount}. ${domainLabel(item.status)}`}
      accessibilityRole={detail ? 'button' : 'text'}
      disabled={!detail}
      style={({ pressed }) => [styles.activityRow, pressed && detail && styles.pressed]}
      onPress={() => detail && onOpen(detail)}
    >
      <View style={styles.activityCopy}>
        <Text style={styles.activityTitle}>{item.title}</Text>
        <Text style={styles.body}>{item.subtitle}</Text>
        <Text style={styles.activityMeta}>{dateTimeLabel(item.occurredAt)}</Text>
      </View>
      <View style={styles.activityTrailing}>
        <View style={styles.activityFinancial}>
          <Text style={[styles.activityAmount, item.amountMinor < 0 && styles.negativeAmount]}>
            {signed}
          </Text>
          <Text style={styles.activityStatus}>{domainLabel(item.status)}</Text>
        </View>
        {detail && (
          <Text accessibilityElementsHidden style={styles.chevron}>
            ›
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function FinancialDetail({
  detail,
  onBack,
}: {
  readonly detail: DetailSelection;
  readonly onBack: () => void;
}) {
  if (detail.resource === 'EARNING') return <EarningDetail id={detail.id} onBack={onBack} />;
  if (detail.resource === 'PAYOUT') return <PayoutDetail id={detail.id} onBack={onBack} />;
  return <PenaltyDetail item={detail.item} onBack={onBack} />;
}

function DetailShell({
  children,
  eyebrow,
  onBack,
  title,
}: {
  readonly children: React.ReactNode;
  readonly eyebrow: string;
  readonly onBack: () => void;
  readonly title: string;
}) {
  return (
    <NestedScreen backLabel="Back" onBack={onBack} eyebrow={eyebrow} title={title}>
      {children}
    </NestedScreen>
  );
}

function EarningDetail({ id, onBack }: { readonly id: string; readonly onBack: () => void }) {
  const query = useQuery({
    queryKey: ['owner-earning-detail', id],
    queryFn: () => apiClient.request<OwnerEarningDetail>(`/owner/earnings/${id}`),
  });
  return (
    <DetailShell eyebrow="Earning detail" title="Earning breakdown" onBack={onBack}>
      {query.isPending && <StateView compact loading title="Loading earning…" />}
      {query.isError && (
        <DetailError message={query.error.message} onRetry={() => void query.refetch()} />
      )}
      {query.data && <EarningDetailContent earning={query.data} />}
    </DetailShell>
  );
}

function EarningDetailContent({ earning }: { readonly earning: OwnerEarningDetail }) {
  const rows = [
    ['Gross rental', earning.grossRentalAmountMinor],
    ['Delivery', earning.deliveryEarningMinor],
    ['Collection', earning.collectionEarningMinor],
    ['Additional compensation', earning.additionalCompensationMinor],
    ['Adjustments', earning.adjustmentAmountMinor],
    ['Platform commission', -earning.commissionAmountMinor],
    ['Held', -earning.heldAmountMinor],
  ] as const;
  return (
    <>
      <Card>
        <Text style={styles.detailTitle}>{earning.booking.vehicleSummary}</Text>
        <Text style={styles.body}>{earning.booking.renterDisplayName}</Text>
        <Text style={styles.body}>{earning.booking.publicReference}</Text>
        <Text style={styles.body}>
          {dateTimeLabel(earning.booking.rentalStart)} – {dateTimeLabel(earning.booking.rentalEnd)}
        </Text>
      </Card>
      <Card>
        <Text style={styles.detailTitle}>Breakdown</Text>
        {rows
          .filter(([, amount]) => amount !== 0)
          .map(([label, amount]) => (
            <AmountRow key={label} label={label} amount={amount} currency={earning.currency} />
          ))}
        <AmountRow
          label="Net earning"
          amount={earning.projectedTotalMinor}
          currency={earning.currency}
          emphasized
        />
      </Card>
      <Card>
        <Text style={styles.detailTitle}>Payout</Text>
        <Text style={styles.body}>{earningStatusLabel(earning.status)}</Text>
        {earning.payout ? (
          <Text style={styles.body}>
            {earning.payout.publicReference} · {payoutStatusLabel(earning.payout.status)}
          </Text>
        ) : (
          <Text style={styles.body}>Not assigned to a payout yet.</Text>
        )}
      </Card>
    </>
  );
}

function PayoutDetail({ id, onBack }: { readonly id: string; readonly onBack: () => void }) {
  const query = useQuery({
    queryKey: ['owner-payout-detail', id],
    queryFn: () => apiClient.request<OwnerPayoutDetail>(`/owner/payouts/${id}`),
  });
  return (
    <DetailShell eyebrow="Payout detail" title="Payout" onBack={onBack}>
      {query.isPending && <StateView compact loading title="Loading payout…" />}
      {query.isError && (
        <DetailError message={query.error.message} onRetry={() => void query.refetch()} />
      )}
      {query.data && <PayoutDetailContent payout={query.data} />}
    </DetailShell>
  );
}

function PayoutDetailContent({ payout }: { readonly payout: OwnerPayoutDetail }) {
  const timestamp = payout.paidAt ?? payout.submittedAt ?? payout.approvedAt ?? payout.createdAt;
  return (
    <>
      <Card>
        <Text style={styles.balanceLabel}>Amount</Text>
        <Text style={styles.detailAmount}>{money(payout.amountMinor, payout.currency)}</Text>
        <Text style={styles.body}>
          {payoutStatusLabel(payout.status)} · {dateTimeLabel(timestamp)}
        </Text>
        <Text style={styles.body}>
          {channelLabel(payout.destination.channel)} · {payout.destination.maskedIdentifier}
        </Text>
        <Text style={styles.body}>{payout.publicReference}</Text>
      </Card>
      <Card>
        <Text style={styles.detailTitle}>Included earnings</Text>
        {payout.includedEarnings.map((earning) => (
          <AmountRow
            key={earning.earningId}
            label={earning.bookingReference}
            amount={earning.amountMinor}
            currency={payout.currency}
          />
        ))}
      </Card>
      {(payout.adjustmentAmountMinor !== 0 || payout.cancellationPenaltyRecoveryMinor !== 0) && (
        <Card>
          <Text style={styles.detailTitle}>Adjustments</Text>
          {payout.adjustmentAmountMinor !== 0 && (
            <AmountRow
              label="Adjustment"
              amount={payout.adjustmentAmountMinor}
              currency={payout.currency}
            />
          )}
          {payout.cancellationPenaltyRecoveryMinor !== 0 && (
            <AmountRow
              label="Penalty recovery"
              amount={-payout.cancellationPenaltyRecoveryMinor}
              currency={payout.currency}
            />
          )}
        </Card>
      )}
    </>
  );
}

function PenaltyDetail({
  item,
  onBack,
}: {
  readonly item: OwnerFinancialActivityItem;
  readonly onBack: () => void;
}) {
  return (
    <DetailShell eyebrow="Adjustment detail" title="Penalty" onBack={onBack}>
      <Card>
        <Text style={[styles.detailAmount, styles.negativeAmount]}>
          {signedMoney(item.amountMinor, item.currency)}
        </Text>
        <Text style={styles.detailTitle}>{item.title}</Text>
        <Text style={styles.body}>{item.subtitle}</Text>
        {item.reasonCode && <Text style={styles.body}>Reason: {domainLabel(item.reasonCode)}</Text>}
        {item.bookingReference && <Text style={styles.body}>Booking: {item.bookingReference}</Text>}
        <Text style={styles.body}>
          {domainLabel(item.status)} · {dateTimeLabel(item.occurredAt)}
        </Text>
      </Card>
    </DetailShell>
  );
}

function AmountRow({
  amount,
  currency,
  emphasized = false,
  label,
}: {
  readonly amount: number;
  readonly currency: string;
  readonly emphasized?: boolean;
  readonly label: string;
}) {
  const showPositiveSign = label === 'Additional compensation' || label === 'Adjustments';
  return (
    <View style={styles.amountRow}>
      <Text style={[styles.body, emphasized && styles.emphasized]}>{label}</Text>
      <Text
        style={[
          styles.amountRowValue,
          emphasized && styles.emphasized,
          amount < 0 && styles.negativeAmount,
        ]}
      >
        {signedMoney(amount, currency, showPositiveSign)}
      </Text>
    </View>
  );
}

function DetailError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <StateView
      compact
      icon="cloud-offline-outline"
      title="Details unavailable"
      message={message}
      actionLabel="Retry"
      onAction={onRetry}
    />
  );
}

function FinancialSummary({ summary }: { readonly summary: OwnerEarningsSummary }) {
  const upcoming = summary.upcomingPayout;
  const method = upcoming
    ? `${channelLabel(upcoming.method.channel)} ${upcoming.method.maskedIdentifier}`
    : null;
  return (
    <View style={styles.summaryStack}>
      <Card style={styles.summaryCard}>
        <Text style={styles.balanceLabel}>Available</Text>
        <Text
          accessibilityLabel={`Available ${money(summary.availableMinor, summary.currency)}`}
          style={styles.availableAmount}
        >
          {money(summary.availableMinor, summary.currency)}
        </Text>
        <View style={styles.secondaryBalances}>
          <View style={styles.secondaryBalance}>
            <Text style={styles.secondaryLabel}>Pending</Text>
            <Text style={styles.secondaryAmount}>
              {money(summary.pendingMinor, summary.currency)}
            </Text>
          </View>
          <View style={styles.secondaryBalance}>
            <Text style={styles.secondaryLabel}>On hold</Text>
            <Text style={styles.secondaryAmount}>{money(summary.heldMinor, summary.currency)}</Text>
          </View>
        </View>
        {summary.payoutReadyMinor > 0 && (
          <View style={styles.payoutReadyRow}>
            <Text style={styles.payoutReadyLabel}>Payout ready</Text>
            <Text style={styles.payoutReadyAmount}>
              {money(summary.payoutReadyMinor, summary.currency)}
            </Text>
          </View>
        )}
      </Card>
      {upcoming && (
        <Card style={styles.upcomingCard}>
          <Text style={styles.cardTitle}>Upcoming payout</Text>
          <Text style={styles.upcomingAmount}>
            {money(upcoming.amountMinor, upcoming.currency)}
          </Text>
          <View style={styles.upcomingMetadata}>
            <Text style={styles.status}>{payoutStatusLabel(upcoming.status)}</Text>
            <Text style={styles.method}>{method}</Text>
          </View>
        </Card>
      )}
    </View>
  );
}

function SummaryLoading() {
  return (
    <Card style={styles.summaryCard}>
      <View accessibilityLabel="Loading financial summary" accessibilityRole="progressbar">
        <View style={[styles.placeholder, styles.placeholderLabel]} />
        <View style={[styles.placeholder, styles.placeholderAmount]} />
        <View style={styles.placeholderRow}>
          <View style={[styles.placeholder, styles.placeholderSecondary]} />
          <View style={[styles.placeholder, styles.placeholderSecondary]} />
        </View>
      </View>
    </Card>
  );
}

function signedMoney(amountMinor: number, currency: string, showPositiveSign = false) {
  if (amountMinor < 0) return `−${money(-amountMinor, currency)}`;
  if (amountMinor > 0 && showPositiveSign) return `+${money(amountMinor, currency)}`;
  if (amountMinor > 0) return money(amountMinor, currency);
  return money(0, currency);
}

function scopeLabel(scope: OwnerFinancialActivityScope) {
  return activityScopes.find((option) => option.value === scope)?.label ?? 'Upcoming';
}

function emptyMessage(scope: OwnerFinancialActivityScope) {
  if (scope === 'PAID') return 'Completed payouts will appear here.';
  if (scope === 'ADJUSTMENTS') return 'Compensations, penalties, and reversals will appear here.';
  return 'Pending earnings and payouts will appear here.';
}

function emptyTitle(scope: OwnerFinancialActivityScope) {
  if (scope === 'PAID') return 'No paid payouts yet';
  if (scope === 'ADJUSTMENTS') return 'No adjustments';
  return 'No upcoming earnings';
}

function earningStatusLabel(status: string) {
  return domainLabel(status);
}

const styles = StyleSheet.create({
  activityAmount: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '900',
    textAlign: 'right',
  },
  activityCopy: { flex: 1, minWidth: 0 },
  activityFinancial: { alignItems: 'flex-end', gap: spacing.xxs },
  activityMeta: { color: colors.subtleText, fontSize: typography.caption, marginTop: spacing.xs },
  activityRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 92,
    padding: spacing.md,
  },
  activityTitle: { color: colors.ink, fontSize: typography.body, fontWeight: '800' },
  activityStatus: { color: colors.subtleText, fontSize: typography.caption, fontWeight: '700' },
  activityTrailing: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  amountRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  amountRowValue: { color: colors.ink, flexShrink: 1, fontWeight: '800', textAlign: 'right' },
  availableAmount: {
    color: colors.primaryDark,
    flexShrink: 1,
    fontSize: typography.hero,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: spacing.xs,
  },
  balanceLabel: { color: colors.subtleText, fontSize: typography.label, fontWeight: '700' },
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  cardTitle: { color: colors.ink, fontSize: typography.body, fontWeight: '800' },
  chevron: { color: colors.primary, fontSize: 30, lineHeight: 30 },
  detailAmount: {
    color: colors.ink,
    fontSize: typography.hero,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  detailTitle: { color: colors.ink, fontSize: typography.heading, fontWeight: '900' },
  emphasized: { color: colors.ink, fontWeight: '900' },
  method: { color: colors.subtleText, flexShrink: 1, fontSize: typography.body },
  negativeAmount: { color: colors.danger },
  payoutReadyAmount: {
    color: colors.primaryDark,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'right',
  },
  payoutReadyLabel: { color: colors.primaryDark, fontSize: typography.label, fontWeight: '700' },
  payoutReadyRow: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  placeholder: { backgroundColor: colors.muted, borderRadius: radius.sm },
  placeholderAmount: { height: 38, marginTop: spacing.sm, width: '58%' },
  placeholderLabel: { height: 14, width: 76 },
  placeholderRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xl },
  placeholderSecondary: { flex: 1, height: 42 },
  pressed: { opacity: 0.7 },
  secondaryAmount: {
    color: colors.ink,
    flexShrink: 1,
    fontSize: typography.heading,
    fontWeight: '800',
    marginTop: spacing.xxs,
  },
  secondaryBalance: { flex: 1, minWidth: 0 },
  secondaryBalances: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xl },
  secondaryLabel: { color: colors.subtleText, fontSize: typography.label, fontWeight: '700' },
  status: { color: colors.primary, fontSize: typography.label, fontWeight: '800' },
  summaryCard: { borderWidth: 0, padding: spacing.xl, ...shadows.card },
  summaryStack: { gap: spacing.md },
  tab: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.ink, fontSize: typography.label, fontWeight: '800' },
  tabTextActive: { color: colors.onPrimary },
  tabs: { flexDirection: 'row', gap: spacing.xs },
  upcomingAmount: {
    color: colors.ink,
    flexShrink: 1,
    fontSize: typography.title,
    fontWeight: '900',
    marginTop: spacing.sm,
  },
  upcomingCard: { borderWidth: 0, padding: spacing.lg, ...shadows.card },
  upcomingMetadata: { gap: spacing.xxs, marginTop: spacing.md },
});
