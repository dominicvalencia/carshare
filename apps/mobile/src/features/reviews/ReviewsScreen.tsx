import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { dateLabel, titleCase } from '../../ui/format';
import { Card, NestedScreen, SectionHeader, StateView, StatusBadge } from '../../ui/primitives';

interface ReviewItem {
  readonly id: string;
  readonly type: string;
  readonly rating: number;
  readonly text: string | null;
  readonly moderationStatus: string;
  readonly createdAt: string;
  readonly booking: {
    readonly publicReference: string;
    readonly vehicle: { readonly make: string; readonly model: string; readonly modelYear: number };
  };
  readonly author?: { readonly profile: { readonly firstName: string | null } | null };
}

interface ReviewsResponse {
  readonly written: readonly ReviewItem[];
  readonly received: readonly ReviewItem[];
  readonly pending: readonly {
    bookingReference: string;
    deadline: string;
    availableTypes: readonly string[];
    vehicle: { make: string; model: string; modelYear: number };
  }[];
}

export function ReviewsScreen() {
  const reviews = useQuery({
    queryKey: ['my-reviews'],
    queryFn: () => apiClient.request<ReviewsResponse>('/me/reviews'),
  });
  return (
    <NestedScreen
      backLabel="Back to profile"
      eyebrow="Your account"
      title="Reviews"
      subtitle="Reviews connected to rentals on your account."
    >
      {reviews.isPending && <StateView loading title="Loading reviews…" />}
      {reviews.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Reviews unavailable"
          message={reviews.error.message}
          actionLabel="Retry"
          onAction={() => void reviews.refetch()}
        />
      )}
      {reviews.data &&
        reviews.data.pending.length + reviews.data.written.length + reviews.data.received.length ===
          0 && (
          <StateView
            icon="star-outline"
            title="No reviews yet"
            message="After a completed rental, eligible reviews and published feedback appear here."
          />
        )}
      {reviews.data && reviews.data.pending.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Ready to review" />
          {reviews.data.pending.map((item) => (
            <Card key={item.bookingReference}>
              <Text style={styles.title}>{vehicleName(item.vehicle)}</Text>
              <Text style={styles.body}>
                {item.availableTypes.map(titleCase).join(' and ')} · by {dateLabel(item.deadline)}
              </Text>
              <Text style={styles.reference}>{item.bookingReference}</Text>
            </Card>
          ))}
        </View>
      )}
      {reviews.data && reviews.data.written.length > 0 && (
        <ReviewSection items={reviews.data.written} title="Written by you" />
      )}
      {reviews.data && reviews.data.received.length > 0 && (
        <ReviewSection items={reviews.data.received} title="Received" />
      )}
    </NestedScreen>
  );
}

function ReviewSection({
  items,
  title,
}: {
  readonly items: readonly ReviewItem[];
  readonly title: string;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      {items.map((item) => (
        <Card key={item.id}>
          <View style={styles.row}>
            <Text accessibilityLabel={`${item.rating} out of 5 stars`} style={styles.rating}>
              {'★'.repeat(item.rating)}
              {'☆'.repeat(5 - item.rating)}
            </Text>
            <StatusBadge label={titleCase(item.type)} />
          </View>
          <Text style={styles.title}>{vehicleName(item.booking.vehicle)}</Text>
          {item.text && <Text style={styles.body}>{item.text}</Text>}
          <Text style={styles.reference}>
            {dateLabel(item.createdAt)} · {item.booking.publicReference}
          </Text>
        </Card>
      ))}
    </View>
  );
}

function vehicleName(vehicle: { make: string; model: string; modelYear: number }): string {
  return `${vehicle.modelYear} ${vehicle.make} ${vehicle.model}`;
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  rating: { color: colors.warning, fontSize: 18, letterSpacing: 1 },
  reference: { color: colors.subtleText, fontSize: 12, marginTop: spacing.sm },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  section: { gap: spacing.sm },
  title: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: spacing.xs },
});
