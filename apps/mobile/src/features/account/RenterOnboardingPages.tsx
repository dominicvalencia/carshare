import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { Button, Card, Field, Screen, StateView } from '../../ui/primitives';
import { invalidateRenterVerification } from '../../query/verification-invalidation';
import type { RenterVerificationSnapshot } from './AccountScreen';
import { RenterVerificationWorkflow } from './RenterVerificationWorkflow';

export function RenterOnboardingKycPage({
  onBack,
  onNext,
  step,
}: {
  readonly onBack: () => void;
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
    <Screen
      safeTop={false}
      scroll
      title={onboardingTitle(step)}
      subtitle={onboardingSubtitle(step)}
    >
      <RenterVerificationWorkflow
        onboardingNavigation={{ onBack, onNext, step }}
        snapshot={verification.data}
      />
    </Screen>
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
  const inbox = useQuery({
    enabled: false,
    queryKey: ['development-auth-deliveries'],
    queryFn: () =>
      apiClient.request<{
        items: readonly {
          channel: 'EMAIL' | 'SMS';
          secret: string;
          template: string;
        }[];
      }>('/development/auth-deliveries'),
    retry: false,
  });
  const requestEmail = useMutation({
    mutationFn: () => apiClient.request('/auth/email-verification/requests', { method: 'POST' }),
    onSuccess: () => void inbox.refetch(),
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
      void inbox.refetch();
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
  const latestOtp = inbox.data?.items.find(
    ({ channel, template }) => channel === 'SMS' && template === 'MOBILE_VERIFICATION_OTP',
  );
  return (
    <Screen
      safeTop={false}
      scroll
      title="Contact verification"
      subtitle="Secure your account with a verified email address and mobile number."
    >
      <Card>
        <Text>Email</Text>
        <Text>{snapshot.email}</Text>
        <Text>{snapshot.emailVerifiedAt ? '✓ Email verified' : 'Email verification needed'}</Text>
        {!snapshot.emailVerifiedAt && (
          <Button
            disabled={requestEmail.isPending}
            label={requestEmail.isPending ? 'Sending…' : 'Send verification email'}
            onPress={() => requestEmail.mutate()}
            variant="secondary"
          />
        )}
      </Card>
      <Card>
        <Text>Mobile number</Text>
        {snapshot.mobileVerifiedAt ? (
          <Text>✓ Mobile number verified</Text>
        ) : (
          <>
            <Field
              keyboardType="phone-pad"
              label="Philippine mobile number"
              placeholder="09XXXXXXXXX"
              value={mobile || snapshot.mobileNumber || ''}
              onChangeText={setMobile}
            />
            <Button
              disabled={!mobile || requestMobile.isPending}
              label={requestMobile.isPending ? 'Sending…' : 'Send verification code'}
              onPress={() => requestMobile.mutate()}
              variant="secondary"
            />
            {challengeId && (
              <>
                <Field
                  keyboardType="number-pad"
                  label="6-digit verification code"
                  value={code}
                  onChangeText={(value) => setCode(value.replaceAll(/\D/g, '').slice(0, 6))}
                />
                <Button
                  disabled={code.length !== 6 || verifyMobile.isPending}
                  label="Verify mobile"
                  onPress={() => verifyMobile.mutate()}
                />
              </>
            )}
          </>
        )}
      </Card>
      {__DEV__ && (
        <Button
          label="Open local verification inbox"
          onPress={() => void inbox.refetch()}
          variant="ghost"
        />
      )}
      {__DEV__ && latestOtp && (
        <Button
          label="Use latest mobile code"
          onPress={() => setCode(latestOtp.secret)}
          variant="secondary"
        />
      )}
      {(requestEmail.error || requestMobile.error || verifyMobile.error) && (
        <Text>We couldn’t complete verification right now. Please try again.</Text>
      )}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button label="Back" onPress={onBack} variant="secondary" />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Next" onPress={onNext} />
        </View>
      </View>
    </Screen>
  );
}

function onboardingTitle(step: number): string {
  return (
    (
      {
        0: 'Personal information',
        1: 'Address',
        2: 'Driver’s license',
        4: 'Verification documents',
        5: 'Selfie',
        6: 'Review & finish',
      } as Record<number, string>
    )[step] ?? 'Verification'
  );
}

function onboardingSubtitle(step: number): string {
  return (
    (
      {
        0: 'Tell us a little about yourself.',
        1: 'Where do you currently live?',
        2: 'Add the license you’ll use when renting.',
        4: 'Securely capture the required evidence.',
        5: 'Take a clear photo for manual identity review.',
        6: 'Check everything before submitting.',
      } as Record<number, string>
    )[step] ?? ''
  );
}
