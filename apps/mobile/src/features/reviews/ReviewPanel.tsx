import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { dateTimeLabel, domainLabel } from '../../ui/format';
export function ReviewPanel({ bookingReference }: { readonly bookingReference: string }) {
  const client = useQueryClient();
  const eligibility = useQuery({
    queryKey: ['review-eligibility', bookingReference],
    queryFn: () =>
      apiClient.request<{
        eligible: boolean;
        deadline: string | null;
        availableTypes: ('VEHICLE' | 'OWNER' | 'RENTER')[];
      }>(`/bookings/${bookingReference}/review-eligibility`),
  });
  const submit = useMutation({
    mutationFn: (input: {
      type: 'VEHICLE' | 'OWNER' | 'RENTER';
      rating: number;
      categoryRatings: Record<string, number>;
      text: string;
    }) =>
      apiClient.request(`/bookings/${bookingReference}/reviews`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ['review-eligibility', bookingReference] }),
  });
  if (!eligibility.data?.eligible) return null;
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Share your experience</Text>
      <Text style={styles.body}>
        Available until{' '}
        {eligibility.data.deadline
          ? dateTimeLabel(eligibility.data.deadline)
          : 'the review deadline'}
        .
      </Text>
      <Text style={styles.body}>
        Reviews remain private until both sides submit or the review window closes.
      </Text>
      {eligibility.data.availableTypes.map((type) => (
        <ReviewForm key={type} type={type} pending={submit.isPending} onSubmit={submit.mutate} />
      ))}
      {submit.isSuccess && (
        <Text style={styles.success}>
          Review saved. It will publish under the double-blind policy.
        </Text>
      )}
      {submit.isError && (
        <Text style={styles.error}>We couldn’t save this review. Please retry.</Text>
      )}
    </View>
  );
}

const categories = {
  VEHICLE: ['cleanliness', 'condition', 'accuracy'],
  OWNER: ['communication', 'handover', 'responsiveness'],
  RENTER: ['communication', 'cleanliness', 'punctuality'],
} as const;

function ReviewForm({
  type,
  pending,
  onSubmit,
}: {
  readonly type: keyof typeof categories;
  readonly pending: boolean;
  readonly onSubmit: (input: {
    type: keyof typeof categories;
    rating: number;
    categoryRatings: Record<string, number>;
    text: string;
  }) => void;
}) {
  const [rating, setRating] = useState(5);
  const [categoryRatings, setCategoryRatings] = useState<Record<string, number>>({});
  const [text, setText] = useState('');
  return (
    <View style={styles.form}>
      <Text style={styles.heading}>Review {domainLabel(type).toLowerCase()}</Text>
      <Text style={styles.body}>Overall rating (required)</Text>
      <Stars value={rating} onChange={setRating} />
      <Text style={styles.body}>Category ratings (optional)</Text>
      {categories[type].map((category) => (
        <View key={category} style={styles.category}>
          <Text style={styles.categoryLabel}>{domainLabel(category)}</Text>
          <Stars
            compact
            value={categoryRatings[category] ?? 0}
            onChange={(value) => setCategoryRatings({ ...categoryRatings, [category]: value })}
          />
        </View>
      ))}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Optional written review"
        multiline
        style={styles.input}
      />
      <Pressable
        disabled={pending}
        style={styles.button}
        onPress={() => onSubmit({ categoryRatings, rating, text, type })}
      >
        <Text style={styles.buttonText}>{pending ? 'Saving…' : 'Submit review'}</Text>
      </Pressable>
    </View>
  );
}

function Stars({
  value,
  onChange,
  compact = false,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly compact?: boolean;
}) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((option) => (
        <Pressable key={option} onPress={() => onChange(option)}>
          <Text
            style={[styles.star, compact && styles.compactStar, option <= value && styles.selected]}
          >
            ★
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  body: { color: colors.subtleText, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '800' },
  category: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  categoryLabel: { color: colors.ink, textTransform: 'capitalize' },
  compactStar: { fontSize: 20 },
  error: { color: colors.danger, marginTop: spacing.sm },
  heading: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  form: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 70,
    padding: spacing.md,
  },
  panel: {
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', marginTop: spacing.sm },
  selected: { color: '#E6A700' },
  star: { color: colors.border, fontSize: 28, marginRight: spacing.xs },
  success: { color: colors.primary, marginTop: spacing.sm },
});
