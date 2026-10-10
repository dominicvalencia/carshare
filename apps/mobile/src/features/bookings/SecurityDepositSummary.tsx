import { StyleSheet, Text, View } from 'react-native';
import type { BookingSecurityDepositReadModel } from '@carrental/api-contracts';
import { colors, spacing } from '../../theme/tokens';
import { money } from '../../ui/format';
import { Button, Card, Icon, StatusBadge } from '../../ui/primitives';

export function SecurityDepositSummary({
  busy = false,
  compact = false,
  errorMessage,
  onPlace,
  securityDeposit,
}: {
  readonly busy?: boolean;
  readonly compact?: boolean;
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
      <Card
        style={[!required && styles.compactCard, compact && required && styles.compactRequiredCard]}
      >
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
                <StatusBadge
                  label={status}
                  tone={securityDeposit.status === 'AUTHORIZED' ? 'success' : 'warning'}
                />
              </View>
            )}
          </View>
        </View>
        {required && securityDeposit.status === 'AUTHORIZED' ? (
          <View style={compact && styles.compactAuthorizedCopy}>
            <Text style={[styles.body, compact && styles.compactRequiredBody]}>
              Your deposit is authorized for this booking.
            </Text>
            <Text style={[styles.helper, compact && styles.compactHelper]}>
              This is separate from the rental price.
            </Text>
          </View>
        ) : required ? (
          <Text style={[styles.body, compact && styles.compactRequiredBody]}>
            {securityDeposit.status === 'UNKNOWN'
              ? 'CarShare is verifying the authorization. Another attempt is unavailable until this check finishes.'
              : securityDeposit.status === 'FAILED'
                ? renterView
                  ? 'The authorization was declined. You can try again without risking a duplicate hold.'
                  : 'The renter needs to place the security deposit before pickup.'
                : securityDeposit.actionRequired
                  ? 'Place the temporary deposit hold before pickup.'
                  : securityDeposit.executionAvailable && securityDeposit.availableAt
                    ? 'You’ll be able to place the deposit closer to pickup.'
                    : securityDeposit.executionAvailable
                      ? 'Separate from the rental price. Any hold status shown here comes from the booking record.'
                      : 'Separate from the rental price. Deposit processing is not yet available, so no hold is placed and pickup is not blocked.'}
          </Text>
        ) : null}
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
  compactRequiredBody: { lineHeight: 20, marginTop: spacing.xs },
  compactRequiredCard: { paddingVertical: spacing.sm },
  compactAuthorizedCopy: { gap: 2 },
  compactHelper: { marginTop: 0 },
  copy: { flex: 1 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  helper: { color: colors.subtleText, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
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
