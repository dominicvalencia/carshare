import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiClient } from '../../auth/api-client';
import { useAuth } from '../../auth/AuthProvider';
import { colors, radius, spacing } from '../../theme/tokens';
import { bookingStatusLabel, relativeTime } from '../../ui/format';
import { Card, Icon, IconButton, Screen, StateView, StatusBadge } from '../../ui/primitives';

interface Person {
  readonly userId: string;
  readonly context: string;
  readonly user?: {
    readonly profile?: {
      readonly firstName?: string | null;
      readonly lastName?: string | null;
    } | null;
  };
}
interface Conversation {
  readonly id: string;
  readonly status?: string;
  readonly unreadCount: number;
  readonly participants?: readonly Person[];
  readonly booking: {
    readonly publicReference: string;
    readonly status: string;
    readonly vehicle: { readonly make: string | null; readonly model: string | null };
  };
  readonly messages: readonly Message[];
}
interface ConversationDetail extends Conversation {
  readonly canSend: boolean;
}
interface Message {
  readonly id: string;
  readonly senderUserId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly moderationStatus?: string;
}

export function MessagesScreen({
  initialConversationId,
}: {
  readonly initialConversationId?: string | undefined;
}) {
  const auth = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(initialConversationId ?? null);
  const [body, setBody] = useState('');
  const list = useRef<FlatList<Message>>(null);
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiClient.request<{ items: Conversation[] }>('/conversations?limit=50'),
    refetchInterval: 10_000,
  });
  const conversation = useQuery({
    enabled: Boolean(selected),
    queryKey: ['conversation', selected],
    queryFn: () => apiClient.request<ConversationDetail>(`/conversations/${selected}`),
    refetchInterval: 10_000,
  });
  const messages = useQuery({
    enabled: Boolean(selected),
    queryKey: ['messages', selected],
    queryFn: () =>
      apiClient.request<{ items: Message[] }>(`/conversations/${selected}/messages?limit=100`),
    refetchInterval: 5_000,
  });
  const send = useMutation({
    mutationFn: () =>
      apiClient.request<Message>(`/conversations/${selected}/messages`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setBody('');
      void client.invalidateQueries({ queryKey: ['messages', selected] });
      void client.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const latest = messages.data?.items.at(-1);
  const latestId = latest?.id;
  const latestSenderId = latest?.senderUserId;
  const currentUserId = auth.user?.id;
  useEffect(() => {
    if (latestId && latestSenderId !== currentUserId && selected) {
      void apiClient
        .request(`/conversations/${selected}/read`, {
          method: 'POST',
          body: JSON.stringify({ messageId: latestId }),
        })
        .then(() => client.invalidateQueries({ queryKey: ['conversations'] }));
    }
  }, [client, currentUserId, latestId, latestSenderId, selected]);
  if (selected) {
    const context = conversation.data?.booking;
    return (
      <Screen
        scroll={false}
        eyebrow={context?.publicReference ?? 'Booking conversation'}
        title={
          context
            ? `${context.vehicle.make ?? ''} ${context.vehicle.model ?? ''}`.trim() ||
              'Booking messages'
            : 'Booking messages'
        }
        action={
          <IconButton icon="close" label="Close conversation" onPress={() => setSelected(null)} />
        }
      >
        {messages.isPending && <StateView loading title="Loading messages…" />}
        {messages.isError && (
          <StateView
            icon="cloud-offline-outline"
            title="Messages unavailable"
            message={messages.error.message}
            actionLabel="Retry"
            onAction={() => void messages.refetch()}
          />
        )}
        {!messages.isPending && messages.data?.items.length === 0 && (
          <StateView
            icon="chatbubble-ellipses-outline"
            title="Start the conversation"
            message="Use booking messages for pickup and rental coordination."
          />
        )}
        <FlatList
          ref={list}
          data={messages.data?.items ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.senderUserId === auth.user?.id;
            return (
              <View style={[styles.bubbleWrap, mine ? styles.mineWrap : styles.theirWrap]}>
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={[styles.messageText, mine && styles.mineText]}>
                    {item.moderationStatus === 'REMOVED' ? 'Message removed' : item.body}
                  </Text>
                  <Text style={[styles.time, mine && styles.mineTime]}>
                    {relativeTime(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={74}
        >
          {conversation.data?.canSend === false ? (
            <View style={styles.readOnly}>
              <Icon color={colors.subtleText} name="lock-closed-outline" size={18} />
              <Text style={styles.readOnlyText}>
                This conversation is read-only because the booking messaging period has closed.
              </Text>
            </View>
          ) : (
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Message"
                maxLength={2000}
                multiline
                onChangeText={setBody}
                placeholder="Message about this booking"
                placeholderTextColor="#83908A"
                style={styles.input}
                value={body}
              />
              <IconButton
                icon={send.isPending ? 'hourglass-outline' : 'send'}
                label="Send message"
                onPress={() => {
                  if (body.trim() && !send.isPending) send.mutate();
                }}
              />
            </View>
          )}
          {send.isError && <Text style={styles.error}>{send.error.message}</Text>}
        </KeyboardAvoidingView>
      </Screen>
    );
  }
  return (
    <Screen
      scroll={false}
      eyebrow="Your inbox"
      title="Messages"
      subtitle="Coordinate securely with owners and renters for active bookings."
    >
      {conversations.isPending && <StateView loading title="Loading conversations…" />}
      {conversations.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Messages unavailable"
          message={conversations.error.message}
          actionLabel="Retry"
          onAction={() => void conversations.refetch()}
        />
      )}
      {!conversations.isPending && conversations.data?.items.length === 0 && (
        <StateView
          icon="chatbubbles-outline"
          title="No messages yet"
          message="Your conversations will appear here after you make or receive a booking request."
        />
      )}
      <FlatList
        data={conversations.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.conversationList}
        renderItem={({ item }) => {
          const other = participantName(item, auth.user?.id);
          const latestMessage = item.messages[0];
          return (
            <Pressable accessibilityRole="button" onPress={() => setSelected(item.id)}>
              <Card style={styles.conversation}>
                <View style={styles.avatar}>
                  <Icon color={colors.primary} name="person" />
                </View>
                <View style={styles.flex}>
                  <View style={styles.row}>
                    <Text numberOfLines={1} style={styles.name}>
                      {other}
                    </Text>
                    <Text style={styles.listTime}>
                      {latestMessage ? relativeTime(latestMessage.createdAt) : ''}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={styles.vehicle}>
                    {item.booking.vehicle.make} {item.booking.vehicle.model} ·{' '}
                    {bookingStatusLabel(item.booking.status)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.preview, item.unreadCount > 0 && styles.unreadPreview]}
                  >
                    {latestMessage?.body ?? 'No messages yet'}
                  </Text>
                </View>
                {item.unreadCount > 0 && (
                  <StatusBadge label={item.unreadCount > 99 ? '99+' : String(item.unreadCount)} />
                )}
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

function participantName(conversation: Conversation, currentUserId?: string) {
  const person = conversation.participants?.find((item) => item.userId !== currentUserId);
  const profile = person?.user?.profile;
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  return name || (person?.context === 'OWNER' ? 'Vehicle owner' : 'Booking participant');
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  bubble: {
    borderRadius: 18,
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleWrap: { flexDirection: 'row', marginVertical: spacing.xxs },
  composer: {
    alignItems: 'flex-end',
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  conversation: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  conversationList: { gap: spacing.sm, paddingBottom: 100 },
  error: { color: colors.danger, fontSize: 12, paddingBottom: spacing.xs },
  flex: { flex: 1, minWidth: 0 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    color: colors.ink,
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  listTime: { color: colors.subtleText, fontSize: 11 },
  messageList: { flexGrow: 1, paddingBottom: spacing.md, paddingTop: spacing.xs },
  messageText: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  mine: { backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  mineText: { color: colors.onPrimary },
  mineTime: { color: '#D7EFE5' },
  mineWrap: { justifyContent: 'flex-end' },
  name: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '800' },
  preview: { color: colors.subtleText, fontSize: 13, marginTop: 3 },
  readOnly: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  readOnlyText: { color: colors.subtleText, flex: 1, fontSize: 12, lineHeight: 18 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  theirWrap: { justifyContent: 'flex-start' },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 5 },
  time: { color: colors.subtleText, fontSize: 10, marginTop: spacing.xxs },
  unreadPreview: { color: colors.ink, fontWeight: '700' },
  vehicle: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 2 },
});
