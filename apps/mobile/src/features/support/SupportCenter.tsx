import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { relativeTime, titleCase } from '../../ui/format';
import {
  Button,
  Card,
  Chip,
  Field,
  Icon,
  Screen,
  StateView,
  StatusBadge,
} from '../../ui/primitives';

interface Ticket {
  readonly id: string;
  readonly publicReference: string;
  readonly subject: string;
  readonly status: string;
  readonly category?: string;
  readonly updatedAt?: string;
}
interface TicketDetail extends Ticket {
  readonly messages: readonly {
    readonly id: string;
    readonly authorUserId: string;
    readonly body: string;
    readonly createdAt: string;
  }[];
}
type SupportView = 'home' | 'create' | 'detail';

export function SupportCenter() {
  const client = useQueryClient();
  const [view, setView] = useState<SupportView>('home');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const tickets = useQuery({
    queryKey: ['support-tickets'],
    queryFn: () => apiClient.request<Ticket[]>('/support/tickets'),
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ['support-ticket', selected],
    queryFn: () => apiClient.request<TicketDetail>(`/support/tickets/${selected}`),
  });
  const create = useMutation({
    mutationFn: () =>
      apiClient.request<Ticket>('/support/tickets', {
        method: 'POST',
        headers: { 'Idempotency-Key': `support-${Date.now()}` },
        body: JSON.stringify({ category, subject, message }),
      }),
    onSuccess: (ticket) => {
      setSubject('');
      setMessage('');
      setSelected(ticket.publicReference);
      setView('detail');
      void client.invalidateQueries({ queryKey: ['support-tickets'] });
    },
  });
  const sendReply = useMutation({
    mutationFn: () =>
      apiClient.request(`/support/tickets/${selected}/messages`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `support-reply-${Date.now()}` },
        body: JSON.stringify({ body: reply }),
      }),
    onSuccess: () => {
      setReply('');
      void client.invalidateQueries({ queryKey: ['support-ticket', selected] });
      void client.invalidateQueries({ queryKey: ['support-tickets'] });
    },
  });
  if (view === 'create')
    return (
      <Screen
        eyebrow="Help & support"
        title="Create a ticket"
        subtitle="Tell us what happened and our support team will reply here."
      >
        <Button
          icon="arrow-back"
          label="Support home"
          onPress={() => setView('home')}
          variant="ghost"
        />
        <Text style={styles.label}>What can we help with?</Text>
        <View style={styles.chips}>
          {['BOOKING', 'PAYMENT', 'RENTAL', 'CLAIM', 'OTHER'].map((value) => (
            <Chip
              key={value}
              label={titleCase(value)}
              selected={category === value}
              onPress={() => setCategory(value)}
            />
          ))}
        </View>
        <Field
          label="Subject"
          value={subject}
          onChangeText={setSubject}
          placeholder="A short summary"
        />
        <Field
          label="Describe the issue"
          value={message}
          onChangeText={setMessage}
          placeholder="Include helpful details, but never share passwords or payment credentials."
          multiline
        />
        <Button
          disabled={subject.trim().length < 3 || message.trim().length < 3 || create.isPending}
          label={create.isPending ? 'Sending…' : 'Submit ticket'}
          onPress={() => create.mutate()}
        />
        {create.isError && <Text style={styles.error}>{create.error.message}</Text>}
      </Screen>
    );
  if (view === 'detail' && selected)
    return (
      <Screen
        eyebrow={detail.data?.publicReference ?? 'Support ticket'}
        title={detail.data?.subject ?? 'Ticket detail'}
        action={
          detail.data ? (
            <StatusBadge
              label={titleCase(detail.data.status)}
              tone={detail.data.status === 'CLOSED' ? 'neutral' : 'success'}
            />
          ) : undefined
        }
      >
        <Button
          icon="arrow-back"
          label="Ticket history"
          onPress={() => {
            setView('home');
            setSelected(null);
          }}
          variant="ghost"
        />
        {detail.isPending && <StateView loading title="Loading ticket…" />}
        {detail.isError && (
          <StateView
            icon="cloud-offline-outline"
            title="Ticket unavailable"
            message={detail.error.message}
          />
        )}
        {detail.data?.messages.map((item) => (
          <Card key={item.id}>
            <Text style={styles.message}>{item.body}</Text>
            <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
          </Card>
        ))}
        {detail.data && detail.data.status !== 'CLOSED' ? (
          <>
            <Field
              label="Reply"
              value={reply}
              onChangeText={setReply}
              placeholder="Write a reply"
              multiline
            />
            <Button
              disabled={!reply.trim() || sendReply.isPending}
              label={sendReply.isPending ? 'Sending…' : 'Send reply'}
              onPress={() => sendReply.mutate()}
            />
            {sendReply.isError && <Text style={styles.error}>{sendReply.error.message}</Text>}
          </>
        ) : detail.data ? (
          <StateView
            icon="checkmark-circle-outline"
            title="This ticket is closed"
            message="Create a new ticket if you need help with something else."
          />
        ) : null}
      </Screen>
    );
  return (
    <Screen
      eyebrow="Customer care"
      title="Help & support"
      subtitle="Find answers or contact the support team."
    >
      <Card style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon color={colors.primary} name="headset-outline" size={30} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.body}>
            For urgent pickup or active-rental safety issues, include your booking reference.
          </Text>
        </View>
      </Card>
      <Button
        icon="add-circle-outline"
        label="Create support ticket"
        onPress={() => setView('create')}
      />
      <Text style={styles.sectionTitle}>Ticket history</Text>
      {tickets.isPending && <StateView loading title="Loading tickets…" />}
      {tickets.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Support unavailable"
          message={tickets.error.message}
          actionLabel="Retry"
          onAction={() => void tickets.refetch()}
        />
      )}
      {tickets.data?.length === 0 && (
        <StateView
          icon="file-tray-outline"
          title="No support tickets"
          message="Tickets you create will appear here with their replies and status."
        />
      )}
      {tickets.data?.map((ticket) => (
        <Pressable
          accessibilityRole="button"
          key={ticket.id}
          onPress={() => {
            setSelected(ticket.publicReference);
            setView('detail');
          }}
        >
          <Card style={styles.ticket}>
            <View style={styles.flex}>
              <Text style={styles.ticketTitle}>{ticket.subject}</Text>
              <Text style={styles.body}>
                {ticket.publicReference} ·{' '}
                {ticket.updatedAt ? relativeTime(ticket.updatedAt) : titleCase(ticket.category)}
              </Text>
            </View>
            <StatusBadge
              label={titleCase(ticket.status)}
              tone={ticket.status === 'CLOSED' ? 'neutral' : 'success'}
            />
            <Icon color={colors.subtleText} name="chevron-forward" size={18} />
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
const styles = StyleSheet.create({
  body: { color: colors.subtleText, lineHeight: 20, marginTop: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  error: { color: colors.danger },
  flex: { flex: 1, minWidth: 0 },
  hero: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 20,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  heroTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  label: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  message: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: spacing.sm },
  ticket: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  ticketTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  time: { color: colors.subtleText, fontSize: 11, marginTop: spacing.xs },
});
