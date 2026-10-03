import type {
  OwnerPayoutMethodCatalog,
  OwnerPayoutMethodCatalogField,
  OwnerPayoutMethodCatalogItem,
  OwnerPayoutMethodType,
} from '@carrental/api-contracts';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, apiClient } from '../../auth/api-client';
import type { RootStackParamList } from '../../navigation/routes';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import {
  Button,
  Card,
  Field,
  Icon,
  NestedScreen,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import { payoutMethodStatusPresentation } from './PayoutPanels';

type Navigator = NavigationProp<RootStackParamList>;
type FlowStep = 'TYPE' | 'INSTITUTION' | 'DETAILS' | 'REVIEW' | 'RESULT';
type FieldValues = Record<OwnerPayoutMethodCatalogField['key'], string>;

interface CreatedPayoutAccount {
  readonly accountHolderName: string;
  readonly destinationChannel: string;
  readonly id: string;
  readonly isDefault: boolean;
  readonly maskedAccountIdentifier: string;
  readonly status: string;
  readonly type: string;
}

const initialValues: FieldValues = { ACCOUNT_HOLDER_NAME: '', ACCOUNT_IDENTIFIER: '' };

export function OwnerAddPayoutMethodScreen() {
  const navigation = useNavigation<Navigator>();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<FlowStep>('TYPE');
  const [selectedType, setSelectedType] = useState<OwnerPayoutMethodType | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<OwnerPayoutMethodCatalogItem | null>(null);
  const [values, setValues] = useState<FieldValues>(initialValues);
  const [touched, setTouched] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPayoutAccount | null>(null);
  const catalog = useQuery({
    queryKey: ['owner-payout-method-catalog'],
    queryFn: () => apiClient.request<OwnerPayoutMethodCatalog>('/owner/payout-methods/catalog'),
  });
  const create = useMutation({
    mutationFn: () =>
      apiClient.request<CreatedPayoutAccount>('/owner/payout-accounts', {
        body: JSON.stringify({
          accountHolderName: values.ACCOUNT_HOLDER_NAME.trim(),
          accountIdentifier: values.ACCOUNT_IDENTIFIER.trim(),
          destinationChannel: selectedMethod?.code,
          type: selectedMethod?.type,
        }),
        method: 'POST',
      }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'PAYOUT_METHOD_DUPLICATE') {
        setSubmissionError('This payout method has already been added.');
        return;
      }
      if (error instanceof ApiError && error.code === 'PAYOUT_METHOD_UNSUPPORTED') {
        setSubmissionError('This payout method is not supported. Choose another option.');
        setStep('INSTITUTION');
        return;
      }
      setSubmissionError('We could not add this payout method. Check your details and try again.');
    },
    onSuccess: (result) => {
      setCreated(result);
      setSubmissionError(null);
      void queryClient.invalidateQueries({ queryKey: ['owner-payout-methods'] });
      setStep('RESULT');
    },
  });

  const types = useMemo(
    () => [...new Set(catalog.data?.methods.map((method) => method.type) ?? [])],
    [catalog.data],
  );
  const methods = useMemo(
    () => catalog.data?.methods.filter((method) => method.type === selectedType) ?? [],
    [catalog.data, selectedType],
  );
  const errors = selectedMethod
    ? validateFields(selectedMethod.fields, values, selectedMethod.type)
    : {};
  const canContinue = selectedMethod ? Object.keys(errors).length === 0 : false;

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['owner-payout-methods'] });
    navigation.navigate('OwnerPayoutMethods');
  };
  const back = () => {
    setSubmissionError(null);
    if (step === 'RESULT') return done();
    if (step === 'REVIEW') return setStep('DETAILS');
    if (step === 'DETAILS') return setStep('INSTITUTION');
    if (step === 'INSTITUTION') return setStep('TYPE');
    navigation.goBack();
  };

  if (catalog.isPending) {
    return (
      <NestedScreen title="Add payout method" onBack={() => navigation.goBack()}>
        <StateView compact loading title="Loading payout options…" />
      </NestedScreen>
    );
  }
  if (catalog.isError || !catalog.data) {
    return (
      <NestedScreen title="Add payout method" onBack={() => navigation.goBack()}>
        <StateView
          compact
          icon="cloud-offline-outline"
          title="Payout options unavailable"
          message="We couldn't load the supported payout methods."
          actionLabel="Retry"
          onAction={() => void catalog.refetch()}
        />
      </NestedScreen>
    );
  }

  if (step === 'RESULT' && created && selectedMethod) {
    const status = createdStatusPresentation(created.status);
    return (
      <NestedScreen
        title="Payout method added"
        subtitle={status.message}
        backLabel="Done"
        onBack={done}
      >
        <View
          accessibilityLabel={`Payout method added. ${selectedMethod.displayName}. ${created.maskedAccountIdentifier}. ${status.badge.label}.`}
          style={styles.result}
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon color={colors.primary} name="checkmark-circle-outline" size={42} />
          </View>
          <Text style={styles.resultInstitution}>{selectedMethod.displayName}</Text>
          <Text style={styles.masked}>{created.maskedAccountIdentifier}</Text>
          <StatusBadge label={status.badge.label} tone={status.badge.tone} />
          {created.isDefault && (
            <Text style={styles.helper}>
              This first ready method is now your primary payout method.
            </Text>
          )}
        </View>
        <Button label="Done" onPress={done} />
      </NestedScreen>
    );
  }

  if (step === 'TYPE') {
    return (
      <NestedScreen
        title="Add payout method"
        subtitle="Choose how you want to receive payouts"
        onBack={back}
      >
        <View style={styles.selectionList}>
          {types.map((type) => {
            const presentation = typePresentation(type);
            return (
              <SelectionRow
                key={type}
                icon={presentation.icon}
                title={presentation.title}
                subtitle={presentation.subtitle}
                onPress={() => {
                  setSelectedType(type);
                  setSelectedMethod(null);
                  setStep('INSTITUTION');
                }}
              />
            );
          })}
        </View>
      </NestedScreen>
    );
  }

  if (step === 'INSTITUTION') {
    const type = selectedType ? typePresentation(selectedType) : null;
    return (
      <NestedScreen
        title={type?.providerTitle ?? 'Choose a provider'}
        subtitle="Select where your payouts should be sent."
        onBack={back}
      >
        <Card style={styles.providerList}>
          {methods.map((method, index) => (
            <SelectionRow
              compact
              key={method.code}
              icon={type?.icon ?? 'wallet-outline'}
              title={method.displayName}
              divider={index < methods.length - 1}
              onPress={() => {
                setSelectedMethod(method);
                setSubmissionError(null);
                setStep('DETAILS');
              }}
            />
          ))}
        </Card>
        {submissionError && <InlineNotice message={submissionError} />}
      </NestedScreen>
    );
  }

  if (step === 'DETAILS' && selectedMethod) {
    return (
      <NestedScreen
        title="Enter payout details"
        subtitle={selectedMethod.displayName}
        onBack={back}
      >
        <Card style={styles.formCard}>
          {selectedMethod.fields.map((field) => (
            <Field
              key={field.key}
              label={fieldLabel(field, selectedMethod.type)}
              value={values[field.key]}
              error={touched ? errors[field.key] : undefined}
              keyboardType="default"
              returnKeyType={field.key === 'ACCOUNT_IDENTIFIER' ? 'done' : 'next'}
              onChangeText={(value) => {
                setSubmissionError(null);
                setValues((current) => ({ ...current, [field.key]: value }));
              }}
            />
          ))}
          <Text style={styles.helper}>
            Make sure these details are correct. They may be verified before payouts can be sent.
          </Text>
        </Card>
        {submissionError && <InlineNotice message={submissionError} />}
        <Button
          label="Continue"
          disabled={!canContinue}
          onPress={() => {
            setTouched(true);
            if (canContinue) setStep('REVIEW');
          }}
        />
      </NestedScreen>
    );
  }

  return (
    <NestedScreen
      eyebrow="Review payout method"
      title="Check your details"
      subtitle="Confirm the payout details before adding this method."
      onBack={back}
    >
      {selectedMethod && (
        <Card style={styles.reviewCard}>
          <ReviewRow label="Payout method" value={typePresentation(selectedMethod.type).title} />
          <ReviewRow label="Institution" value={selectedMethod.displayName} />
          <ReviewRow label="Account holder" value={values.ACCOUNT_HOLDER_NAME.trim()} />
          <ReviewRow label="Account" value={maskIdentifier(values.ACCOUNT_IDENTIFIER)} />
        </Card>
      )}
      <Text style={styles.helper}>
        This payout method may require verification before it can receive payouts.
      </Text>
      {submissionError && <InlineNotice message={submissionError} />}
      <Button
        label={create.isPending ? 'Adding payout method…' : 'Add payout method'}
        disabled={create.isPending}
        onPress={() => {
          if (!create.isPending) create.mutate();
        }}
      />
    </NestedScreen>
  );
}

function SelectionRow({
  compact = false,
  divider = false,
  icon,
  onPress,
  subtitle,
  title,
}: {
  readonly compact?: boolean;
  readonly divider?: boolean;
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly onPress: () => void;
  readonly subtitle?: string;
  readonly title: string;
}) {
  return (
    <Pressable
      accessibilityHint="Opens the next step"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectionRow,
        compact && styles.selectionRowCompact,
        divider && styles.divider,
        pressed && styles.pressed,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.icon}
      >
        <Icon color={colors.primary} name={icon} size={22} />
      </View>
      <View style={styles.selectionCopy}>
        <Text style={styles.selectionTitle}>{title}</Text>
        {subtitle && <Text style={styles.selectionSubtitle}>{subtitle}</Text>}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon color={colors.subtleText} name="chevron-forward" size={19} />
      </View>
    </Pressable>
  );
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

function InlineNotice({ message }: { readonly message: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

function typePresentation(type: OwnerPayoutMethodType) {
  if (type === 'BANK_ACCOUNT') {
    return {
      icon: 'business-outline' as const,
      providerTitle: 'Choose your bank',
      subtitle: 'Receive payouts to your bank',
      title: 'Bank account',
    };
  }
  return {
    icon: 'phone-portrait-outline' as const,
    providerTitle: 'Choose your e-wallet',
    subtitle: 'Receive payouts to your wallet',
    title: 'E-wallet',
  };
}

function validateFields(
  fields: readonly OwnerPayoutMethodCatalogField[],
  values: FieldValues,
  type: OwnerPayoutMethodType,
): Partial<Record<OwnerPayoutMethodCatalogField['key'], string>> {
  const errors: Partial<Record<OwnerPayoutMethodCatalogField['key'], string>> = {};
  for (const field of fields) {
    const value = values[field.key].trim();
    const label = fieldLabel(field, type);
    if (!value) errors[field.key] = `${label} is required`;
    else if (value.length < field.minLength)
      errors[field.key] = `${label} must be at least ${field.minLength} characters`;
    else if (value.length > field.maxLength)
      errors[field.key] = `${label} must be ${field.maxLength} characters or fewer`;
  }
  return errors;
}

function fieldLabel(field: OwnerPayoutMethodCatalogField, type: OwnerPayoutMethodType): string {
  if (field.key !== 'ACCOUNT_IDENTIFIER') return field.label;
  return type === 'BANK_ACCOUNT' ? 'Account number' : 'Wallet or mobile number';
}

export function maskIdentifier(value: string) {
  const trimmed = value.trim();
  const suffix = trimmed.slice(-4);
  return `${'•'.repeat(Math.max(4, Math.min(8, trimmed.length - suffix.length)))} ${suffix}`;
}

function createdStatusPresentation(status: string) {
  const projected =
    status === 'ACTIVE'
      ? 'READY'
      : status === 'PENDING_VERIFICATION'
        ? 'PENDING_VERIFICATION'
        : status === 'REQUIRES_ACTION'
          ? 'NEEDS_ATTENTION'
          : 'UNAVAILABLE';
  const badge = payoutMethodStatusPresentation(projected);
  const message =
    projected === 'READY'
      ? 'Your payout method is ready to receive payouts.'
      : projected === 'PENDING_VERIFICATION'
        ? 'Verification is still in progress.'
        : projected === 'NEEDS_ATTENTION'
          ? 'Additional information may be required before payouts can be sent.'
          : 'This payout method is currently unavailable.';
  return { badge, message };
}

const styles = StyleSheet.create({
  divider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  formCard: { gap: spacing.lg },
  helper: { color: colors.subtleText, fontSize: typography.body, lineHeight: 22 },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  masked: { color: colors.subtleText, fontSize: 18, lineHeight: 25 },
  notice: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { color: colors.danger, fontSize: typography.body, lineHeight: 21 },
  pressed: { opacity: 0.62 },
  providerList: { borderRadius: radius.lg, overflow: 'hidden', padding: 0 },
  result: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  resultInstitution: { color: colors.ink, fontSize: typography.heading, fontWeight: '900' },
  reviewCard: { gap: spacing.lg },
  reviewLabel: { color: colors.subtleText, fontSize: typography.label, fontWeight: '700' },
  reviewRow: { gap: spacing.xs },
  reviewValue: { color: colors.ink, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionList: { gap: spacing.md },
  selectionRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 92,
    padding: spacing.lg,
  },
  selectionRowCompact: { borderRadius: 0, borderWidth: 0, minHeight: 72, padding: spacing.md },
  selectionSubtitle: {
    color: colors.subtleText,
    fontSize: typography.body,
    lineHeight: 21,
    marginTop: spacing.xxs,
  },
  selectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', lineHeight: 23 },
});
