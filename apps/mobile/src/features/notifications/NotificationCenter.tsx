import { useState } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { internalDestination } from '../../navigation/deep-links';
import Constants from 'expo-constants';
import type { RootStackParamList } from '../../navigation/routes';
import type { MobileMode } from '../../navigation/routes';
import { colors, radius, spacing } from '../../theme/tokens';
import { relativeTime } from '../../ui/format';
import { Button, Card, Icon, NestedScreen, StateView } from '../../ui/primitives';

interface NotificationItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly deepLink: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
  readonly category?: string;
}
export function NotificationCenter({ mode }: { readonly mode: MobileMode }) {
  const client = useQueryClient();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [openError, setOpenError] = useState('');
  const notifications = useQuery({
    queryKey: ['notifications', mode],
    queryFn: () =>
      apiClient.request<{ items: NotificationItem[] }>(
        `/notifications?limit=50&audience=${mode.toUpperCase()}`,
      ),
    refetchInterval: 15_000,
  });
  const readAll = useMutation({
    mutationFn: () =>
      apiClient.request(`/notifications/read-all?audience=${mode.toUpperCase()}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
      void client.invalidateQueries({ queryKey: ['notification-summary'] });
    },
  });
  async function open(item: NotificationItem) {
    setOpenError('');
    try {
      const result = await apiClient.request<{ deepLink: string | null }>(
        `/notifications/${item.id}/opened`,
        { method: 'POST' },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['notifications'] }),
        client.invalidateQueries({ queryKey: ['notification-summary'] }),
      ]);
      if (result.deepLink) {
        const destination = internalDestination(
          result.deepLink,
          Constants.expoConfig?.extra?.appScheme ?? 'carrental',
        );
        if (!destination) {
          setOpenError('This notification target is no longer available.');
          return;
        }
        switch (destination.name) {
          case 'Booking':
            navigation.navigate('Booking', destination.params);
            break;
          case 'Conversation':
            navigation.navigate('Conversation', destination.params);
            break;
          case 'Claim':
            navigation.navigate('Claim', destination.params);
            break;
          case 'Support':
            navigation.navigate('Support', destination.params);
            break;
          case 'Payout':
            navigation.navigate('Payout', destination.params);
            break;
          case 'OwnerEarnings':
            navigation.navigate('OwnerEarnings');
            break;
          case 'Notifications':
            break;
          default:
            setOpenError('This notification target is not available in the current app version.');
        }
      }
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'Could not open this notification.');
    }
  }
  const unread = notifications.data?.items.filter((item) => !item.readAt).length ?? 0;
  return (
    <NestedScreen
      backLabel="Back"
      eyebrow="Updates"
      title="Notifications"
      subtitle={
        unread ? `${unread} unread update${unread === 1 ? '' : 's'}` : "You're all caught up."
      }
      action={
        unread ? (
          <Button
            disabled={readAll.isPending}
            label={readAll.isPending ? 'Clearing…' : 'Read all'}
            onPress={() => readAll.mutate()}
            variant="ghost"
          />
        ) : undefined
      }
    >
      {(openError || readAll.isError) && (
        <Text style={styles.error}>{openError || readAll.error?.message}</Text>
      )}
      {notifications.isPending && <StateView loading title="Loading notifications…" />}
      {notifications.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Notifications unavailable"
          message={notifications.error.message}
          actionLabel="Retry"
          onAction={() => void notifications.refetch()}
        />
      )}
      {notifications.data?.items.length === 0 && (
        <StateView
          icon="notifications-outline"
          title="You're all caught up"
          message="Booking, rental, payment and support updates will appear here."
        />
      )}
      {notifications.data?.items.map((item) => (
        <Pressable accessibilityRole="button" key={item.id} onPress={() => void open(item)}>
          <Card style={[styles.item, !item.readAt && styles.unread]}>
            <View style={[styles.icon, !item.readAt && styles.iconUnread]}>
              <Icon color={colors.primary} name={notificationIcon(item.category)} />
            </View>
            <View style={styles.flex}>
              <View style={styles.row}>
                <Text numberOfLines={1} style={styles.title}>
                  {item.title}
                </Text>
                {!item.readAt && <View accessibilityLabel="Unread" style={styles.dot} />}
              </View>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
            </View>
            <Icon color={colors.subtleText} name="chevron-forward" size={18} />
          </Card>
        </Pressable>
      ))}
    </NestedScreen>
  );
}
function notificationIcon(category?: string): Parameters<typeof Icon>[0]['name'] {
  if (category === 'PAYMENT') return 'card-outline';
  if (category === 'MESSAGE') return 'chatbubble-outline';
  if (category === 'SUPPORT') return 'help-circle-outline';
  if (category === 'RENTAL') return 'key-outline';
  return 'notifications-outline';
}
const styles = StyleSheet.create({
  body: { color: colors.subtleText, lineHeight: 20, marginTop: 3 },
  dot: { backgroundColor: colors.primary, borderRadius: radius.pill, height: 8, width: 8 },
  error: { color: colors.danger },
  flex: { flex: 1, minWidth: 0 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconUnread: { backgroundColor: colors.primarySoft },
  item: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  time: { color: colors.subtleText, fontSize: 11, marginTop: spacing.xs },
  title: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '800' },
  unread: { borderColor: colors.primary },
});
