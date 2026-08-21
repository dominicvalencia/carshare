import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';

interface ClaimView {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly status: string;
  readonly responseDeadlineAt: string | null;
  readonly booking: { publicReference: string };
  readonly response: { decision: string; explanation: string | null } | null;
  readonly evidence: readonly { id: string; participantRole: string; evidenceType: string }[];
  readonly calculations: readonly { amountMinor: number; formulaVersion: string }[];
  readonly adjudications: readonly {
    approvedAmountMinor: number;
    outcome: string;
    reason: string;
  }[];
  readonly additionalCharge: {
    id: string;
    approvedAmountMinor: number;
    status: string;
    payment: { customerActionUrl: string | null; status: string } | null;
  } | null;
}

interface ClaimsResponse {
  readonly items: readonly ClaimView[];
}

export function RenterClaimsPanel({ bookingReference }: { readonly bookingReference: string }) {
  const client = useQueryClient();
  const claims = useQuery({
    queryKey: ['renter-claims'],
    queryFn: () => apiClient.request<ClaimsResponse>('/claims'),
  });
  const respond = useMutation({
    mutationFn: ({
      claimId,
      decision,
    }: {
      claimId: string;
      decision: 'ACKNOWLEDGED' | 'DISPUTED';
    }) =>
      apiClient.request(`/claims/${claimId}/respond`, {
        body: JSON.stringify({
          decision,
          ...(decision === 'DISPUTED'
            ? { explanation: 'I dispute responsibility and request administrator review.' }
            : {}),
        }),
        method: 'POST',
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['renter-claims'] }),
  });
  const pay = useMutation({
    mutationFn: (chargeId: string) =>
      apiClient.request<{ payment: { customerActionUrl: string | null } | null }>(
        `/additional-charges/${chargeId}/payment`,
        { method: 'POST' },
      ),
    onSuccess: async (result) => {
      if (result.payment?.customerActionUrl)
        await Linking.openURL(result.payment.customerActionUrl);
      void client.invalidateQueries({ queryKey: ['renter-claims'] });
    },
  });
  const items = claims.data?.items.filter(
    (claim) => claim.booking.publicReference === bookingReference,
  );
  if (!items?.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Post-return claims</Text>
      {items.map((claim) => (
        <ClaimCard key={claim.id} claim={claim}>
          {claim.status === 'RENTER_REVIEW' && !claim.response && (
            <>
              <Action
                label="Acknowledge measured facts"
                onPress={() => respond.mutate({ claimId: claim.id, decision: 'ACKNOWLEDGED' })}
              />
              <Secondary
                label="Dispute responsibility"
                onPress={() => respond.mutate({ claimId: claim.id, decision: 'DISPUTED' })}
              />
            </>
          )}
          {claim.additionalCharge &&
            ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(claim.additionalCharge.status) && (
              <Action
                label={
                  claim.additionalCharge.status === 'PAYMENT_FAILED'
                    ? 'Retry approved payment'
                    : 'Authorize approved payment'
                }
                onPress={() => pay.mutate(claim.additionalCharge!.id)}
              />
            )}
          {claim.additionalCharge?.status === 'PROCESSING' && (
            <Text style={styles.notice}>
              Payment is processing. You have not yet been marked as charged.
            </Text>
          )}
        </ClaimCard>
      ))}
      {(respond.isError || pay.isError) && (
        <Text style={styles.error}>{respond.error?.message ?? pay.error?.message}</Text>
      )}
    </View>
  );
}

export function OwnerClaimsPanel({ bookingReference }: { readonly bookingReference: string }) {
  const claims = useQuery({
    queryKey: ['owner-claims'],
    queryFn: () => apiClient.request<ClaimsResponse>('/owner/claims'),
  });
  const items = claims.data?.items.filter(
    (claim) => claim.booking.publicReference === bookingReference,
  );
  if (!items?.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Claims and adjustments</Text>
      {items.map((claim) => (
        <ClaimCard key={claim.id} claim={claim}>
          <Text style={styles.body}>
            {claim.response
              ? `Renter response: ${claim.response.decision.replaceAll('_', ' ')}`
              : 'Awaiting renter response or response deadline.'}
          </Text>
          <Text style={styles.notice}>
            The platform—not the owner—calculates and approves every charge.
          </Text>
        </ClaimCard>
      ))}
    </View>
  );
}

function ClaimCard({
  claim,
  children,
}: {
  readonly claim: ClaimView;
  readonly children?: React.ReactNode;
}) {
  const latestCalculation = claim.calculations.at(-1);
  const latestDecision = claim.adjudications.at(-1);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{claim.category.replaceAll('_', ' ')}</Text>
      <Text style={styles.status}>{claim.status.replaceAll('_', ' ')}</Text>
      <Text style={styles.body}>{claim.description}</Text>
      <Text style={styles.body}>
        Platform calculation: {money(latestCalculation?.amountMinor ?? 0)} · evidence{' '}
        {claim.evidence.length}
      </Text>
      {latestDecision && (
        <Text style={styles.body}>
          Admin decision: {latestDecision.outcome.replaceAll('_', ' ')} ·{' '}
          {money(latestDecision.approvedAmountMinor)}
        </Text>
      )}
      {claim.responseDeadlineAt && claim.status === 'RENTER_REVIEW' && (
        <Text style={styles.body}>
          Respond by {new Date(claim.responseDeadlineAt).toLocaleString()}
        </Text>
      )}
      {claim.additionalCharge && (
        <Text style={styles.amount}>
          {money(claim.additionalCharge.approvedAmountMinor)} ·{' '}
          {claim.additionalCharge.status.replaceAll('_', ' ')}
        </Text>
      )}
      {children}
    </View>
  );
}

function Action({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Secondary({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable style={styles.secondary} onPress={onPress}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function money(amountMinor: number) {
  return `₱${(amountMinor / 100).toLocaleString()}`;
}

const styles = StyleSheet.create({
  amount: { color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: spacing.sm },
  body: { color: colors.subtleText, lineHeight: 20, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
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
  error: { color: '#A12626', marginTop: spacing.md },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  notice: { color: '#74530C', lineHeight: 20, marginTop: spacing.sm },
  secondary: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  section: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
});
