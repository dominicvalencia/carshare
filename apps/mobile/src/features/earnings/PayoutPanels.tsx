import type {
  OwnerPayoutMethodList,
  OwnerPayoutMethodListItem,
  OwnerPayoutMethodStatus,
} from '@carrental/api-contracts';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import type { RootStackParamList } from '../../navigation/routes';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import {
  Button,
  Card,
  Icon,
  NestedScreen,
  SectionHeader,
  StateView,
  StatusBadge,
} from '../../ui/primitives';

type Navigator = NavigationProp<RootStackParamList>;

export function OwnerPayoutMethodsScreen() {
  const navigation = useNavigation<Navigator>();
  const client = useQueryClient();
  const methods = useQuery({
    queryKey: ['owner-payout-methods'],
    queryFn: () => apiClient.request<OwnerPayoutMethodList>('/owner/payout-methods'),
  });
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['owner-payout-methods'] });
  }, [client]);
  useRefreshOnFocusAndForeground(refresh);

  return (
    <NestedScreen title="Payout methods" subtitle="Choose where your earnings are sent.">
      <Button
        icon="add"
        label="Add payout method"
        variant="secondary"
        onPress={() => navigation.navigate('OwnerAddPayoutMethod')}
      />

      <SectionHeader flush title="Your payout methods" />
      {methods.isPending && <StateView compact loading title="Loading payout methods…" />}
      {methods.isError && (
        <StateView
          compact
          icon="cloud-offline-outline"
          title="Payout methods unavailable"
          message="We couldn't load your saved payout methods."
          actionLabel="Retry"
          onAction={() => void methods.refetch()}
        />
      )}
      {methods.data?.items.length === 0 && (
        <StateView
          compact
          icon="wallet-outline"
          title="No payout method yet"
          message="Add one to receive your earnings."
        />
      )}
      {methods.data && methods.data.items.length > 0 && (
        <Card style={styles.methodList}>
          {methods.data.items.map((method, index) => (
            <PayoutMethodRow
              key={method.id}
              divider={index < methods.data.items.length - 1}
              method={method}
              onPress={() =>
                navigation.navigate('OwnerPayoutMethodDetail', {
                  payoutMethodId: method.id,
                })
              }
            />
          ))}
        </Card>
      )}
    </NestedScreen>
  );
}

function PayoutMethodRow({
  divider,
  method,
  onPress,
}: {
  readonly divider: boolean;
  readonly method: OwnerPayoutMethodListItem;
  readonly onPress: () => void;
}) {
  const status = payoutMethodStatusPresentation(method.status);
  const primary = method.isPrimary ? 'Primary. ' : '';
  return (
    <Pressable
      accessibilityHint="Opens payout method details"
      accessibilityLabel={`${method.institution.displayName}. ${method.maskedAccountIdentifier}. ${primary}${status.label}.`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.methodRow,
        divider && styles.methodRowDivider,
        pressed && styles.pressed,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.icon}
      >
        <Icon
          color={colors.primary}
          name={method.type === 'BANK_ACCOUNT' ? 'business-outline' : 'phone-portrait-outline'}
          size={21}
        />
      </View>
      <View style={styles.methodCopy}>
        <Text style={styles.institution}>{method.institution.displayName}</Text>
        <Text style={styles.identifier}>{method.maskedAccountIdentifier}</Text>
        <View style={styles.badges}>
          {method.isPrimary && <StatusBadge label="Primary" tone="success" />}
          <StatusBadge label={status.label} tone={status.tone} />
        </View>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.chevron}
      >
        <Icon color={colors.subtleText} name="chevron-forward" size={19} />
      </View>
    </Pressable>
  );
}

export function payoutMethodStatusPresentation(status: OwnerPayoutMethodStatus | string): {
  readonly label: string;
  readonly tone: 'success' | 'warning' | 'neutral' | 'danger';
} {
  if (status === 'READY') return { label: 'Ready', tone: 'success' };
  if (status === 'PENDING_VERIFICATION') return { label: 'Pending verification', tone: 'neutral' };
  if (status === 'NEEDS_ATTENTION') return { label: 'Needs attention', tone: 'warning' };
  return { label: 'Unavailable', tone: 'danger' };
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs },
  chevron: { alignItems: 'center', alignSelf: 'center', justifyContent: 'center' },
  icon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  identifier: {
    color: colors.subtleText,
    fontSize: typography.body,
    lineHeight: 20,
  },
  institution: { color: colors.ink, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  methodCopy: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.xxs,
    justifyContent: 'center',
    minWidth: 0,
  },
  methodList: { padding: 0 },
  methodRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  methodRowDivider: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.62 },
});
