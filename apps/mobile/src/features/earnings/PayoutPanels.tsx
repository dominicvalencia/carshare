import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';

interface PayoutAccount {
  readonly accountHolderName: string;
  readonly destinationChannel: string;
  readonly id: string;
  readonly isDefault: boolean;
  readonly maskedAccountIdentifier: string;
  readonly status: string;
  readonly type: string;
  readonly validationLevel: string | null;
}

interface AccountResponse {
  readonly eligibility: { readonly status: string };
  readonly items: readonly PayoutAccount[];
}

interface PayoutHistoryItem {
  readonly amountMinor: number;
  readonly createdAt: string;
  readonly destination: { readonly maskedIdentifier: string; readonly channel: string };
  readonly id: string;
  readonly paidAt: string | null;
  readonly publicReference: string;
  readonly status: string;
}

export function PayoutPanels() {
  const client = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<'BANK_ACCOUNT' | 'E_WALLET'>('BANK_ACCOUNT');
  const [channel, setChannel] = useState('PH_BPI');
  const [holder, setHolder] = useState('');
  const [identifier, setIdentifier] = useState('');
  const accounts = useQuery({
    queryKey: ['owner-payout-accounts'],
    queryFn: () => apiClient.request<AccountResponse>('/owner/payout-accounts'),
  });
  const payouts = useQuery({
    queryKey: ['owner-payouts'],
    queryFn: () => apiClient.request<readonly PayoutHistoryItem[]>('/owner/payouts'),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['owner-payout-accounts'] });
    void client.invalidateQueries({ queryKey: ['owner-payouts'] });
    void client.invalidateQueries({ queryKey: ['owner-earnings'] });
  };
  const add = useMutation({
    mutationFn: () =>
      apiClient.request<PayoutAccount>('/owner/payout-accounts', {
        body: JSON.stringify({
          accountHolderName: holder,
          accountIdentifier: identifier,
          destinationChannel: channel,
          type,
        }),
        method: 'POST',
      }),
    onSuccess: () => {
      setHolder('');
      setIdentifier('');
      setShowAdd(false);
      refresh();
    },
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) =>
      apiClient.request(`/owner/payout-accounts/${id}/default`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const processingMinor = (payouts.data ?? [])
    .filter((payout) => ['APPROVED', 'SUBMITTING', 'PROCESSING'].includes(payout.status))
    .reduce((sum, payout) => sum + payout.amountMinor, 0);
  const paidMinor = (payouts.data ?? [])
    .filter((payout) => payout.status === 'PAID')
    .reduce((sum, payout) => sum + payout.amountMinor, 0);

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payout status</Text>
        <Text style={styles.amount}>Processing · ₱{(processingMinor / 100).toLocaleString()}</Text>
        <Text style={styles.body}>Paid · ₱{(paidMinor / 100).toLocaleString()}</Text>
        <Text style={styles.body}>
          Eligibility · {accounts.data?.eligibility.status ?? 'NOT_READY'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payout settings</Text>
        <Text style={styles.body}>Bank and e-wallet identifiers stay masked after creation.</Text>
        {accounts.data?.items.map((account) => (
          <View key={account.id} style={styles.destination}>
            <Text style={styles.destinationTitle}>
              {account.destinationChannel} · {account.maskedAccountIdentifier}
            </Text>
            <Text style={styles.body}>
              {account.status} · {account.isDefault ? 'Default' : account.validationLevel}
            </Text>
            {account.status === 'ACTIVE' && !account.isDefault && (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => makeDefault.mutate(account.id)}
              >
                <Text style={styles.secondaryButtonText}>Set default</Text>
              </Pressable>
            )}
          </View>
        ))}
        <Pressable style={styles.button} onPress={() => setShowAdd((value) => !value)}>
          <Text style={styles.buttonText}>{showAdd ? 'Cancel' : 'Add bank / e-wallet'}</Text>
        </Pressable>
        {showAdd && (
          <View style={styles.form}>
            <View style={styles.row}>
              {(['BANK_ACCOUNT', 'E_WALLET'] as const).map((value) => (
                <Pressable
                  key={value}
                  style={[styles.pill, type === value && styles.pillActive]}
                  onPress={() => {
                    setType(value);
                    setChannel(value === 'BANK_ACCOUNT' ? 'PH_BPI' : 'PH_GCASH');
                  }}
                >
                  <Text style={type === value ? styles.buttonText : styles.secondaryButtonText}>
                    {value === 'BANK_ACCOUNT' ? 'Bank' : 'E-wallet'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={channel}
              onChangeText={setChannel}
              placeholder="Channel, e.g. PH_BPI"
            />
            <TextInput
              style={styles.input}
              value={holder}
              onChangeText={setHolder}
              placeholder="Account holder name"
            />
            <TextInput
              style={styles.input}
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="Account or wallet number"
              keyboardType="number-pad"
            />
            <Pressable
              style={[styles.button, (!holder || !identifier || add.isPending) && styles.disabled]}
              disabled={!holder || !identifier || add.isPending}
              onPress={() => add.mutate()}
            >
              <Text style={styles.buttonText}>
                {add.isPending ? 'Validating…' : 'Validate and add'}
              </Text>
            </Pressable>
          </View>
        )}
        {(add.error || makeDefault.error) && (
          <Text style={styles.error}>{add.error?.message ?? makeDefault.error?.message}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payout history</Text>
        {payouts.data?.map((payout) => (
          <View key={payout.id} style={styles.destination}>
            <Text style={styles.destinationTitle}>
              ₱{(payout.amountMinor / 100).toLocaleString()} · {payout.status}
            </Text>
            <Text style={styles.body}>
              {payout.destination.channel} · {payout.destination.maskedIdentifier}
            </Text>
            <Text style={styles.body}>{payout.publicReference}</Text>
          </View>
        ))}
        {payouts.data?.length === 0 && <Text style={styles.body}>No payout history yet.</Text>}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  amount: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: spacing.sm },
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  destination: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  destinationTitle: { color: colors.ink, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#9B1C1C', marginTop: spacing.sm },
  form: { gap: spacing.sm, marginTop: spacing.sm },
  input: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    padding: spacing.md,
  },
  pill: {
    borderColor: colors.primary,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pillActive: { backgroundColor: colors.primary },
  row: { flexDirection: 'row', gap: spacing.sm },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderColor: colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '800' },
});
