import { StyleSheet, Text, View } from 'react-native';
import type { BookingSecurityDepositReadModel } from '@carrental/api-contracts';
import { colors, spacing } from '../../theme/tokens';
import { money } from '../../ui/format';
import { Button, Card, Icon, StatusBadge } from '../../ui/primitives';

export function SecurityDepositSummary({
  busy = false,
  errorMessage,
  onPlace,
  securityDeposit,
}: {
  readonly busy?: boolean;
  readonly errorMessage?: string | undefined;
  readonly onPlace?: () => void;
  readonly securityDeposit: BookingSecurityDepositReadModel;
}) {
  const required = securityDeposit.required;
  const renterView = Boolean(onPlace);
  const currency = securityDeposit.currency ?? 'PHP';
  const amount = securityDeposit.amountMinor ?? 0;
  const status = required
    ? securityDeposit.status === 'AUTHORIZED'
      ? 'Held'
      : securityDeposit.status === 'UNKNOWN'
        ? 'Verifying deposit status'
        : securityDeposit.status === 'FAILED'
          ? renterView
            ? 'Couldn’t place deposit'
            : 'Action required from renter'
          : securityDeposit.status === 'NOT_ELIGIBLE'
            ? 'Required before pickup'
            : renterView && securityDeposit.actionRequired
              ? 'Action required'
              : renterView
                ? 'Required · Not yet held'
                : 'Waiting for renter'
    : 'Not required';
  const accessibilityLabel = required
    ? `Security deposit, ${money(amount, currency)}, ${status}. Separate from the rental price.`
    : 'Security deposit. No security deposit required. No deposit will be held for this booking.';

  return (
    <View
      accessible={!renterView}
      accessibilityLabel={!renterView ? accessibilityLabel : undefined}
    >
      <Card style={!required && styles.compactCard}>
        <View style={styles.headingRow}>
          <View style={styles.icon}>
            <Icon color={colors.primary} name="shield-checkmark-outline" size={20} />
          </View>
          <View style={styles.copy}>
            {required ? (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  Security deposit
                </Text>
                <Text style={styles.amount}>{money(amount, currency)}</Text>
              </>
            ) : (
              <>
                <Text accessibilityRole="header" style={styles.noDepositTitle}>
                  No security deposit required
                </Text>
                <Text style={[styles.body, styles.compactBody]}>
                  No deposit will be held for this booking.
                </Text>
              </>
            )}
            {required && (
              <View style={styles.status}>
                <StatusBadge label={status} tone="warning" />
              </View>
            )}
          </View>
        </View>
        {required && (
          <Text style={styles.body}>
            {securityDeposit.status === 'AUTHORIZED'
              ? 'Your deposit is authorized for this booking. It is not part of the rental price.'
              : securityDeposit.status === 'UNKNOWN'
                ? 'CarShare is verifying the authorization. Another attempt is unavailable until this check finishes.'
                : securityDeposit.status === 'FAILED'
                  ? renterView
                    ? 'The authorization was declined. You can try again without risking a duplicate hold.'
                    : 'The renter needs to place the security deposit before pickup.'
                  : securityDeposit.actionRequired
                    ? 'A temporary security deposit hold is required before pickup.'
                    : securityDeposit.executionAvailable && securityDeposit.availableAt
                      ? 'You’ll be able to place the deposit closer to pickup.'
                      : securityDeposit.executionAvailable
                        ? 'Separate from the rental price. Any hold status shown here comes from the booking record.'
                        : 'Separate from the rental price. Deposit processing is not yet available, so no hold is placed and pickup is not blocked.'}
          </Text>
        )}
        {required && securityDeposit.actionRequired && onPlace && (
          <View style={styles.action}>
            <Button
              disabled={busy}
              label={
                busy
                  ? 'Opening security deposit…'
                  : securityDeposit.status === 'AUTHORIZING'
                    ? 'Continue security deposit'
                    : 'Place security deposit'
              }
              onPress={onPlace}
            />
            {errorMessage ? (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {errorMessage}
              </Text>
            ) : null}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
  amount: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: spacing.xs },
  body: {
    color: colors.subtleText,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  compactBody: { marginTop: spacing.xs },
  compactCard: { paddingVertical: spacing.sm },
  copy: { flex: 1 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  noDepositTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  status: { alignSelf: 'flex-start', marginTop: spacing.xs },
});
