import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getStateFromPath, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useEffect, type ComponentProps } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '../auth/api-client';
import type { OwnerStatus } from '../auth/auth.types';
import {
  AccountScreen,
  ActiveDevicesScreen,
  LoginSecurityScreen,
  OwnerMoreScreen,
  OwnerOnboardingScreen,
  OwnerProfileScreen,
  PersonalInformationScreen,
  SettingsScreen,
  VerificationScreen,
} from '../features/account/AccountScreen';
import { MyBookingsScreen } from '../features/bookings/MyBookingsScreen';
import { OwnerBookingRequestsScreen } from '../features/bookings/OwnerBookingRequestsScreen';
import { MessagesScreen } from '../features/communications/MessagesScreen';
import { DiscoveryScreen } from '../features/discovery/DiscoveryScreen';
import { OwnerEarningsScreen } from '../features/earnings/OwnerEarningsScreen';
import { NotificationCenter } from '../features/notifications/NotificationCenter';
import { OwnerRentalsScreen } from '../features/rentals/OwnerRentalsScreen';
import { ReviewsScreen } from '../features/reviews/ReviewsScreen';
import {
  HostProfileScreen,
  PublicReviewsScreen,
} from '../features/reviews/MarketplaceReviewsScreens';
import { ClaimDetailScreen } from '../features/claims/ClaimsPanels';
import { SupportCenter } from '../features/support/SupportCenter';
import { OwnerDashboardScreen } from '../features/vehicles/OwnerDashboardScreen';
import { VehiclesScreen } from '../features/vehicles/VehiclesScreen';
import { colors } from '../theme/tokens';
import { Screen, StateView } from '../ui/primitives';
import type {
  MobileMode,
  OwnerTabParamList,
  RenterTabParamList,
  RootStackParamList,
} from './routes';
import { combinedActivityUnread, ownerBookingSurface } from './activity-routing';
import { withDeepLinkParent } from './deep-link-state';

const RenterTabs = createBottomTabNavigator<RenterTabParamList>();
const OwnerTabs = createBottomTabNavigator<OwnerTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
type IconName = ComponentProps<typeof Ionicons>['name'];

function closeToMarketplace(navigation: {
  canGoBack(): boolean;
  goBack(): void;
  navigate(name: 'Marketplace'): void;
}) {
  if (navigation.canGoBack()) navigation.goBack();
  else navigation.navigate('Marketplace');
}

interface AppNavigationProperties {
  readonly mode: MobileMode;
  readonly ownerCapable: boolean;
  readonly ownerStatus: OwnerStatus | null;
  readonly onModeChange: (mode: MobileMode) => void;
}

const renterIcons: Readonly<
  Record<keyof RenterTabParamList, { active: IconName; idle: IconName }>
> = {
  Home: { active: 'home', idle: 'home-outline' },
  Search: { active: 'search', idle: 'search-outline' },
  Bookings: { active: 'calendar', idle: 'calendar-outline' },
  Messages: { active: 'chatbubble', idle: 'chatbubble-outline' },
  Profile: { active: 'person', idle: 'person-outline' },
};
const ownerIcons: Readonly<Record<keyof OwnerTabParamList, { active: IconName; idle: IconName }>> =
  {
    Dashboard: { active: 'grid', idle: 'grid-outline' },
    Vehicles: { active: 'car-sport', idle: 'car-sport-outline' },
    Requests: { active: 'file-tray-full', idle: 'file-tray-full-outline' },
    Messages: { active: 'chatbubble', idle: 'chatbubble-outline' },
    More: { active: 'menu', idle: 'menu-outline' },
  };

function useBadges(mode: MobileMode) {
  const audience = mode.toUpperCase();
  const conversations = useQuery({
    queryKey: ['conversations', mode],
    queryFn: () =>
      apiClient.request<{ items: { unreadCount: number }[] }>(
        `/conversations?limit=50&audience=${audience}`,
      ),
    refetchInterval: 15_000,
  });
  const notifications = useQuery({
    queryKey: ['notification-summary', mode],
    queryFn: () =>
      apiClient.request<{ unreadCount: number }>(`/notifications/summary?audience=${audience}`),
    refetchInterval: 15_000,
  });
  return {
    messages: combinedActivityUnread(conversations.data?.items, notifications.data?.unreadCount),
  };
}

function tabOptions(icons: { active: IconName; idle: IconName }, bottomInset: number) {
  const safeBottom = Math.max(bottomInset, Platform.OS === 'android' ? 8 : 10);
  return {
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.subtleText,
    tabBarHideOnKeyboard: true,
    tabBarIcon: ({ color, focused, size }: { color: string; focused: boolean; size: number }) => (
      <Ionicons color={color} name={focused ? icons.active : icons.idle} size={size} />
    ),
    tabBarItemStyle: { paddingTop: 3 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' as const, marginBottom: 2 },
    tabBarStyle: {
      borderTopColor: colors.border,
      height: 54 + safeBottom,
      paddingBottom: safeBottom,
      paddingTop: 6,
    },
  };
}

function RenterNavigation({
  onModeChange,
  ownerCapable,
  ownerStatus,
}: Pick<AppNavigationProperties, 'onModeChange' | 'ownerCapable' | 'ownerStatus'>) {
  const badges = useBadges('renter');
  const insets = useSafeAreaInsets();
  return (
    <RenterTabs.Navigator
      screenOptions={({ route }) => tabOptions(renterIcons[route.name], insets.bottom)}
    >
      <RenterTabs.Screen name="Home">{() => <DiscoveryScreen home />}</RenterTabs.Screen>
      <RenterTabs.Screen name="Search">{() => <DiscoveryScreen />}</RenterTabs.Screen>
      <RenterTabs.Screen name="Bookings" component={MyBookingsScreen} />
      <RenterTabs.Screen
        name="Messages"
        options={badges.messages ? { tabBarBadge: badges.messages } : {}}
      >
        {({ route }) => (
          <MessagesScreen
            mode="renter"
            key={route.params?.conversationId ?? 'conversation-list'}
            initialConversationId={route.params?.conversationId}
          />
        )}
      </RenterTabs.Screen>
      <RenterTabs.Screen name="Profile">
        {() => (
          <AccountScreen
            onModeChange={onModeChange}
            ownerCapable={ownerCapable}
            ownerStatus={ownerStatus}
          />
        )}
      </RenterTabs.Screen>
    </RenterTabs.Navigator>
  );
}

function OwnerNavigation({
  onModeChange,
  ownerStatus,
}: Pick<AppNavigationProperties, 'onModeChange' | 'ownerStatus'>) {
  const badges = useBadges('owner');
  const insets = useSafeAreaInsets();
  return (
    <OwnerTabs.Navigator
      screenOptions={({ route }) => tabOptions(ownerIcons[route.name], insets.bottom)}
    >
      <OwnerTabs.Screen name="Dashboard">
        {() => <OwnerDashboardScreen ownerStatus={ownerStatus} />}
      </OwnerTabs.Screen>
      <OwnerTabs.Screen name="Vehicles" component={VehiclesScreen} />
      <OwnerTabs.Screen name="Requests">
        {() =>
          ownerStatus === 'VERIFIED' ? (
            <OwnerBookingRequestsScreen />
          ) : (
            <Screen eyebrow="Owner mode" title="Booking requests">
              <StateView
                icon="shield-checkmark-outline"
                title="Verification required"
                message="Complete owner verification before publishing listings or accepting booking requests."
              />
            </Screen>
          )
        }
      </OwnerTabs.Screen>
      <OwnerTabs.Screen
        name="Messages"
        options={badges.messages ? { tabBarBadge: badges.messages } : {}}
      >
        {({ route }) => (
          <MessagesScreen
            mode="owner"
            key={route.params?.conversationId ?? 'conversation-list'}
            initialConversationId={route.params?.conversationId}
          />
        )}
      </OwnerTabs.Screen>
      <OwnerTabs.Screen name="More">
        {() => <OwnerMoreScreen onModeChange={onModeChange} ownerStatus={ownerStatus} />}
      </OwnerTabs.Screen>
    </OwnerTabs.Navigator>
  );
}

export function AppNavigation(properties: AppNavigationProperties) {
  return (
    <NavigationContainer
      linking={{
        prefixes: [`${Constants.expoConfig?.extra?.appScheme ?? 'carrental'}://`],
        config: {
          screens: {
            Marketplace: 'marketplace',
            Notifications: 'notifications',
            Support: 'support/:ticketId',
            Conversation: 'messages/:conversationId',
            Booking: 'bookings/:bookingId',
            BookingRecovery: 'bookings/:bookingId/handover-recovery',
            Claim: 'claims/:claimId',
            OwnerEarnings: 'earnings',
            Payout: 'payouts/:payoutId',
            Favorites: 'favorites',
            Reviews: 'reviews',
            HostProfile: 'hosts/:hostReference',
            VehicleDetails: 'vehicles/:vehicleId',
            PublicReviews: 'reviews/public',
          },
        },
        getStateFromPath: (path, options) =>
          withDeepLinkParent(getStateFromPath(path, options), properties.mode),
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerBackTitle: 'Back',
          headerShadowVisible: false,
          headerTintColor: colors.primary,
        }}
      >
        <Stack.Screen name="Marketplace" options={{ headerShown: false }}>
          {() =>
            properties.mode === 'renter' ? (
              <RenterNavigation
                onModeChange={properties.onModeChange}
                ownerCapable={properties.ownerCapable}
                ownerStatus={properties.ownerStatus}
              />
            ) : (
              <OwnerNavigation
                onModeChange={properties.onModeChange}
                ownerStatus={properties.ownerStatus}
              />
            )
          }
        </Stack.Screen>
        <Stack.Screen
          component={PersonalInformationScreen}
          name="PersonalInformation"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          component={VerificationScreen}
          name="Verification"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          component={LoginSecurityScreen}
          name="LoginSecurity"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          component={ActiveDevicesScreen}
          name="ActiveDevices"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          component={OwnerOnboardingScreen}
          name="OwnerOnboarding"
          options={{ gestureEnabled: false, headerShown: false }}
        />
        <Stack.Screen
          component={OwnerProfileScreen}
          name="OwnerProfile"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="Notifications" options={{ headerShown: false }}>
          {() => <NotificationCenter mode={properties.mode} />}
        </Stack.Screen>
        <Stack.Screen name="Favorites" options={{ headerShown: false }}>
          {({ navigation }) => (
            <DiscoveryScreen
              initialMode="favorites"
              onExit={() => closeToMarketplace(navigation)}
            />
          )}
        </Stack.Screen>
        <Stack.Screen component={ReviewsScreen} name="Reviews" options={{ headerShown: false }} />
        <Stack.Screen
          component={HostProfileScreen}
          name="HostProfile"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          component={PublicReviewsScreen}
          name="PublicReviews"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="VehicleDetails" options={{ headerShown: false }}>
          {({ navigation, route }) => (
            <DiscoveryScreen
              initialVehicleId={route.params.vehicleId}
              onExit={() => closeToMarketplace(navigation)}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Conversation" options={{ headerShown: false }}>
          {({ navigation, route }) => (
            <ConversationDestination
              conversationId={route.params.conversationId}
              mode={properties.mode}
              onClose={() => closeToMarketplace(navigation)}
              onModeChange={properties.onModeChange}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Booking" options={{ headerShown: false }}>
          {({ navigation, route }) =>
            properties.mode === 'owner' ? (
              <OwnerBookingDestination
                reference={route.params.bookingId}
                onClose={() => closeToMarketplace(navigation)}
              />
            ) : (
              <MyBookingsScreen
                initialBookingReference={route.params.bookingId}
                onClose={() => closeToMarketplace(navigation)}
              />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="BookingRecovery" options={{ headerShown: false }}>
          {({ navigation, route }) => (
            <MyBookingsScreen
              focusRecovery
              initialBookingReference={route.params.bookingId}
              onClose={() => closeToMarketplace(navigation)}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Claim" options={{ headerShown: false }}>
          {({ navigation, route }) => (
            <ClaimDetailScreen
              claimId={route.params.claimId}
              ownerMode={properties.mode === 'owner'}
              onBack={() => closeToMarketplace(navigation)}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Support" options={{ headerShown: false }}>
          {({ route }) => <SupportCenter initialTicketId={route.params?.ticketId} />}
        </Stack.Screen>
        <Stack.Screen component={SettingsScreen} name="Settings" options={{ headerShown: false }} />
        <Stack.Screen
          component={OwnerRentalsScreen}
          name="OwnerRentals"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          component={OwnerEarningsScreen}
          name="OwnerEarnings"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="Payout" options={{ headerShown: false }}>
          {() => <OwnerEarningsScreen />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function ConversationDestination({
  conversationId,
  mode,
  onClose,
  onModeChange,
}: {
  readonly conversationId: string;
  readonly mode: MobileMode;
  readonly onClose: () => void;
  readonly onModeChange: (mode: MobileMode) => void;
}) {
  const context = useQuery({
    queryKey: ['conversation-context', conversationId],
    queryFn: () =>
      apiClient.request<{ context: 'RENTER' | 'OWNER' | 'SUPPORT' }>(
        `/conversations/${conversationId}/context`,
      ),
  });
  const requiredMode = context.data?.context === 'OWNER' ? 'owner' : 'renter';
  useEffect(() => {
    if (context.data?.context !== 'SUPPORT' && requiredMode !== mode) onModeChange(requiredMode);
  }, [context.data?.context, mode, onModeChange, requiredMode]);
  if (context.isPending || (context.data?.context !== 'SUPPORT' && requiredMode !== mode))
    return (
      <Screen eyebrow="Messages" title="Opening conversation">
        <StateView loading title="Restoring the correct conversation perspective…" />
      </Screen>
    );
  if (context.isError)
    return (
      <Screen eyebrow="Messages" title="Conversation unavailable">
        <StateView
          icon="alert-circle-outline"
          title="This conversation is unavailable"
          message={context.error.message}
          actionLabel="Back"
          onAction={onClose}
        />
      </Screen>
    );
  return <MessagesScreen mode={mode} initialConversationId={conversationId} onClose={onClose} />;
}

function OwnerBookingDestination({
  reference,
  onClose,
}: {
  readonly reference: string;
  readonly onClose: () => void;
}) {
  const booking = useQuery({
    queryKey: ['owner-booking-destination', reference],
    queryFn: () => apiClient.request<{ status: string }>(`/owner/bookings/${reference}`),
  });
  if (booking.isPending)
    return (
      <Screen eyebrow="Owner mode" title="Opening booking">
        <StateView loading title="Resolving current booking status…" />
      </Screen>
    );
  if (booking.isError)
    return (
      <Screen eyebrow="Owner mode" title="Booking activity">
        <StateView
          icon="alert-circle-outline"
          title="Booking unavailable"
          message={booking.error.message}
          actionLabel="Back"
          onAction={onClose}
        />
      </Screen>
    );
  return ownerBookingSurface(booking.data.status) === 'rental' ? (
    <OwnerRentalsScreen initialBookingReference={reference} onClose={onClose} />
  ) : (
    <OwnerBookingRequestsScreen initialBookingReference={reference} onClose={onClose} />
  );
}
