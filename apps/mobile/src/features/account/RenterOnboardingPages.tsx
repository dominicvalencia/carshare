import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import {
  Button,
  Card,
  Field,
  NestedScreen,
  Screen,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import { colors, spacing } from '../../theme/tokens';
import { invalidateRenterVerification } from '../../query/verification-invalidation';
import type { RenterVerificationSnapshot } from './AccountScreen';
import {
  RenterOnboardingDraftProvider,
  RenterVerificationWorkflow,
} from './RenterVerificationWorkflow';
import { GuidedOnboarding, RenterOnboardingFooter } from '../../onboarding/GuidedOnboarding';
import {
  RENTER_PROFILE_VERIFICATION_STEPS,
  renterVerificationPageForStep,
} from '../../onboarding/renter-onboarding-steps';

export function RenterOnboardingKycPage({
  editingApproved = false,
  onBack,
  onEdit,
  onNext,
  step,
}: {
  readonly editingApproved?: boolean;
  readonly onBack: () => void;
  readonly onEdit: (step: number) => void;
  readonly onNext: () => void;
  readonly step: number;
}) {
  const verification = useQuery({
    queryKey: ['renter-verification'],
    queryFn: () => apiClient.request<RenterVerificationSnapshot>('/renter-verification'),
  });
  if (verification.isPending) return <StateView loading title="Loading your saved progress…" />;
  if (!verification.data)
    return (
      <StateView
        title="Verification unavailable"
        message="Your saved verification progress could not be loaded. Check your connection and try again."
        actionLabel="Retry"
        onAction={() => void verification.refetch()}
      />
    );
  return (
    <RenterVerificationWorkflow
      editingApprovedInitially={editingApproved}
      onboardingScreen={{ subtitle: onboardingSubtitle(step), title: onboardingTitle(step) }}
      onboardingNavigation={{ onBack, onNext, step }}
      onEditStep={onEdit}
      snapshot={verification.data}
    />
  );
}

export function RenterProfileVerificationFlow({ onExit }: { readonly onExit: () => void }) {
  const [page, setPage] = useState(0);
  const [editingApproved, setEditingApproved] = useState(false);
  const verification = useQuery({
    queryKey: ['renter-verification'],
    queryFn: () => apiClient.request<RenterVerificationSnapshot>('/renter-verification'),
  });
  if (verification.isPending)
    return (
      <NestedScreen
        eyebrow="Account"
        onBack={onExit}
        subtitle="Review and manage the information used to verify your renter account."
        title="Verification"
      >
        <StateView loading title="Checking verification…" />
      </NestedScreen>
    );
  if (!verification.data)
    return (
      <NestedScreen
        eyebrow="Account"
        onBack={onExit}
        subtitle="Review and manage the information used to verify your renter account."
        title="Verification"
      >
        <StateView
          actionLabel="Retry"
          message="Your verification details could not be loaded."
          onAction={() => void verification.refetch()}
          title="Verification unavailable"
        />
      </NestedScreen>
    );
  const snapshot = verification.data;
  const pending = ['SUBMITTED', 'UNDER_REVIEW'].includes(snapshot.eligibility.status);
  const approved = snapshot.eligibility.status === 'APPROVED';
  if (pending)
    return (
      <NestedScreen
        eyebrow="Account"
        onBack={onExit}
        subtitle="Review and manage the information used to verify your renter account."
        title="Verification"
      >
        <StateView
          icon="time-outline"
          message="Your server-persisted evidence is preserved while authorized staff review it."
          title="Verification under review"
        />
      </NestedScreen>
    );
  if (approved && !editingApproved)
    return (
      <NestedScreen
        eyebrow="Account"
        onBack={onExit}
        subtitle="Review and manage the information used to verify your renter account."
        title="Verification"
      >
        <StateView
          icon="checkmark-circle-outline"
          message="Material identity, address, or driver changes require reverification."
          title="Verification approved"
        />
        <Button
          label="Edit verified details"
          onPress={() =>
            Alert.alert(
              'Reverification required',
              'Saving changes to your legal identity, residential address, or driver information returns your verification to draft and pauses rental eligibility until staff approve it again.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Continue editing', onPress: () => setEditingApproved(true) },
              ],
            )
          }
          variant="secondary"
        />
      </NestedScreen>
    );

  const renderPage = (index: number) => {
    const definition = RENTER_PROFILE_VERIFICATION_STEPS[index];
    if (!definition) return null;
    const previous = () => (index === 0 ? onExit() : setPage(index - 1));
    const next = () =>
      definition.id === 'REVIEW'
        ? onExit()
        : setPage(Math.min(index + 1, RENTER_PROFILE_VERIFICATION_STEPS.length - 1));
    if (definition.id === 'CONTACT_VERIFICATION')
      return <RenterOnboardingContactPage onBack={previous} onNext={next} />;
    if (!('kycStep' in definition)) return null;
    return (
      <RenterOnboardingKycPage
        editingApproved={editingApproved}
        onBack={previous}
        onEdit={(targetStep) =>
          setPage(
            targetStep === -1
              ? renterVerificationPageForStep('CONTACT_VERIFICATION')
              : RENTER_PROFILE_VERIFICATION_STEPS.findIndex(
                  (step) => 'kycStep' in step && step.kycStep === targetStep,
                ),
          )
        }
        onNext={next}
        step={definition.kycStep}
      />
    );
  };

  return (
    <RenterOnboardingDraftProvider>
      <GuidedOnboarding
        currentPage={page}
        onExit={onExit}
        onPageChange={setPage}
        pageCount={RENTER_PROFILE_VERIFICATION_STEPS.length}
        pageKeys={RENTER_PROFILE_VERIFICATION_STEPS.map(({ id }) => id)}
        subtitle="Review and manage the information used to verify your renter account."
        title="Verification"
      >
        {RENTER_PROFILE_VERIFICATION_STEPS.map((_step, index) => renderPage(index))}
      </GuidedOnboarding>
    </RenterOnboardingDraftProvider>
  );
}

export function RenterOnboardingContactPage({
  onBack,
  onNext,
}: {
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  const client = useQueryClient();
  const [mobile, setMobile] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const verification = useQuery({
    queryKey: ['renter-verification'],
    queryFn: () => apiClient.request<RenterVerificationSnapshot>('/renter-verification'),
  });
  const requestEmail = useMutation({
    mutationFn: () => apiClient.request('/auth/email-verification/requests', { method: 'POST' }),
  });
  const requestMobile = useMutation({
    mutationFn: () =>
      apiClient.request<{ readonly challengeId?: string; readonly mobileNumber: string }>(
        '/auth/mobile-verification/requests',
        {
          body: JSON.stringify({ mobileNumber: mobile, platform: 'UNKNOWN' }),
          method: 'POST',
        },
      ),
    onSuccess: (result) => {
      setChallengeId(result.challengeId ?? '');
      setMobile(result.mobileNumber);
    },
  });
  const verifyMobile = useMutation({
    mutationFn: () =>
      apiClient.request('/auth/otp/verifications', {
        body: JSON.stringify({ challengeId, code, platform: 'UNKNOWN' }),
        method: 'POST',
      }),
    onSuccess: () => {
      setChallengeId('');
      setCode('');
      void invalidateRenterVerification(client);
    },
  });
  if (verification.isPending) return <StateView loading title="Checking contact details…" />;
  if (!verification.data)
    return (
      <StateView
        title="Contact verification unavailable"
        message="Your contact details could not be loaded. Check your connection and try again."
        actionLabel="Retry"
        onAction={() => void verification.refetch()}
      />
    );
  const snapshot = verification.data;
  const emailStatus = snapshot.emailVerifiedAt
    ? { label: 'Verified', tone: 'success' as const }
    : requestEmail.isSuccess
      ? { label: 'Email sent', tone: 'warning' as const }
      : { label: 'Not verified', tone: 'warning' as const };
  const mobileStatus = snapshot.mobileVerifiedAt
    ? { label: 'Verified', tone: 'success' as const }
    : challengeId
      ? { label: 'Verification sent', tone: 'warning' as const }
      : { label: 'Not verified', tone: 'warning' as const };
  return (
    <Screen
      bottomAccessory={
        <RenterOnboardingFooter onBack={onBack} onPrimary={onNext} primaryLabel="Continue" />
      }
      safeTop={false}
      scroll
      title="Contact verification"
      subtitle="Verify your email and mobile number to secure your account and receive booking updates."
    >
      <Card style={styles.verificationCard}>
        <View style={styles.verificationHeading}>
          <Text style={styles.sectionTitle}>Email</Text>
          <StatusBadge label={emailStatus.label} tone={emailStatus.tone} />
        </View>
        <Text style={styles.contactValue}>{snapshot.email}</Text>
        {!snapshot.emailVerifiedAt &&
          (requestEmail.isSuccess ? (
            <Pressable
              accessibilityRole="button"
              disabled={requestEmail.isPending}
              onPress={() => requestEmail.mutate()}
              style={styles.textAction}
            >
              <Text style={styles.textActionLabel}>
                {requestEmail.isPending ? 'Sending…' : 'Resend verification email'}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.compactAction}>
              <Button
                disabled={requestEmail.isPending}
                label={requestEmail.isPending ? 'Sending…' : 'Send verification email'}
                onPress={() => requestEmail.mutate()}
                variant="secondary"
              />
            </View>
          ))}
        {requestEmail.isError && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            We couldn’t send the verification email. Please try again.
          </Text>
        )}
      </Card>
      <Card style={styles.verificationCard}>
        <View style={styles.verificationHeading}>
          <Text style={styles.sectionTitle}>Mobile number</Text>
          <StatusBadge label={mobileStatus.label} tone={mobileStatus.tone} />
        </View>
        {snapshot.mobileVerifiedAt ? (
          <Text style={styles.contactValue}>{snapshot.mobileNumber}</Text>
        ) : (
          <>
            <Field
              keyboardType="phone-pad"
              label="Philippine mobile number"
              placeholder="09XXXXXXXXX"
              value={mobile || snapshot.mobileNumber || ''}
              onChangeText={setMobile}
            />
            {!challengeId && (
              <View style={styles.compactAction}>
                <Button
                  disabled={!mobile || requestMobile.isPending}
                  label={requestMobile.isPending ? 'Sending…' : 'Send verification code'}
                  onPress={() => requestMobile.mutate()}
                  variant="secondary"
                />
              </View>
            )}
            {challengeId && (
              <View style={styles.otpSection}>
                <Field
                  keyboardType="number-pad"
                  label="Verification code"
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChangeText={(value) => setCode(value.replaceAll(/\D/g, '').slice(0, 6))}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={requestMobile.isPending}
                  onPress={() => requestMobile.mutate()}
                  style={styles.textAction}
                >
                  <Text style={styles.textActionLabel}>
                    {requestMobile.isPending ? 'Sending…' : 'Resend code'}
                  </Text>
                </Pressable>
                <View style={styles.compactAction}>
                  <Button
                    disabled={code.length !== 6 || verifyMobile.isPending}
                    label={verifyMobile.isPending ? 'Verifying…' : 'Verify number'}
                    onPress={() => verifyMobile.mutate()}
                  />
                </View>
              </View>
            )}
          </>
        )}
        {(requestMobile.isError || verifyMobile.isError) && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {verifyMobile.isError
              ? 'We couldn’t verify that code. Check it and try again.'
              : 'We couldn’t send a verification code. Please try again.'}
          </Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  compactAction: { alignSelf: 'flex-start', minWidth: 180 },
  contactValue: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  otpSection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  textAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 44,
  },
  textActionLabel: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  verificationCard: { gap: spacing.sm },
  verificationHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
});

function onboardingTitle(step: number): string {
  return (
    (
      {
        0: 'Personal information',
        1: 'Residential address',
        2: 'Driver’s license',
        3: 'Emergency contact',
        4: 'Identity documents',
        5: 'Identity photos',
        6: 'Review & finish',
      } as Record<number, string>
    )[step] ?? 'Verification'
  );
}

function onboardingSubtitle(step: number): string {
  return (
    (
      {
        0: 'Enter the details shown on your government-issued ID.',
        1: 'Enter the address shown on your proof of address.',
        2: 'Add the license you’ll use when renting.',
        3: 'Add someone we can contact in an emergency, or continue without one.',
        4: 'Capture clear photos of the documents required to verify your identity.',
        5: 'Add your profile photo and a private selfie with your driver’s license.',
        6: 'Check everything before submitting.',
      } as Record<number, string>
    )[step] ?? ''
  );
}
