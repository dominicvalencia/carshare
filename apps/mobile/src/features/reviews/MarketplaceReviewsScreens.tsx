import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import type { RootStackParamList } from '../../navigation/routes';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { colors, spacing } from '../../theme/tokens';
import { dateTimeLabel, money } from '../../ui/format';
import { BackControl, Button, Card, Screen, StateView } from '../../ui/primitives';
import { VehicleImage } from '../../ui/VehicleImage';

interface ReviewItem {
  readonly id: string;
  readonly rating: number;
  readonly text: string | null;
  readonly createdAt: string;
  readonly categoryRatings: Record<string, number>;
  readonly author: { profile: { firstName: string | null } | null };
}
interface ReviewPage {
  readonly aggregate: { averageRating: string; reviewCount: number };
  readonly items: readonly ReviewItem[];
  readonly pageInfo: { hasNextPage: boolean; nextCursor: string | null };
}

export function PublicReviewsScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'PublicReviews'>) {
  const reviews = useInfiniteQuery({
    queryKey: ['public-reviews', route.params.path],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiClient.request<ReviewPage>(
        `${route.params.path}?limit=10${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (page) => page.pageInfo.nextCursor ?? undefined,
  });
  useRefreshOnFocusAndForeground(() => void reviews.refetch());
  const items = reviews.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Screen
      scroll={false}
      leading={<BackControl onPress={navigation.goBack} />}
      title={route.params.title}
    >
      <FlatList
        contentContainerStyle={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (reviews.hasNextPage && !reviews.isFetchingNextPage) void reviews.fetchNextPage();
        }}
        onEndReachedThreshold={0.25}
        renderItem={({ item }) => (
          <Card>
            <Text style={styles.title}>
              ★ {item.rating} · {item.author.profile?.firstName ?? 'Guest'}
            </Text>
            {item.text ? <Text style={styles.body}>{item.text}</Text> : null}
            <Text style={styles.note}>
              {Object.entries(item.categoryRatings)
                .map(([key, value]) => `${key} ${value}`)
                .join(' · ')}
            </Text>
            <Text style={styles.note}>{dateTimeLabel(item.createdAt)}</Text>
          </Card>
        )}
        ListEmptyComponent={
          reviews.isPending ? (
            <StateView loading title="Loading reviews…" />
          ) : (
            <StateView title="No reviews yet" message="Published reviews will appear here." />
          )
        }
        ListFooterComponent={
          reviews.isFetchingNextPage ? <StateView loading title="Loading more reviews…" /> : null
        }
      />
    </Screen>
  );
}

interface HostProfile {
  readonly displayName: string;
  readonly memberSince: string;
  readonly publicReference: string;
  readonly completedRentalCount: number;
  readonly rating: { averageRating: string | null; reviewCount: number };
  readonly categoryAverages: Record<string, number>;
  readonly availableVehicles: readonly {
    vehicleId: string;
    year: number;
    make: string;
    model: string;
    currency: string;
    dailyRateMinor: number;
    coverPhoto: { contentPath: string };
  }[];
}

export function HostProfileScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'HostProfile'>) {
  const profile = useQuery({
    queryKey: ['public-host', route.params.hostReference],
    queryFn: () => apiClient.request<HostProfile>(`/hosts/${route.params.hostReference}`),
  });
  useRefreshOnFocusAndForeground(() => void profile.refetch());
  if (profile.isPending)
    return (
      <Screen leading={<BackControl onPress={navigation.goBack} />} title="Host profile">
        <StateView loading title="Loading host…" />
      </Screen>
    );
  if (profile.isError || !profile.data)
    return (
      <Screen leading={<BackControl onPress={navigation.goBack} />} title="Host profile">
        <StateView
          title="Host unavailable"
          message={profile.error?.message ?? 'Try again later.'}
        />
      </Screen>
    );
  const host = profile.data;
  return (
    <Screen
      leading={<BackControl onPress={navigation.goBack} />}
      eyebrow="Verified host"
      title={host.displayName}
      subtitle={`Member since ${new Date(host.memberSince).getFullYear()}`}
    >
      <Card>
        <Text style={styles.title}>
          {host.rating.averageRating ? `★ ${host.rating.averageRating}` : 'New host'} ·{' '}
          {host.rating.reviewCount} reviews
        </Text>
        <Text style={styles.body}>{host.completedRentalCount} completed rentals</Text>
        {Object.keys(host.categoryAverages).length ? (
          <Text style={styles.note}>
            {Object.entries(host.categoryAverages)
              .map(([key, value]) => `${key} ${value}`)
              .join(' · ')}
          </Text>
        ) : null}
        <Button
          label="Read host reviews"
          onPress={() =>
            navigation.navigate('PublicReviews', {
              path: `/hosts/${host.publicReference}/reviews`,
              title: `${host.displayName} reviews`,
            })
          }
          variant="secondary"
        />
      </Card>
      <Text style={styles.heading}>Available vehicles</Text>
      {host.availableVehicles.map((vehicle) => (
        <Pressable
          key={vehicle.vehicleId}
          onPress={() => navigation.navigate('VehicleDetails', { vehicleId: vehicle.vehicleId })}
        >
          <Card style={styles.vehicle}>
            <VehicleImage contentPath={vehicle.coverPhoto.contentPath} style={styles.image} />
            <View style={styles.flex}>
              <Text style={styles.title}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </Text>
              <Text style={styles.body}>
                {money(vehicle.dailyRateMinor, vehicle.currency)} / day
              </Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, marginTop: spacing.xs },
  flex: { flex: 1 },
  heading: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: spacing.lg },
  image: { borderRadius: 10, height: 72, width: 96 },
  list: { gap: spacing.md, paddingBottom: spacing.xl },
  note: { color: colors.subtleText, fontSize: 12, marginTop: spacing.sm },
  title: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  vehicle: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
