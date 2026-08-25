import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { dateTimeLabel, domainLabel } from '../../ui/format';
export function ReviewPanel({ bookingReference }: { readonly bookingReference: string }) {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);
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
    mutationFn: (type: string) =>
      apiClient.request(`/bookings/${bookingReference}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ type, rating, categoryRatings: { overall: rating }, text }),
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
      <View style={styles.row}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable key={value} onPress={() => setRating(value)}>
            <Text style={[styles.star, value <= rating && styles.selected]}>★</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Optional review"
        multiline
        style={styles.input}
      />
      {eligibility.data.availableTypes.map((type) => (
        <Pressable key={type} style={styles.button} onPress={() => submit.mutate(type)}>
          <Text style={styles.buttonText}>Review {domainLabel(type).toLowerCase()}</Text>
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
  heading: { color: colors.ink, fontSize: 18, fontWeight: '800' },
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
});
