import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ApiError, apiClient } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { money } from '../../ui/format';
import { Button, Card, Icon, Screen, StateView } from '../../ui/primitives';

type CancellationRole = 'RENTER' | 'OWNER';
type ReasonCode =
  | 'CHANGE_OF_PLANS'
  | 'BOOKED_ANOTHER_VEHICLE'
  | 'TRIP_CANCELLED'
  | 'SCHEDULE_CHANGED'
  | 'VEHICLE_OR_LISTING_CONCERN'
  | 'VEHICLE_UNAVAILABLE'
  | 'VEHICLE_MAINTENANCE'
  | 'OWNER_SCHEDULE_CONFLICT'
  | 'RENTER_OR_TRIP_CONCERN'
  | 'SAFETY_CONCERN'
  | 'EMERGENCY'
  | 'OTHER';

interface CancellationPreview {
  readonly actor: CancellationRole;
  readonly blockers: readonly string[];
  readonly cancellationFeeMinor: string;
  readonly capturedAmountMinor: string;
  readonly collectionTreatment: { readonly refundedMinor: string };
  readonly currency: string;
  readonly deliveryTreatment: { readonly refundedMinor: string; readonly retainedMinor: string };
  readonly eligible: boolean;
  readonly expiresAt: string;
  readonly nonRefundableRentalMinor: string;
  readonly ownerPenaltyMinor: string;
  readonly policyCode: string;
  readonly previewToken: string;
  readonly refundableRentalMinor: string;
  readonly totalRefundMinor: string;
}

interface CancellationResult {
  readonly currency: string;
  readonly ownerFinancialObligation?: {
    readonly originalAmountMinor?: string;
    readonly status?: string;
  };
  readonly ownerPenaltyMinor?: string;
  readonly refundAmountMinor: string;
  readonly refundStatus?: string | null;
}

const renterReasons: readonly [ReasonCode, string][] = [
  ['CHANGE_OF_PLANS', 'Change of plans'],
  ['BOOKED_ANOTHER_VEHICLE', 'Booked another vehicle'],
  ['TRIP_CANCELLED', 'Trip cancelled'],
  ['SCHEDULE_CHANGED', 'Schedule changed'],
  ['VEHICLE_OR_LISTING_CONCERN', 'Vehicle or listing concern'],
  ['SAFETY_CONCERN', 'Safety concern'],
  ['OTHER', 'Other'],
];
const ownerReasons: readonly [ReasonCode, string][] = [
  ['VEHICLE_UNAVAILABLE', 'Vehicle unavailable'],
  ['VEHICLE_MAINTENANCE', 'Vehicle maintenance'],
  ['OWNER_SCHEDULE_CONFLICT', 'Owner schedule conflict'],
  ['RENTER_OR_TRIP_CONCERN', 'Renter or trip concern'],
  ['SAFETY_CONCERN', 'Safety concern'],
  ['EMERGENCY', 'Emergency'],
  ['OTHER', 'Other'],
];

export function BookingCancellationSheet({
  bookingReference,
  onClose,
  onCompleted,
  role,
  visible,
}: {
  readonly bookingReference: string;
  readonly onClose: () => void;
  readonly onCompleted: () => void;
  readonly role: CancellationRole;
  readonly visible: boolean;
}) {
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [detail, setDetail] = useState('');
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  const [result, setResult] = useState<CancellationResult | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const executionKey = useRef(createIdempotencyKey(bookingReference));
  const endpoint =
    role === 'OWNER' ? `/owner/bookings/${bookingReference}` : `/bookings/${bookingReference}`;

  const previewRequest = useMutation({
    mutationFn: (reason: ReasonCode) =>
      apiClient.request<CancellationPreview>(`${endpoint}/cancellation-preview`, {
        body: JSON.stringify({ detail: detail.trim() || undefined, reasonCode: reason }),
        method: 'POST',
      }),
    onSuccess: (value) => {
      setPreview(value);
      executionKey.current = createIdempotencyKey(bookingReference);
    },
  });
  const execute = useMutation({
    mutationFn: () =>
      apiClient.request<CancellationResult>(`${endpoint}/cancellation`, {
        body: JSON.stringify({
          detail: detail.trim() || undefined,
          previewToken: preview!.previewToken,
          reasonCode,
        }),
        headers: { 'Idempotency-Key': executionKey.current },
        method: 'POST',
      }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'CANCELLATION_PREVIEW_STALE' && reasonCode) {
        setStaleNotice(true);
        setPreview(null);
        previewRequest.mutate(reasonCode);
      }
    },
    onSuccess: (value) => {
      setResult(value);
      onCompleted();
    },
  });

  const close = () => {
    setReasonCode(null);
    setDetail('');
    setPreview(null);
    setResult(null);
    setStaleNotice(false);
    previewRequest.reset();
    execute.reset();
    onClose();
  };

  const reasons = role === 'OWNER' ? ownerReasons : renterReasons;
  const selectedReason = reasons.find(([code]) => code === reasonCode)?.[1];
  const compactSheet = Boolean(preview || previewRequest.isPending);
  const { height: viewportHeight } = useWindowDimensions();
  const sheetHeight = useSharedValue(viewportHeight * 0.92);
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));

  useEffect(() => {
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    const heightRatio = result ? 0.5 : compactSheet ? 0.78 : 0.92;
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(viewportHeight * heightRatio, {
      duration: 280,
    });
  }, [compactSheet, result, sheetHeight, viewportHeight]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={execute.isPending ? undefined : close}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close cancellation sheet"
          accessibilityRole="button"
          disabled={execute.isPending}
          onPress={close}
          style={styles.backdrop}
        />
        <Reanimated.View accessibilityViewIsModal style={[styles.sheet, animatedSheetStyle]}>
          <Screen
            action={
              <Pressable
                accessibilityLabel="Close cancellation sheet"
                accessibilityRole="button"
                disabled={execute.isPending}
                hitSlop={spacing.md}
                onPress={close}
              >
                <Text style={styles.close}>Close</Text>
              </Pressable>
            }
            eyebrow="Booking cancellation"
            title={result ? 'Booking cancelled' : 'Cancel this booking?'}
            subtitle={
              result
                ? role === 'OWNER'
                  ? result.refundStatus === 'COMPLETED'
                    ? "Your cancellation is confirmed and your renter's refund has been processed."
                    : "Your cancellation is confirmed and your renter's refund is underway."
                  : Number(result.refundAmountMinor) > 0
                    ? result.refundStatus === 'COMPLETED'
                      ? 'Your cancellation is confirmed and your refund has been processed.'
                      : 'Your cancellation is confirmed and your refund is underway.'
                    : 'Your cancellation is confirmed.'
                : preview
                  ? 'Review the current cancellation details before making your final decision.'
                  : 'Select a reason to review the current cancellation consequences before deciding.'
            }
          >
            {result ? (
              <Success role={role} result={result} />
            ) : (
              <>
                {!preview && !previewRequest.isPending && (
                  <>
                    <Text accessibilityRole="header" style={styles.heading}>
                      Why are you cancelling?
                    </Text>
                    <View accessibilityRole="radiogroup" style={styles.reasons}>
                      {reasons.map(([code, label]) => (
                        <Pressable
                          key={code}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: reasonCode === code }}
                          onPress={() => {
                            setReasonCode(code);
                            setPreview(null);
                            previewRequest.reset();
                          }}
                          style={[styles.reason, reasonCode === code && styles.reasonSelected]}
                        >
                          <Text style={styles.reasonText}>{label}</Text>
                          {reasonCode === code && (
                            <Icon color={colors.primary} name="checkmark-circle" />
                          )}
                        </Pressable>
                      ))}
                    </View>
                    {reasonCode === 'OTHER' && (
                      <TextInput
                        accessibilityLabel="Cancellation reason details"
                        multiline
                        onChangeText={setDetail}
                        placeholder="Tell us a little more"
                        placeholderTextColor={colors.placeholder}
                        style={styles.input}
                        value={detail}
                      />
                    )}
                    {previewRequest.isError && <ErrorState error={previewRequest.error} />}
                    <Button
                      disabled={!reasonCode || (reasonCode === 'OTHER' && detail.trim().length < 3)}
                      label="Review cancellation"
                      onPress={() => reasonCode && previewRequest.mutate(reasonCode)}
                    />
                    <Button label="Keep booking" onPress={close} variant="secondary" />
                  </>
                )}
                {previewRequest.isPending && (
                  <StateView
                    loading
                    title="Reviewing cancellation…"
                    message="Getting the current consequences from CarShare."
                  />
                )}
                {preview && (
                  <>
                    {staleNotice && (
                      <Text accessibilityLiveRegion="polite" style={styles.notice}>
                        The previous preview changed. Review these updated amounts before
                        cancelling.
                      </Text>
                    )}
                    <Preview role={role} selectedReason={selectedReason} value={preview} />
                    {execute.isError &&
                      !(
                        execute.error instanceof ApiError &&
                        execute.error.code === 'CANCELLATION_PREVIEW_STALE'
                      ) && <ErrorState error={execute.error} />}
                    {preview.eligible && preview.blockers.length === 0 && (
                      <>
                        <Button disabled={execute.isPending} label="Keep booking" onPress={close} />
                        <Button
                          disabled={execute.isPending}
                          label={execute.isPending ? 'Cancelling…' : 'Cancel booking'}
                          onPress={() => execute.mutate()}
                          variant="danger"
                        />
                      </>
                    )}
                    {!preview.eligible && <Button label="Keep booking" onPress={close} />}
                  </>
                )}
              </>
            )}
            {result && <Button label="Close" onPress={close} />}
          </Screen>
        </Reanimated.View>
      </View>
    </Modal>
  );
}

function Preview({
  role,
  selectedReason,
  value,
}: {
  readonly role: CancellationRole;
  readonly selectedReason: string | undefined;
  readonly value: CancellationPreview;
}) {
  if (!value.eligible || value.blockers.length > 0)
    return (
      <Card style={styles.blocked}>
        <Text accessibilityRole="header" style={styles.heading}>
          {"Cancellation isn't available"}
        </Text>
        <Text style={styles.copy}>{blockerCopy(value.blockers)}</Text>
      </Card>
    );
  const noRentalRefund = Number(value.refundableRentalMinor) === 0;
  return (
    <Card>
      {selectedReason && (
        <View style={styles.selectedReason}>
          <Text style={styles.selectedReasonLabel}>Reason</Text>
          <Text style={styles.selectedReasonValue}>{selectedReason}</Text>
        </View>
      )}
      {role === 'RENTER' ? (
        <>
          {noRentalRefund && (
            <Text accessibilityRole="header" style={styles.warning}>
              This booking is now non-refundable.
            </Text>
          )}
          <MoneyRow
            label="Booking amount"
            value={value.capturedAmountMinor}
            currency={value.currency}
          />
          {noRentalRefund ? (
            <MoneyRow
              label="Non-refundable amount"
              value={value.nonRefundableRentalMinor}
              currency={value.currency}
            />
          ) : (
            Number(value.cancellationFeeMinor) > 0 && (
              <MoneyRow
                label="Cancellation fee"
                value={value.cancellationFeeMinor}
                currency={value.currency}
              />
            )
          )}
          {Number(value.deliveryTreatment.refundedMinor) > 0 && (
            <MoneyRow
              label="Delivery refund"
              value={value.deliveryTreatment.refundedMinor}
              currency={value.currency}
            />
          )}
          {Number(value.collectionTreatment.refundedMinor) > 0 && (
            <MoneyRow
              label="Collection refund"
              value={value.collectionTreatment.refundedMinor}
              currency={value.currency}
            />
          )}
          <MoneyRow
            emphasis
            label="Refund amount"
            value={value.totalRefundMinor}
            currency={value.currency}
          />
          <Text style={styles.copy}>
            {noRentalRefund
              ? Number(value.totalRefundMinor) === 0
                ? 'If you cancel now, no refund will be issued.'
                : 'The rental amount is non-refundable. The refund shown includes eligible fulfillment fees.'
              : 'The cancellation fee is deducted from your booking amount.'}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.copy}>Your renter will receive a full refund.</Text>
          <MoneyRow
            label="Renter refund"
            value={value.totalRefundMinor}
            currency={value.currency}
          />
          <MoneyRow
            emphasis
            label="Cancellation penalty"
            value={value.ownerPenaltyMinor}
            currency={value.currency}
          />
          <Text style={styles.copy}>
            This penalty will be recovered from your future eligible earnings. Your card or bank
            account will not be charged now.
          </Text>
        </>
      )}
    </Card>
  );
}

function Success({
  role,
  result,
}: {
  readonly role: CancellationRole;
  readonly result: CancellationResult;
}) {
  const penalty =
    result.ownerFinancialObligation?.originalAmountMinor ?? result.ownerPenaltyMinor ?? '0';
  return (
    <Card style={styles.success}>
      {role === 'RENTER' ? (
        <>
          <MoneyRow
            emphasis
            label="Refund amount"
            value={result.refundAmountMinor}
            currency={result.currency}
          />
          <Text accessibilityLiveRegion="polite" style={styles.copy}>
            {Number(result.refundAmountMinor) > 0
              ? result.refundStatus === 'COMPLETED'
                ? 'Your refund has been processed. Your payment provider may take additional time to post it to your account.'
                : 'Your refund is being processed. Your payment provider may take additional time to post it to your account.'
              : 'This booking was non-refundable.'}
          </Text>
        </>
      ) : (
        <>
          <MoneyRow
            label="Renter refund"
            value={result.refundAmountMinor}
            currency={result.currency}
          />
          <MoneyRow
            emphasis
            label="Cancellation penalty"
            value={penalty}
            currency={result.currency}
          />
          <Text style={styles.copy}>
            The penalty will be recovered from your future eligible earnings. Your card or bank
            account will not be charged now.
          </Text>
        </>
      )}
    </Card>
  );
}

function MoneyRow({
  currency,
  emphasis = false,
  label,
  value,
}: {
  readonly currency: string;
  readonly emphasis?: boolean;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.moneyRow}>
      <Text style={[styles.copy, emphasis && styles.emphasis]}>{label}</Text>
      <Text
        accessibilityLabel={`${label}: ${money(Number(value), currency)}`}
        style={[styles.amount, emphasis && styles.emphasis]}
      >
        {money(Number(value), currency)}
      </Text>
    </View>
  );
}

function ErrorState({ error }: { readonly error: Error }) {
  const blocked =
    error instanceof ApiError &&
    ['CANCELLATION_BLOCKED', 'CANCELLATION_REFUND_UNAVAILABLE'].includes(error.code);
  return (
    <StateView
      icon="alert-circle-outline"
      title={blocked ? "Cancellation isn't available" : 'Cancellation could not be completed'}
      message={safeError(error)}
    />
  );
}

function safeError(error: Error) {
  if (!(error instanceof ApiError)) return error.message;
  if (error.code === 'CANCELLATION_BLOCKED')
    return 'This booking cannot be cancelled through the ordinary cancellation flow in its current state. Refresh the booking or contact support if you need help.';
  if (error.code === 'CANCELLATION_REFUND_UNAVAILABLE')
    return 'Cancellation is temporarily unavailable while payment processing is being reconciled.';
  return error.message;
}
function blockerCopy(blockers: readonly string[]) {
  if (blockers.includes('PAYMENT_RECONCILIATION_REQUIRED'))
    return 'Payment reconciliation must finish before cancellation can continue.';
  if (blockers.includes('OPERATIONAL_HOLD'))
    return 'This booking is under operational review. Contact support for help.';
  if (blockers.includes('CUSTODY_ESTABLISHED'))
    return 'The trip has already started, so ordinary cancellation is no longer available.';
  if (blockers.includes('ALREADY_CANCELLED')) return 'This booking has already been cancelled.';
  return 'This booking cannot be cancelled through the ordinary cancellation flow in its current state.';
}
function createIdempotencyKey(reference: string) {
  return `mobile-cancellation-${reference}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const styles = StyleSheet.create({
  amount: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  blocked: { backgroundColor: colors.warningSoft },
  close: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  copy: { color: colors.subtleText, fontSize: 15, lineHeight: 22 },
  emphasis: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800', marginBottom: spacing.sm },
  input: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    minHeight: 96,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  moneyRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  notice: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    color: colors.warning,
    padding: spacing.md,
  },
  reason: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  reasonSelected: { backgroundColor: colors.primarySoft, borderRadius: radius.sm },
  reasons: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  reasonText: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '700' },
  selectedReason: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  selectedReasonLabel: { color: colors.subtleText, fontSize: 15 },
  selectedReasonValue: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
    width: '100%',
  },
  success: { backgroundColor: colors.primarySoft },
  warning: { color: colors.danger, fontSize: 18, fontWeight: '900', marginBottom: spacing.sm },
});
