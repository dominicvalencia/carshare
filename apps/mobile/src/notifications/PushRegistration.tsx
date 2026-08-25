import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { apiClient } from '../auth/api-client';
import { useAuth } from '../auth/AuthProvider';

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
  useEffect(() => {
    if (!auth.user) return;
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const link = response.notification.request.content.data?.deepLink;
        if (typeof link === 'string' && link.startsWith('carrental://')) void Linking.openURL(link);
      },
    );
    if (Device.isDevice && (Platform.OS === 'ios' || Platform.OS === 'android')) void register();
    return () => responseSubscription.remove();
  }, [auth.user]);
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
    await apiClient.request('/push-tokens', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'EXPO',
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        token,
      }),
    });
  } catch {
    /* Push is additive; the in-app inbox remains authoritative. */
  }
}
