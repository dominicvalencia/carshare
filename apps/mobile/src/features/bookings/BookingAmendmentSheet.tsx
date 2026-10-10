import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '../../auth/api-client';
import { LocationPicker } from '../../location/LocationPicker';
import type { CarShareLocation } from '../../location/booking-location-provider';
import { locationLabel } from '../../location/booking-location-provider';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { colors, radius, spacing } from '../../theme/tokens';
import { dateTimeLabel, money, timeLabel } from '../../ui/format';
import { BackControl, Button, Card, Chip, Icon, Screen, StateView } from '../../ui/primitives';
import type { BookingView } from './MyBookingsScreen';
import { TripDateCalendar } from '../discovery/TripDateCalendar';
import { BookingDateTimeEditorSummary } from '../discovery/BookingDateTimeEditorSummary';
import {
  applySharedBookingTime,
  isBookingTimeAligned,
  isBookingTimeSlotSelectable,
  tripDateSummary,
} from '../discovery/trip-date-policy';
import {
  amendmentErrorMessage,
  amendmentPreviewFinancialSummary,
  amendmentStatusCopy,
  idempotencyKey,
  transientAmendmentStatuses,
  type AmendmentDetail,
  type AmendmentPreview,
} from './booking-amendment';
import { adaptiveSheetLayout } from './booking-amendment-sheet-layout';

type Stage = 'EDIT' | 'REVIEW' | 'DETAIL';
type AdaptiveScreenProperties = {
  readonly contentBottomPadding: number;
  readonly contentGrows: false;
  readonly onContentSizeChange: (width: number, height: number) => void;
  readonly onHeaderLayout: (event: LayoutChangeEvent) => void;
  readonly safeTop: false;
  readonly scrollEnabled: boolean;
};

export function BookingAmendmentSheet({
  booking,
  onClose,
  visible,
}: {
  readonly booking: Omit<BookingView, 'pricing'>;
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
  const [picker, setPicker] = useState<'dates' | 'calendar' | 'return' | null>(null);
  const [pickerDraft, setPickerDraft] = useState<Date | null>(null);
  const [rangeDraft, setRangeDraft] = useState<{ pickup: Date; returnAt: Date } | null>(null);
  const [locationKind, setLocationKind] = useState<'delivery' | 'collection' | null>(null);
  const [preview, setPreview] = useState<AmendmentPreview | null>(null);
  const submitKey = useRef('');
  const payKey = useRef('');
  const payRequest = useRef<Promise<AmendmentDetail> | null>(null);
  const wasVisible = useRef(false);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(0);
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const bottomAllowance = Math.max(safeArea.bottom, spacing.lg);
  const sheetHeight = useSharedValue(Math.min(480, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: measuredContentHeight,
        headerHeight: measuredHeaderHeight,
        maxSafeViewportHeight: maximumHeight,
        // Screen includes this allowance in its measured content padding.
        safeAreaAllowance: 0,
      }),
    [maximumHeight, measuredContentHeight, measuredHeaderHeight],
  );

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

  useEffect(() => {
    if (measuredHeaderHeight <= 0 || measuredContentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 280 });
  }, [
    detail.data,
    measuredContentHeight,
    measuredHeaderHeight,
    measuredLayout.height,
    picker,
    sheetHeight,
    stage,
  ]);

  const adaptiveScreen = {
    contentBottomPadding: bottomAllowance,
    contentGrows: false,
    onContentSizeChange: (_: number, height: number) => setMeasuredContentHeight(height),
    onHeaderLayout: (event: LayoutChangeEvent) =>
      setMeasuredHeaderHeight(event.nativeEvent.layout.height),
    safeTop: false,
    scrollEnabled: measuredLayout.scrollEnabled,
  } as const;

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
    mutationFn: async () => {
      if (payRequest.current) return payRequest.current;
      payKey.current ||= idempotencyKey('pay-amendment', booking.publicReference);
      payRequest.current = apiClient.request<AmendmentDetail>(
        `/bookings/${booking.publicReference}/amendments/${amendmentId}/payment`,
        { headers: { 'Idempotency-Key': payKey.current }, method: 'POST' },
      );
      try {
        return await payRequest.current;
      } finally {
        payRequest.current = null;
      }
    },
    onError: async () => {
      await detail.refetch();
    },
    onSuccess: async () => {
      await detail.refetch();
      refresh(client, booking.publicReference);
    },
  });

  useEffect(() => {
    const justOpened = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!justOpened) return;

    previewMutation.reset();
    submit.reset();
    withdraw.reset();
    pay.reset();
    submitKey.current = '';
    payKey.current = '';
    payRequest.current = null;
    setPicker(null);
    setPickerDraft(null);
    setRangeDraft(null);
    setPreview(null);
    setAmendmentId(restoredId);
    setStage(restoredId ? 'DETAIL' : 'EDIT');
    setPickup(new Date(booking.rentalStart));
    setReturnAt(new Date(booking.rentalEnd));
    setStartMethod(booking.fulfillment.startMethod);
    setEndMethod(booking.fulfillment.endMethod);
    setDelivery(undefined);
    setCollection(undefined);
    // Mutation reset functions are stable; this effect intentionally responds only to visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = () => {
    previewMutation.reset();
    submit.reset();
    withdraw.reset();
    pay.reset();
    submitKey.current = '';
    payKey.current = '';
    payRequest.current = null;
    setPicker(null);
    setPickerDraft(null);
    setRangeDraft(null);
    setPreview(null);
    setAmendmentId(restoredId);
    setStage(restoredId ? 'DETAIL' : 'EDIT');
    setPickup(new Date(booking.rentalStart));
    setReturnAt(new Date(booking.rentalEnd));
    setStartMethod(booking.fulfillment.startMethod);
    setEndMethod(booking.fulfillment.endMethod);
    setDelivery(undefined);
    setCollection(undefined);
    onClose();
  };
  const openDates = () => {
    setRangeDraft({ pickup: new Date(pickup), returnAt: new Date(returnAt) });
    setPicker('dates');
  };
  const openReturn = () => {
    setPickerDraft(new Date(returnAt));
    setPicker('return');
  };
  const cancelPicker = () => {
    setPicker(null);
    setPickerDraft(null);
    setRangeDraft(null);
  };
  const saveReturn = () => {
    if (!pickerDraft) return;
    setReturnAt(pickerDraft);
    setPicker(null);
    setPickerDraft(null);
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close booking change sheet"
          accessibilityRole="button"
          onPress={close}
          style={styles.backdrop}
        />
        <Reanimated.View accessibilityViewIsModal style={[styles.sheet, animatedSheetStyle]}>
          {stage === 'EDIT' && (picker === 'dates' || picker === 'calendar') && rangeDraft ? (
            <DateRangeEditor
              adaptiveScreen={adaptiveScreen}
              calendarOpen={picker === 'calendar'}
              pickup={rangeDraft.pickup}
              returnAt={rangeDraft.returnAt}
              onCancel={cancelPicker}
              onChange={setRangeDraft}
              onCloseCalendar={() => setPicker('dates')}
              onOpenCalendar={() => setPicker('calendar')}
              onSave={() => {
                if (rangeDraft.returnAt <= rangeDraft.pickup) return;
                setPickup(rangeDraft.pickup);
                setReturnAt(rangeDraft.returnAt);
                setPicker(null);
                setRangeDraft(null);
              }}
            />
          ) : stage === 'EDIT' && picker === 'return' && pickerDraft ? (
            <DateTimeEditor
              adaptiveScreen={adaptiveScreen}
              active={active}
              kind="return"
              minimumDate={new Date(booking.rentalEnd)}
              value={pickerDraft}
              onCancel={cancelPicker}
              onChange={setPickerDraft}
              onSave={saveReturn}
            />
          ) : stage === 'EDIT' ? (
            <Screen
              {...adaptiveScreen}
              compactNestedHeader
              contentTopPadding={spacing.sm}
              leading={<BackControl label="Close" onPress={close} />}
              eyebrow="Booking change"
              title={active ? 'Extend Trip' : 'Change Booking'}
              subtitle={
                active
                  ? 'Choose a later return time.'
                  : 'Update the supported trip details, then review the live price.'
              }
            >
              <View style={styles.editBody}>
                {!active ? (
                  <DateRangeControl
                    changed={
                      pickup.getTime() !== new Date(booking.rentalStart).getTime() ||
                      returnAt.getTime() !== new Date(booking.rentalEnd).getTime()
                    }
                    pickup={pickup}
                    returnAt={returnAt}
                    onPress={openDates}
                  />
                ) : (
                  <DateControl
                    changed={returnAt.getTime() !== new Date(booking.rentalEnd).getTime()}
                    label="Return"
                    value={returnAt}
                    onPress={openReturn}
                  />
                )}
                {!active && (
                  <Card style={styles.handoverCard}>
                    <FulfillmentControl
                      allowed={booking.fulfillment.allowedStartMethods}
                      changeable={booking.fulfillment.startFulfillmentChangeable}
                      changed={startMethod !== booking.fulfillment.startMethod}
                      kind="start"
                      label="Start of rental"
                      value={startMethod}
                      onChange={setStartMethod}
                    />
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
                    <View style={styles.handoverDivider} />
                    <FulfillmentControl
                      allowed={booking.fulfillment.allowedEndMethods}
                      changeable={booking.fulfillment.endFulfillmentChangeable}
                      changed={endMethod !== booking.fulfillment.endMethod}
                      kind="end"
                      label="End of rental"
                      value={endMethod}
                      onChange={setEndMethod}
                    />
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
                  </Card>
                )}
                {previewMutation.isError && (
                  <InlineError message={amendmentErrorMessage(previewMutation.error)} />
                )}
                <View style={styles.bottomAction}>
                  <Button
                    disabled={
                      previewMutation.isPending ||
                      returnAt <= (active ? new Date(booking.rentalEnd) : pickup)
                    }
                    label={
                      previewMutation.isPending
                        ? 'Checking availability and price…'
                        : 'Review change'
                    }
                    onPress={() => {
                      submit.reset();
                      submitKey.current = '';
                      previewMutation.mutate();
                    }}
                  />
                </View>
              </View>
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
              adaptiveScreen={adaptiveScreen}
              active={active}
              error={submit.isError ? amendmentErrorMessage(submit.error) : null}
              pending={submit.isPending}
              preview={preview}
              onBack={() => {
                submit.reset();
                submitKey.current = '';
                setStage('EDIT');
              }}
              onClose={close}
              onSubmit={() => submit.mutate()}
            />
          ) : (
            <AmendmentState
              amendment={detail.data}
              actionError={withdraw.error ?? pay.error}
              error={detail.error}
              loading={detail.isPending}
              paying={pay.isPending}
              bottomPadding={bottomAllowance}
              withdrawing={withdraw.isPending}
              onClose={close}
              onContentSizeChange={adaptiveScreen.onContentSizeChange}
              onHeaderLayout={adaptiveScreen.onHeaderLayout}
              scrollEnabled={measuredLayout.scrollEnabled}
              onPay={() => pay.mutate()}
              onRetry={() => void detail.refetch()}
              onWithdraw={() =>
                Alert.alert(
                  'Withdraw this request?',
                  'Your original booking will remain unchanged.',
                  [
                    { text: 'Keep request', style: 'cancel' },
                    { text: 'Withdraw', style: 'destructive', onPress: () => withdraw.mutate() },
                  ],
                )
              }
            />
          )}
        </Reanimated.View>
      </View>
    </Modal>
  );
}

function DateTimeEditor({
  adaptiveScreen,
  active,
  kind,
  minimumDate,
  value,
  onCancel,
  onChange,
  onSave,
}: {
  readonly adaptiveScreen: AdaptiveScreenProperties;
  readonly active: boolean;
  readonly kind: 'pickup' | 'return';
  readonly minimumDate: Date;
  readonly value: Date;
  readonly onCancel: () => void;
  readonly onChange: (value: Date) => void;
  readonly onSave: () => void;
}) {
  const title = kind === 'pickup' ? 'Change pickup' : active ? 'Extend return' : 'Change return';
  return (
    <Screen
      {...adaptiveScreen}
      bottomAccessory={
        <View
          accessibilityLabel="Date and time action"
          style={[styles.dateEditorActions, { paddingBottom: adaptiveScreen.contentBottomPadding }]}
        >
          <Button label="Done" onPress={onSave} />
        </View>
      }
      contentBottomPadding={spacing.sm}
      leading={<BackControl label="Cancel" onPress={onCancel} />}
      measureBottomAccessory
      title={title}
      subtitle={
        active
          ? 'Choose a later return date and time. Your current return remains unchanged until approval.'
          : `Choose the proposed ${kind} date and time.`
      }
    >
      <View style={styles.editorBody}>
        <Card>
          <Text style={styles.editorLabel}>Selected {kind}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.editorValue}>
            {dateTimeLabel(value.toISOString())}
          </Text>
        </Card>
        <View accessibilityLabel={`${title} calendar and time selector`} style={styles.pickerCard}>
          <Text accessibilityRole="header" style={styles.pickerHeading}>
            Date and time
          </Text>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            minimumDate={minimumDate}
            mode="datetime"
            onChange={(_, selected) => {
              if (selected) onChange(selected);
            }}
            value={value}
            {...(Platform.OS === 'ios' ? { themeVariant: 'light' as const } : {})}
          />
        </View>
      </View>
    </Screen>
  );
}

function DateRangeEditor({
  adaptiveScreen,
  calendarOpen,
  pickup,
  returnAt,
  onCancel,
  onChange,
  onCloseCalendar,
  onOpenCalendar,
  onSave,
}: {
  readonly adaptiveScreen: AdaptiveScreenProperties;
  readonly calendarOpen: boolean;
  readonly pickup: Date;
  readonly returnAt: Date;
  readonly onCancel: () => void;
  readonly onChange: (value: { pickup: Date; returnAt: Date }) => void;
  readonly onCloseCalendar: () => void;
  readonly onOpenCalendar: () => void;
  readonly onSave: () => void;
}) {
  const valid = returnAt > pickup;
  const [timeValid, setTimeValid] = useState(
    () =>
      isBookingTimeAligned(pickup) &&
      isBookingTimeSlotSelectable(pickup, pickup.getHours() * 60 + pickup.getMinutes()),
  );
  if (calendarOpen)
    return (
      <Screen
        {...adaptiveScreen}
        leading={<BackControl label="Back" onPress={onCloseCalendar} />}
        title="Trip dates"
      >
        <TripDateCalendar
          appliedEnd={returnAt}
          appliedStart={pickup}
          preselect
          showClear={false}
          onApply={(start, end) => {
            const shared = applySharedBookingTime(
              start,
              end,
              pickup.getHours() * 60 + pickup.getMinutes(),
            );
            onChange({ pickup: shared.start, returnAt: shared.end });
            setTimeValid(
              isBookingTimeAligned(shared.start) &&
                isBookingTimeSlotSelectable(
                  shared.start,
                  shared.start.getHours() * 60 + shared.start.getMinutes(),
                ),
            );
            onCloseCalendar();
          }}
          onClear={() => undefined}
        />
      </Screen>
    );
  return (
    <Screen
      {...adaptiveScreen}
      leading={<BackControl label="Cancel" onPress={onCancel} />}
      title="Change dates"
      subtitle="Choose the proposed pickup and return. Your booking stays unchanged until the change is approved."
    >
      <View style={styles.dateEditorBody}>
        <BookingDateTimeEditorSummary
          end={returnAt}
          onChangeDates={onOpenCalendar}
          onChangeTime={(value) => {
            const shared = applySharedBookingTime(
              pickup,
              returnAt,
              value.getHours() * 60 + value.getMinutes(),
            );
            onChange({ pickup: shared.start, returnAt: shared.end });
          }}
          onValidityChange={setTimeValid}
          start={pickup}
        />
        {!valid && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            Return must be after pickup.
          </Text>
        )}
        <View style={styles.bottomAction}>
          <Button disabled={!valid || !timeValid} label="Done" onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

type StartMethod = 'RENTER_PICKUP' | 'OWNER_DELIVERY';
type EndMethod = 'RENTER_RETURN' | 'OWNER_COLLECTION';

function FulfillmentControl(
  props:
    | {
        readonly allowed: readonly StartMethod[];
        readonly changeable: boolean;
        readonly changed: boolean;
        readonly kind: 'start';
        readonly label: string;
        readonly value: StartMethod;
        readonly onChange: (value: StartMethod) => void;
      }
    | {
        readonly allowed: readonly EndMethod[];
        readonly changeable: boolean;
        readonly changed: boolean;
        readonly kind: 'end';
        readonly label: string;
        readonly value: EndMethod;
        readonly onChange: (value: EndMethod) => void;
      },
) {
  const showSelector = props.changeable && props.allowed.length > 1;
  if (!showSelector)
    return (
      <View
        accessible
        accessibilityLabel={`${props.label}. ${methodLabel(props.value)}`}
        style={styles.fulfillmentSummary}
      >
        <Text style={styles.fulfillmentLabel}>{props.label}</Text>
        <View style={styles.summaryValueRow}>
          <Text style={styles.fulfillmentValue}>{methodLabel(props.value)}</Text>
          {props.changed && <Text style={styles.changed}>Changed</Text>}
        </View>
      </View>
    );
  return (
    <View style={styles.fulfillmentGroup}>
      <View style={styles.dateLabelRow}>
        <Text accessibilityRole="header" style={styles.fulfillmentLabel}>
          {props.label}
        </Text>
        {props.changed && <Text style={styles.changed}>Changed</Text>}
      </View>
      <View style={styles.chips}>
        {props.kind === 'start'
          ? props.allowed.map((method) => (
              <Chip
                key={method}
                label={methodLabel(method)}
                selected={props.value === method}
                onPress={() => props.onChange(method)}
              />
            ))
          : props.allowed.map((method) => (
              <Chip
                key={method}
                label={methodLabel(method)}
                selected={props.value === method}
                onPress={() => props.onChange(method)}
              />
            ))}
      </View>
    </View>
  );
}

function DateRangeControl({
  changed,
  pickup,
  returnAt,
  onPress,
}: {
  readonly changed: boolean;
  readonly pickup: Date;
  readonly returnAt: Date;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens the pickup and return date editor"
      accessibilityLabel={`Dates and time. ${tripDateSummary(pickup, returnAt, { alwaysShowYear: true })}. Shared handover time ${timeLabel(pickup)}${changed ? '. Changed' : ''}`}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Card style={styles.dateTimeCard}>
        <View style={styles.dateLabelRow}>
          <Text style={styles.dateSectionTitle}>Dates &amp; time</Text>
          {changed && <Text style={styles.changed}>Changed</Text>}
        </View>
        <Text style={styles.dateRangePrimary}>
          {tripDateSummary(pickup, returnAt, { alwaysShowYear: true })} · {timeLabel(pickup)}
        </Text>
        <View style={styles.changeDatesAction}>
          <Text style={styles.changeDatesText}>Change dates &amp; time</Text>
          <Icon color={colors.primary} name="chevron-forward" size={20} />
        </View>
      </Card>
    </Pressable>
  );
}

function Review({
  adaptiveScreen,
  active,
  error,
  pending,
  preview,
  onBack,
  onClose,
  onSubmit,
}: {
  readonly adaptiveScreen: AdaptiveScreenProperties;
  readonly active: boolean;
  readonly error: string | null;
  readonly pending: boolean;
  readonly preview: AmendmentPreview;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}) {
  const [reviewedAt] = useState(() => Date.now());
  const financial = amendmentPreviewFinancialSummary(preview);
  const expiresAt = Date.parse(preview.expiresAt);
  const expired = !Number.isFinite(expiresAt) || expiresAt <= reviewedAt;
  const trustworthy = financial.valid && !expired;
  return (
    <Screen
      {...adaptiveScreen}
      leading={<BackControl label="Back" onPress={onBack} />}
      eyebrow="Review change"
      title="Confirm your request"
      subtitle="The Owner must approve this change before it takes effect."
    >
      <Comparison active={active} current={preview.current} proposed={preview.proposed} />
      {financial.valid ? (
        <Card>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Price summary
          </Text>
          <Row
            accessibilityLabel={`Current total ${money(financial.currentTotalMinor, financial.currency)}`}
            label="Current total"
            value={money(financial.currentTotalMinor, financial.currency)}
          />
          <Row
            accessibilityLabel={`New total ${money(financial.proposedTotalMinor, financial.currency)}`}
            label="New total"
            value={money(financial.proposedTotalMinor, financial.currency)}
          />
          <Row
            accessibilityLabel={`Difference ${financial.direction === 'ADDITIONAL_PAYMENT' ? 'plus ' : ''}${money(financial.differenceMinor, financial.currency)}`}
            label="Difference"
            value={`${financial.direction === 'ADDITIONAL_PAYMENT' ? '+' : ''}${money(financial.differenceMinor, financial.currency)}`}
          />
          <View accessibilityLiveRegion="polite" style={styles.outcome}>
            <Text style={styles.outcomeTitle}>
              {financial.direction === 'ADDITIONAL_PAYMENT'
                ? 'Additional payment'
                : financial.direction === 'REFUND'
                  ? 'Refund due'
                  : 'No price difference'}
            </Text>
            <Text style={styles.body}>
              {financial.direction === 'ADDITIONAL_PAYMENT'
                ? `${money(financial.additionalPaymentMinor, financial.currency)} is due only after the Owner approves this request.`
                : financial.direction === 'REFUND'
                  ? `${money(financial.expectedRefundMinor, financial.currency)} will follow the accepted refund process after approval.`
                  : 'Your total booking price stays the same.'}
            </Text>
          </View>
          <Text style={styles.validity}>
            Price and availability are valid until {dateTimeLabel(preview.expiresAt)}.
          </Text>
          {active && (
            <Text style={styles.body}>
              Your original return time remains in effect until this extension is applied.
            </Text>
          )}
        </Card>
      ) : (
        <InlineError message={financial.message} />
      )}
      {expired && (
        <InlineError message="This preview expired. Edit the change and check the latest price." />
      )}
      {error && <InlineError message={error} />}
      <Button
        disabled={pending || !trustworthy}
        label={pending ? 'Sending request…' : 'Request Owner approval'}
        onPress={onSubmit}
      />
      <Button label="Discard changes" onPress={onClose} variant="ghost" />
    </Screen>
  );
}

function AmendmentState({
  amendment,
  actionError,
  bottomPadding,
  error,
  loading,
  paying,
  withdrawing,
  onClose,
  onContentSizeChange,
  onHeaderLayout,
  scrollEnabled,
  onPay,
  onRetry,
  onWithdraw,
}: {
  readonly amendment: AmendmentDetail | undefined;
  readonly actionError: Error | null;
  readonly bottomPadding: number;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly paying: boolean;
  readonly withdrawing: boolean;
  readonly onClose: () => void;
  readonly onContentSizeChange: (width: number, height: number) => void;
  readonly onHeaderLayout: (event: LayoutChangeEvent) => void;
  readonly scrollEnabled: boolean;
  readonly onPay: () => void;
  readonly onRetry: () => void;
  readonly onWithdraw: () => void;
}) {
  if (loading)
    return (
      <Screen
        contentBottomPadding={bottomPadding}
        contentGrows={false}
        leading={<BackControl label="Close" onPress={onClose} />}
        onContentSizeChange={onContentSizeChange}
        onHeaderLayout={onHeaderLayout}
        scrollEnabled={scrollEnabled}
        title="Booking change"
      >
        <StateView loading title="Loading change request…" />
      </Screen>
    );
  if (error || !amendment)
    return (
      <Screen
        contentBottomPadding={bottomPadding}
        contentGrows={false}
        leading={<BackControl label="Close" onPress={onClose} />}
        onContentSizeChange={onContentSizeChange}
        onHeaderLayout={onHeaderLayout}
        scrollEnabled={scrollEnabled}
        title="Booking change"
      >
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
  const applied = amendment.status === 'APPLIED';
  const showPaymentDeadline = !applied && Boolean(amendment.paymentDeadlineAt);
  const showStatusMeta =
    additional > 0 || refund > 0 || showPaymentDeadline || amendment.status === 'PENDING_OWNER';
  return (
    <Screen
      contentBottomPadding={bottomPadding}
      contentGrows={false}
      leading={<BackControl label="Close" onPress={onClose} />}
      onContentSizeChange={onContentSizeChange}
      onHeaderLayout={onHeaderLayout}
      scrollEnabled={scrollEnabled}
      eyebrow="Booking change"
      title={title}
      subtitle={copy}
    >
      {applied ? (
        <AppliedSummary current={amendment.current} />
      ) : (
        <Comparison active={false} current={amendment.current} proposed={amendment.proposed} />
      )}
      {showStatusMeta && (
        <Card style={styles.statusMetaCard}>
          {additional > 0 && (
            <Row
              label={applied ? 'Payment completed' : 'Additional payment'}
              value={money(additional, amendment.financial.currency)}
            />
          )}
          {refund > 0 && (
            <Row
              label={applied ? 'Refund completed' : 'Expected refund'}
              value={money(refund, amendment.financial.currency)}
            />
          )}
          {showPaymentDeadline && amendment.paymentDeadlineAt && (
            <DeadlineRow
              label="Payment deadline"
              value={dateTimeLabel(amendment.paymentDeadlineAt)}
            />
          )}
          {amendment.status === 'PENDING_OWNER' && (
            <DeadlineRow
              label="Owner response deadline"
              value={dateTimeLabel(amendment.expiresAt)}
            />
          )}
        </Card>
      )}
      {actionError && <InlineError message={amendmentErrorMessage(actionError)} />}
      <View style={styles.statusActions}>
        {amendment.paymentInitiationAllowed && (
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
      </View>
    </Screen>
  );
}

function AppliedSummary({ current }: { readonly current: AmendmentDetail['current'] }) {
  const start = new Date(current.rentalStart);
  const end = new Date(current.rentalEnd);
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        Trip dates
      </Text>
      <Text style={styles.appliedDateRange}>
        {tripDateSummary(start, end, { alwaysShowYear: true })}
      </Text>
      <Text style={styles.dateRangeSecondary}>
        Pickup {timeLabel(start)} · Return {timeLabel(end)}
      </Text>
      <View style={styles.reviewSection}>
        <Text style={styles.summaryLabel}>Handover</Text>
        <Text style={styles.fulfillmentValue}>
          {methodLabel(current.startMethod)} · {methodLabel(current.endMethod)}
        </Text>
      </View>
    </Card>
  );
}

function DeadlineRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View accessibilityLabel={`${label}, ${value}`} style={styles.deadlineRow}>
      <View style={styles.deadlineIcon}>
        <Icon color={colors.primary} name="time-outline" size={20} />
      </View>
      <View style={styles.deadlineCopy}>
        <Text style={styles.deadlineLabel}>{label}</Text>
        <Text style={styles.deadlineValue}>{value}</Text>
      </View>
    </View>
  );
}

function Comparison({
  active,
  current,
  proposed,
}: {
  readonly active: boolean;
  readonly current: AmendmentDetail['current'];
  readonly proposed: AmendmentPreview['proposed'];
}) {
  const datesChanged =
    current.rentalStart !== proposed.rentalStart || current.rentalEnd !== proposed.rentalEnd;
  const startChanged = current.startMethod !== proposed.startMethod;
  const endChanged = current.endMethod !== proposed.endMethod;
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {active ? 'Return change' : 'Trip dates'}
      </Text>
      {datesChanged && active ? (
        <TransitionRow
          label="Return"
          current={dateTimeLabel(current.rentalEnd)}
          proposed={dateTimeLabel(proposed.rentalEnd)}
        />
      ) : datesChanged ? (
        <View style={styles.comparisonGrid}>
          <DateComparison label="Current" start={current.rentalStart} end={current.rentalEnd} />
          <Icon color={colors.subtleText} name="arrow-forward" size={20} />
          <DateComparison label="Proposed" start={proposed.rentalStart} end={proposed.rentalEnd} />
        </View>
      ) : (
        <Text style={styles.body}>Trip dates · No change</Text>
      )}
      {(startChanged || endChanged) && (
        <View style={styles.reviewSection}>
          <Text style={styles.summaryLabel}>Handover</Text>
          {startChanged && (
            <TransitionRow
              label="Start of rental"
              current={methodLabel(current.startMethod)}
              proposed={methodLabel(proposed.startMethod)}
            />
          )}
          {endChanged && (
            <TransitionRow
              label="End of rental"
              current={methodLabel(current.endMethod)}
              proposed={methodLabel(proposed.endMethod)}
            />
          )}
        </View>
      )}
    </Card>
  );
}
function DateComparison({
  label,
  start,
  end,
}: {
  readonly label: string;
  readonly start: string;
  readonly end: string;
}) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return (
    <View style={styles.comparisonColumn}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.comparisonValue}>
        {tripDateSummary(startDate, endDate, { alwaysShowYear: true })}
      </Text>
      <Text style={styles.dateRangeSecondary}>
        Pickup {timeLabel(startDate)} · Return {timeLabel(endDate)}
      </Text>
    </View>
  );
}
function TransitionRow({
  label,
  current,
  proposed,
}: {
  readonly label: string;
  readonly current: string;
  readonly proposed: string;
}) {
  return (
    <View style={styles.transitionRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.transitionValue}>
        {current} → {proposed}
      </Text>
    </View>
  );
}
function DateControl({
  changed,
  label,
  value,
  onPress,
}: {
  readonly changed: boolean;
  readonly label: string;
  readonly value: Date;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={`Opens the ${label.toLowerCase()} date and time editor`}
      accessibilityLabel={`${label}, ${dateTimeLabel(value.toISOString())}${changed ? ', changed' : ''}`}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Card>
        <View style={styles.dateControl}>
          <View style={styles.dateControlCopy}>
            <View style={styles.dateLabelRow}>
              <Text style={styles.dateLabel}>{label}</Text>
              {changed && <Text style={styles.changed}>Changed</Text>}
            </View>
            <Text style={styles.dateValue}>{dateTimeLabel(value.toISOString())}</Text>
          </View>
          <Icon color={colors.primary} name="chevron-forward" size={22} />
        </View>
      </Card>
    </Pressable>
  );
}
function Row({
  accessibilityLabel,
  label,
  value,
}: {
  readonly accessibilityLabel?: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
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
        ? 'Pick up'
        : 'Return it';
}
function refresh(client: ReturnType<typeof useQueryClient>, reference: string) {
  void client.invalidateQueries({ queryKey: ['bookings'] });
  void client.invalidateQueries({ queryKey: ['booking', reference] });
  void client.invalidateQueries({ queryKey: ['owner-amendments'] });
  void client.invalidateQueries({ queryKey: ['owner-rentals'] });
}
const styles = StyleSheet.create({
  appliedDateRange: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  body: { color: colors.subtleText, fontSize: 16, lineHeight: 23 },
  bottomAction: { marginTop: spacing.xs },
  cardTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: spacing.sm },
  changed: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  changeDatesAction: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  changeDatesText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  dateGrid: { flexDirection: 'row', gap: spacing.md },
  dateEditorActions: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  dateEditorBody: { gap: spacing.md },
  dateControl: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  dateControlCopy: { flex: 1, gap: spacing.xs },
  dateLabel: { color: colors.subtleText, fontSize: 14, fontWeight: '700' },
  dateLabelRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  dateSectionTitle: {
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  dateTimeCard: { paddingVertical: spacing.sm },
  dateRangePrimary: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: spacing.xs },
  dateRangeSecondary: {
    color: colors.subtleText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  dateValue: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  deadlineCopy: { flex: 1, gap: spacing.xxs },
  deadlineIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  deadlineLabel: { color: colors.subtleText, fontSize: 13, fontWeight: '700' },
  deadlineRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  deadlineValue: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  editorBody: { gap: spacing.sm },
  editorLabel: { color: colors.subtleText, fontSize: 14, fontWeight: '700' },
  editorValue: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: spacing.xs },
  disabled: { opacity: 0.4 },
  editBody: { gap: spacing.sm, paddingBottom: spacing.sm },
  error: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 16 },
  fulfillmentGroup: { gap: spacing.xs, paddingVertical: spacing.xxs },
  fulfillmentLabel: {
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  fulfillmentSummary: {
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  fulfillmentValue: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  handoverCard: { gap: spacing.xs, paddingVertical: spacing.sm },
  handoverDivider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  heading: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  pickerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  pickerHeading: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  comparisonColumn: { flex: 1, gap: spacing.xs },
  comparisonGrid: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  comparisonValue: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  outcome: { gap: spacing.xs, paddingTop: spacing.md },
  outcomeTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  reviewSection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  row: {
    alignItems: 'flex-start',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowLabel: { color: colors.subtleText, fontSize: 16, fontWeight: '700' },
  summaryLabel: { color: colors.subtleText, fontSize: 14, fontWeight: '800' },
  summaryValueRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  statusActions: { gap: spacing.sm },
  statusMetaCard: { gap: spacing.md },
  transitionRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  transitionValue: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  validity: { color: colors.subtleText, fontSize: 14, lineHeight: 20, marginTop: spacing.md },
  value: { color: colors.ink, flexShrink: 1, fontSize: 16, fontWeight: '700', textAlign: 'right' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
    width: '100%',
  },
});
