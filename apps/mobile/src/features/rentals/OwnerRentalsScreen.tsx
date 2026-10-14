import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import type { BookingView } from '../bookings/MyBookingsScreen';
import { BookingCancellationSheet } from '../bookings/BookingCancellationSheet';
import { colors, spacing } from '../../theme/tokens';
import { OwnerRentalPanel } from './RentalOperationsPanels';
import { OwnerClaimsPanel } from '../claims/ClaimsPanels';
import { ReviewPanel } from '../reviews/ReviewPanel';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/routes';
import { bookingStatusLabel, dateTimeLabel } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import { Button, Card, NestedScreen, StateView, StatusBadge } from '../../ui/primitives';
import type { OwnerWorkspace } from '../../auth/auth.types';
import { hasOwnerPermission } from '../../navigation/owner-workspace';

const operational = new Set([
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
]);

export function OwnerRentalsScreen({
  initialBookingReference,
  onClose,
  ownerWorkspace,
}: {
  readonly initialBookingReference?: string;
  readonly onClose?: () => void;
  readonly ownerWorkspace?: OwnerWorkspace;
} = {}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const client = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetY = useRef(0);
  const scrollViewportHeight = useRef(0);
  const [selected, setSelected] = useState<string | null>(initialBookingReference ?? null);
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const workspaceKey = ownerWorkspace?.ownerProfileId ?? 'owner';
  const rentals = useQuery({
    queryKey: ['owner-workspace', workspaceKey, 'rentals'],
    queryFn: () =>
      apiClient.request<BookingView[]>(
        ownerWorkspace
          ? `/owner/workspaces/${ownerWorkspace.ownerProfileId}/rentals`
          : '/owner/bookings/requests',
      ),
    refetchInterval: selected ? 5_000 : false,
  });
  useRefreshOnFocusAndForeground(() => void rentals.refetch());
  const selectedBooking = rentals.data?.find(({ publicReference }) => publicReference === selected);
  const items = (rentals.data ?? []).filter(({ status }) => operational.has(status));
  return (
    <NestedScreen
      compactNestedHeader
      constrainOverscroll
      contentTopPadding={spacing.sm}
      scrollRef={scrollRef}
      onScroll={({ nativeEvent }) => {
        scrollOffsetY.current = nativeEvent.contentOffset.y;
      }}
      onScrollLayout={({ nativeEvent }) => {
        scrollViewportHeight.current = nativeEvent.layout.height;
      }}
      onContentSizeChange={(_width, height) => {
        const maximumOffset = Math.max(0, height - scrollViewportHeight.current);
        if (scrollOffsetY.current > maximumOffset) {
          scrollOffsetY.current = maximumOffset;
          scrollRef.current?.scrollTo({ animated: false, y: maximumOffset });
        }
      }}
      backLabel="Back"
      onBack={
        selected
          ? () => {
              void rentals.refetch();
              if (onClose) onClose();
              else setSelected(null);
            }
          : undefined
      }
      eyebrow={ownerWorkspace ? 'Staff mode' : 'Owner mode'}
      title="Active rentals"
      subtitle="Pickup, return, claims, and renter coordination in one place."
    >
      {selected ? (
        <>
          <OwnerRentalPanel
            {...(ownerWorkspace ? { ownerWorkspace } : {})}
            {...(selectedBooking?.conversationId
              ? {
                  onOpenConversation: () =>
                    navigation.navigate('Conversation', {
                      conversationId: selectedBooking.conversationId!,
                    }),
                }
              : {})}
            reference={selected}
            scrollConditionFormBy={(delta) =>
              scrollRef.current?.scrollTo({ animated: true, y: scrollOffsetY.current + delta })
            }
            scrollToConditionForm={(y) => scrollRef.current?.scrollTo({ animated: true, y })}
          />
          {(!ownerWorkspace || hasOwnerPermission(ownerWorkspace, 'claims.view')) && (
            <OwnerClaimsPanel
              bookingReference={selected}
              {...(ownerWorkspace ? { ownerWorkspace } : {})}
            />
          )}
          {!ownerWorkspace &&
            selectedBooking &&
            ['CONFIRMED', 'READY_FOR_PICKUP'].includes(selectedBooking.status) && (
              <Card style={styles.dangerZone}>
                <Text style={styles.dangerEyebrow}>Danger zone</Text>
                <Text style={styles.dangerTitle}>Cancel booking</Text>
                <Text style={styles.dangerCopy}>
                  Only cancel when necessary. Existing cancellation rules still apply.
                </Text>
                <Button
                  label="Cancel booking"
                  onPress={() => setCancellationOpen(true)}
                  variant="danger"
                />
              </Card>
            )}
          {!ownerWorkspace && selectedBooking && (
            <BookingCancellationSheet
              bookingReference={selectedBooking.publicReference}
              onClose={() => setCancellationOpen(false)}
              onCompleted={() => {
                void rentals.refetch();
                void client.invalidateQueries({ queryKey: ['owner-booking-requests'] });
                void client.invalidateQueries({ queryKey: ['owner-booking', selected] });
                void client.invalidateQueries({ queryKey: ['owner-earnings'] });
                void client.invalidateQueries({ queryKey: ['public-search'] });
              }}
              role="OWNER"
              visible={cancellationOpen}
            />
          )}
          {!ownerWorkspace && selectedBooking?.status === 'COMPLETED' && (
            <ReviewPanel bookingReference={selected} />
          )}
        </>
      ) : (
        <>
          {rentals.isPending && <StateView loading title="Loading rentals…" />}
          {rentals.isError && (
            <StateView
              icon="cloud-offline-outline"
              title="Rentals unavailable"
              message={rentals.error.message}
              actionLabel="Retry"
              onAction={() => void rentals.refetch()}
            />
          )}
          {!rentals.isPending && !rentals.isError && items.length === 0 && (
            <StateView
              icon="key-outline"
              title="No active rentals"
              message="Confirmed bookings will appear here as pickup approaches."
            />
          )}
          {items.map((booking) => (
            <Pressable
              key={booking.publicReference}
              onPress={() => setSelected(booking.publicReference)}
            >
              <Card style={styles.card}>
                <VehicleImage
                  contentPath={booking.vehicle.coverPhoto?.contentPath}
                  style={styles.image}
                />
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>
                    {booking.vehicle.make} {booking.vehicle.model}
                  </Text>
                  <StatusBadge
                    label={
                      booking.workflowCompliance?.start.overdue
                        ? 'Handover overdue'
                        : booking.workflowCompliance?.return.overdue
                          ? 'Return process overdue'
                          : bookingStatusLabel(booking.status)
                    }
                  />
                  <Text style={styles.body}>Pickup {dateTimeLabel(booking.rentalStart)}</Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </NestedScreen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, marginTop: spacing.xs },
  card: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  dangerCopy: { color: colors.subtleText, lineHeight: 20 },
  dangerEyebrow: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  dangerTitle: { color: colors.danger, fontSize: 17, fontWeight: '800' },
  dangerZone: { borderColor: colors.dangerSoft, gap: spacing.sm, marginTop: spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  image: { borderRadius: 12, height: 92, width: 92 },
  link: { color: colors.primary, fontWeight: '700', marginTop: spacing.md },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
