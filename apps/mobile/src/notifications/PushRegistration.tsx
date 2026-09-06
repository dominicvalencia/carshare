import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { apiClient } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateBookingLifecycle } from '../query/booking-invalidation';
import { invalidateRenterVerification } from '../query/verification-invalidation';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function PushRegistration() {
  const auth = useAuth();
  const client = useQueryClient();
  useEffect(() => {
    if (!auth.user) return;
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        invalidateBookingLifecycle(client);
        void invalidateRenterVerification(client);
        const link = response.notification.request.content.data?.deepLink;
        if (typeof link === 'string' && isAllowedPushDeepLink(link)) void Linking.openURL(link);
      },
    );
    const receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      invalidateBookingLifecycle(client);
      void invalidateRenterVerification(client);
    });
    if (Device.isDevice && (Platform.OS === 'ios' || Platform.OS === 'android')) void register();
    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, [auth.user, client]);
  return null;
}

async function register() {
  try {
    const existing = await Notifications.getPermissionsAsync();
    const permission =
      existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return;
    const projectId = Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_PROJECT_ID;
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const environment = Constants.expoConfig?.extra?.appEnvironment;
    const appIdentifier = Constants.expoConfig?.extra?.appIdentifier;
    if (typeof environment !== 'string' || typeof appIdentifier !== 'string') return;
    await apiClient.request('/push-tokens', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'EXPO',
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        token,
        environment,
        appIdentifier,
      }),
    });
  } catch {
    /* Push is additive; the in-app inbox remains authoritative. */
  }
}

const ALLOWED_PUSH_TARGETS = new Set([
  'bookings',
  'messages',
  'claims',
  'support',
  'notifications',
  'vehicles',
  'hosts',
  'earnings',
  'payouts',
]);

export function isAllowedPushDeepLink(value: string): boolean {
  try {
    const expectedScheme = Constants.expoConfig?.extra?.appScheme ?? 'carrental';
    const parsed = new URL(value);
    return parsed.protocol === `${expectedScheme}:` && ALLOWED_PUSH_TARGETS.has(parsed.hostname);
  } catch {
    return false;
  }
}
