import DateTimePicker from '@react-native-community/datetimepicker';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { LocationPicker } from '../../location/LocationPicker';
import type { CarShareLocation } from '../../location/booking-location-provider';
import { locationLabel } from '../../location/booking-location-provider';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { colors, spacing } from '../../theme/tokens';
import { dateTimeLabel, money } from '../../ui/format';
import { BackControl, Button, Card, Chip, Screen, StateView } from '../../ui/primitives';
import type { BookingView } from './MyBookingsScreen';
import {
  amendmentErrorMessage,
  amendmentStatusCopy,
  idempotencyKey,
  transientAmendmentStatuses,
  type AmendmentDetail,
  type AmendmentPreview,
} from './booking-amendment';

type Stage = 'EDIT' | 'REVIEW' | 'DETAIL';

export function BookingAmendmentSheet({
  booking,
  onClose,
  visible,
}: {
  readonly booking: BookingView;
  readonly onClose: () => void;
  readonly visible: boolean;
}) {
  const client = useQueryClient();
  const active = booking.status === 'ACTIVE';
  const restoredId =
    booking.latestAmendment &&
    !['APPLIED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'FAILED'].includes(
      booking.latestAmendment.status,
    )
      ? booking.latestAmendment.amendmentId
      : null;
  const [stage, setStage] = useState<Stage>(restoredId ? 'DETAIL' : 'EDIT');
  const [amendmentId, setAmendmentId] = useState<string | null>(restoredId);
  const [pickup, setPickup] = useState(new Date(booking.rentalStart));
  const [returnAt, setReturnAt] = useState(new Date(booking.rentalEnd));
  const [startMethod, setStartMethod] = useState(booking.fulfillment.startMethod);
  const [endMethod, setEndMethod] = useState(booking.fulfillment.endMethod);
  const [delivery, setDelivery] = useState<CarShareLocation>();
  const [collection, setCollection] = useState<CarShareLocation>();
  const [picker, setPicker] = useState<'pickup' | 'return' | null>(null);
  const [locationKind, setLocationKind] = useState<'delivery' | 'collection' | null>(null);
  const [preview, setPreview] = useState<AmendmentPreview | null>(null);
  const submitKey = useRef('');
  const payKey = useRef('');

  const detail = useQuery({
    enabled: visible && Boolean(amendmentId),
    queryKey: ['booking-amendment', booking.publicReference, amendmentId],
    queryFn: () =>
      apiClient.request<AmendmentDetail>(
        `/bookings/${booking.publicReference}/amendments/${amendmentId}`,
      ),
    refetchInterval: (query) =>
      query.state.data && transientAmendmentStatuses.has(query.state.data.status) ? 5_000 : false,
  });
  useRefreshOnFocusAndForeground(() => {
    if (visible && amendmentId) void detail.refetch();
  });

  const requestBody = useMemo(
    () => ({
      ...(active ? {} : { proposedPickupAt: pickup.toISOString() }),
      proposedReturnAt: returnAt.toISOString(),
      ...(active ? {} : { proposedStartMethod: startMethod }),
      ...(active ? {} : { proposedEndMethod: endMethod }),
      ...(delivery ? { proposedDeliveryDestination: delivery } : {}),
      ...(collection ? { proposedCollectionDestination: collection } : {}),
    }),
    [active, collection, delivery, endMethod, pickup, returnAt, startMethod],
  );
  const previewMutation = useMutation({
    mutationFn: () =>
      apiClient.request<AmendmentPreview>(
        `/bookings/${booking.publicReference}/amendment-preview`,
        { body: JSON.stringify(requestBody), method: 'POST' },
      ),
    onSuccess: (value) => {
      setPreview(value);
      setStage('REVIEW');
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('Review the latest change before submitting.');
      submitKey.current ||= idempotencyKey('submit-amendment', booking.publicReference);
      return apiClient.request<AmendmentDetail>(`/bookings/${booking.publicReference}/amendments`, {
        body: JSON.stringify({ previewToken: preview.previewToken }),
        headers: { 'Idempotency-Key': submitKey.current },
        method: 'POST',
      });
    },
    onError: (error) => {
      if (amendmentErrorMessage(error).includes('preview')) setStage('EDIT');
    },
    onSuccess: (value) => {
      setAmendmentId(value.amendmentId ?? value.amendmentReference ?? null);
      setStage('DETAIL');
      refresh(client, booking.publicReference);
    },
  });
  const withdraw = useMutation({
    mutationFn: () =>
      apiClient.request<AmendmentDetail>(
        `/bookings/${booking.publicReference}/amendments/${amendmentId}/withdraw`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void detail.refetch();
      refresh(client, booking.publicReference);
    },
  });
  const pay = useMutation({
    mutationFn: () => {
      payKey.current ||= idempotencyKey('pay-amendment', booking.publicReference);
      return apiClient.request<AmendmentDetail>(
        `/bookings/${booking.publicReference}/amendments/${amendmentId}/payment`,
        { headers: { 'Idempotency-Key': payKey.current }, method: 'POST' },
      );
    },
    onSuccess: () => {
      void detail.refetch();
      refresh(client, booking.publicReference);
    },
  });

  const close = () => {
    setPreview(null);
    onClose();
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="pageSheet"
      visible={visible}
    >
      {stage === 'EDIT' ? (
        <Screen
          leading={<BackControl label="Close" onPress={close} />}
          eyebrow="Booking change"
          title={active ? 'Extend Trip' : 'Change Booking'}
          subtitle={
            active
              ? 'Choose a later return time.'
              : 'Update the supported trip details, then review the live price.'
          }
        >
          {!active && (
            <DateControl label="Pickup" value={pickup} onPress={() => setPicker('pickup')} />
          )}
          <DateControl label="Return" value={returnAt} onPress={() => setPicker('return')} />
          {!active && (
            <>
              <Text accessibilityRole="header" style={styles.heading}>
                Receive the car
              </Text>
              <View style={styles.chips}>
                <Chip
                  label="Pick up"
                  selected={startMethod === 'RENTER_PICKUP'}
                  onPress={() => setStartMethod('RENTER_PICKUP')}
                />
                <Chip
                  label="Owner delivery"
                  selected={startMethod === 'OWNER_DELIVERY'}
                  onPress={() => setStartMethod('OWNER_DELIVERY')}
                />
              </View>
              {startMethod === 'OWNER_DELIVERY' && (
                <Button
                  label={
                    delivery
                      ? `Delivery: ${locationLabel(delivery)}`
                      : 'Choose delivery destination'
                  }
                  onPress={() => setLocationKind('delivery')}
                  variant="secondary"
                />
              )}
              <Text accessibilityRole="header" style={styles.heading}>
                Return the car
              </Text>
              <View style={styles.chips}>
                <Chip
                  label="Return it"
                  selected={endMethod === 'RENTER_RETURN'}
                  onPress={() => setEndMethod('RENTER_RETURN')}
                />
                <Chip
                  label="Owner collection"
                  selected={endMethod === 'OWNER_COLLECTION'}
                  onPress={() => setEndMethod('OWNER_COLLECTION')}
                />
              </View>
              {endMethod === 'OWNER_COLLECTION' && (
                <Button
                  label={
                    collection
                      ? `Collection: ${locationLabel(collection)}`
                      : 'Choose collection destination'
                  }
                  onPress={() => setLocationKind('collection')}
                  variant="secondary"
                />
              )}
            </>
          )}
          {previewMutation.isError && (
            <InlineError message={amendmentErrorMessage(previewMutation.error)} />
          )}
          <Button
            disabled={
              previewMutation.isPending ||
              returnAt <= (active ? new Date(booking.rentalEnd) : pickup)
            }
            label={previewMutation.isPending ? 'Checking availability and price…' : 'Review change'}
            onPress={() => previewMutation.mutate()}
          />
          {picker && (
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              minimumDate={
                picker === 'return' ? (active ? new Date(booking.rentalEnd) : pickup) : new Date()
              }
              mode="datetime"
              onChange={(_, value) => {
                if (value) (picker === 'pickup' ? setPickup : setReturnAt)(value);
                if (Platform.OS !== 'ios') setPicker(null);
              }}
              value={picker === 'pickup' ? pickup : returnAt}
            />
          )}
          {picker && Platform.OS === 'ios' && (
            <Button label="Done" onPress={() => setPicker(null)} variant="secondary" />
          )}
          <LocationPicker
            kind={locationKind ?? 'delivery'}
            visible={Boolean(locationKind)}
            initial={locationKind === 'delivery' ? delivery : collection}
            onCancel={() => setLocationKind(null)}
            onConfirm={(value) => {
              if (locationKind === 'delivery') setDelivery(value);
              else setCollection(value);
              setLocationKind(null);
            }}
          />
        </Screen>
      ) : stage === 'REVIEW' && preview ? (
        <Review
          active={active}
          error={submit.isError ? amendmentErrorMessage(submit.error) : null}
          pending={submit.isPending}
          preview={preview}
          onBack={() => setStage('EDIT')}
          onClose={close}
          onSubmit={() => submit.mutate()}
        />
      ) : (
        <AmendmentState
          amendment={detail.data}
          error={detail.error ?? withdraw.error ?? pay.error}
          loading={detail.isPending}
          paying={pay.isPending}
          withdrawing={withdraw.isPending}
          onClose={close}
          onPay={() => pay.mutate()}
          onRetry={() => void detail.refetch()}
          onWithdraw={() =>
            Alert.alert('Withdraw this request?', 'Your original booking will remain unchanged.', [
              { text: 'Keep request', style: 'cancel' },
              { text: 'Withdraw', style: 'destructive', onPress: () => withdraw.mutate() },
            ])
          }
        />
      )}
    </Modal>
  );
}

function Review({
  active,
  error,
  pending,
  preview,
  onBack,
  onClose,
  onSubmit,
}: {
  readonly active: boolean;
  readonly error: string | null;
  readonly pending: boolean;
  readonly preview: AmendmentPreview;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}) {
  const additional = Number(preview.financial.additionalPaymentMinor);
  const refund = Number(preview.financial.expectedRefundMinor);
  return (
    <Screen
      leading={<BackControl label="Edit change" onPress={onBack} />}
      eyebrow="Review change"
      title="Confirm your request"
      subtitle="The Owner must approve this change before it takes effect."
    >
      <Comparison
        current={preview.current}
        proposed={preview.proposed}
        currency={preview.financial.currency}
      />
      <Card>
        <Text style={styles.heading}>
          {additional > 0
            ? 'Additional payment required'
            : refund > 0
              ? 'Refund due'
              : 'No additional charge / no refund'}
        </Text>
        {additional > 0 && (
          <Row label="Amount to pay" value={money(additional, preview.financial.currency)} />
        )}
        {refund > 0 && (
          <Row label="Expected refund" value={money(refund, preview.financial.currency)} />
        )}
        <Row
          label="New total booking price"
          value={money(Number(preview.proposed.totalMinor), preview.financial.currency)}
        />
        <Text style={styles.body}>
          Price and availability are valid until {dateTimeLabel(preview.expiresAt)}.
        </Text>
        {active && (
          <Text style={styles.body}>
            Your original return time remains in effect until this extension is applied.
          </Text>
        )}
      </Card>
      {error && <InlineError message={error} />}
      <Button
        disabled={pending}
        label={pending ? 'Sending request…' : 'Request Owner approval'}
        onPress={onSubmit}
      />
      <Button label="Keep booking unchanged" onPress={onClose} variant="secondary" />
    </Screen>
  );
}

function AmendmentState({
  amendment,
  error,
  loading,
  paying,
  withdrawing,
  onClose,
  onPay,
  onRetry,
  onWithdraw,
}: {
  readonly amendment: AmendmentDetail | undefined;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly paying: boolean;
  readonly withdrawing: boolean;
  readonly onClose: () => void;
  readonly onPay: () => void;
  readonly onRetry: () => void;
  readonly onWithdraw: () => void;
}) {
  if (loading)
    return (
      <Screen leading={<BackControl label="Close" onPress={onClose} />} title="Booking change">
        <StateView loading title="Loading change request…" />
      </Screen>
    );
  if (error || !amendment)
    return (
      <Screen leading={<BackControl label="Close" onPress={onClose} />} title="Booking change">
        <StateView
          icon="cloud-offline-outline"
          title="Change request unavailable"
          message={error ? amendmentErrorMessage(error) : undefined}
          actionLabel="Retry"
          onAction={onRetry}
        />
      </Screen>
    );
  const [title, copy] = amendmentStatusCopy(amendment);
  const additional = Number(amendment.financial.additionalPaymentMinor);
  const refund = Number(amendment.financial.expectedRefundMinor);
  return (
    <Screen
      leading={<BackControl label="Close" onPress={onClose} />}
      eyebrow="Booking change"
      title={title}
      subtitle={copy}
    >
      <Comparison
        current={amendment.current}
        proposed={amendment.proposed}
        currency={amendment.financial.currency}
      />
      <Card>
        {additional > 0 && (
          <Row label="Additional payment" value={money(additional, amendment.financial.currency)} />
        )}
        {refund > 0 && (
          <Row label="Expected refund" value={money(refund, amendment.financial.currency)} />
        )}
        {amendment.paymentDeadlineAt && (
          <Text style={styles.body}>Payment due {dateTimeLabel(amendment.paymentDeadlineAt)}</Text>
        )}
        <Text style={styles.body}>Owner response due {dateTimeLabel(amendment.expiresAt)}</Text>
      </Card>
      {amendment.status === 'OWNER_ACCEPTED_PAYMENT_PENDING' &&
        amendment.paymentState === 'WAITING_FOR_PAYMENT' && (
          <Button
            disabled={paying}
            label={
              paying
                ? 'Starting payment…'
                : `Pay ${money(additional, amendment.financial.currency)}`
            }
            onPress={onPay}
          />
        )}
      {amendment.status === 'PENDING_OWNER' && (
        <Button
          disabled={withdrawing}
          label={withdrawing ? 'Withdrawing…' : 'Withdraw request'}
          onPress={onWithdraw}
          variant="danger"
        />
      )}
      <Button label="Close" onPress={onClose} variant="secondary" />
    </Screen>
  );
}

function Comparison({
  current,
  proposed,
  currency,
}: {
  readonly current: AmendmentDetail['current'];
  readonly proposed: AmendmentDetail['proposed'];
  readonly currency: string;
}) {
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.heading}>
        Current
      </Text>
      <Row label="Pickup" value={dateTimeLabel(current.rentalStart)} />
      <Row label="Return" value={dateTimeLabel(current.rentalEnd)} />
      <Row
        label="Handover"
        value={`${methodLabel(current.startMethod)} / ${methodLabel(current.endMethod)}`}
      />
      <Row label="Total" value={money(Number(current.totalMinor), currency)} />
      <Text accessibilityRole="header" style={styles.heading}>
        Proposed
      </Text>
      <Row label="Pickup" value={dateTimeLabel(proposed.rentalStart)} />
      <Row label="Return" value={dateTimeLabel(proposed.rentalEnd)} />
      <Row
        label="Handover"
        value={`${methodLabel(proposed.startMethod)} / ${methodLabel(proposed.endMethod)}`}
      />
      <Row label="Total" value={money(Number(proposed.totalMinor), currency)} />
    </Card>
  );
}
function DateControl({
  label,
  value,
  onPress,
}: {
  readonly label: string;
  readonly value: Date;
  readonly onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card>
        <Row label={label} value={dateTimeLabel(value.toISOString())} />
        <Text style={styles.link}>Change date and time</Text>
      </Card>
    </Pressable>
  );
}
function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}
function InlineError({ message }: { readonly message: string }) {
  return (
    <Card style={styles.error}>
      <Text accessibilityLiveRegion="polite" style={styles.errorText}>
        {message}
      </Text>
    </Card>
  );
}
function methodLabel(
  value: AmendmentDetail['current']['startMethod'] | AmendmentDetail['current']['endMethod'],
) {
  return value === 'OWNER_DELIVERY'
    ? 'Owner delivery'
    : value === 'OWNER_COLLECTION'
      ? 'Owner collection'
      : value === 'RENTER_PICKUP'
        ? 'Renter pickup'
        : 'Renter return';
}
function refresh(client: ReturnType<typeof useQueryClient>, reference: string) {
  void client.invalidateQueries({ queryKey: ['bookings'] });
  void client.invalidateQueries({ queryKey: ['booking', reference] });
  void client.invalidateQueries({ queryKey: ['owner-amendments'] });
  void client.invalidateQueries({ queryKey: ['owner-rentals'] });
}
const styles = StyleSheet.create({
  body: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 16 },
  heading: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  link: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  row: {
    alignItems: 'flex-start',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  value: { color: colors.ink, flexShrink: 1, fontSize: 16, fontWeight: '700', textAlign: 'right' },
});
