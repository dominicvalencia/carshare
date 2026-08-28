import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
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

const RenterTabs = createBottomTabNavigator<RenterTabParamList>();
const OwnerTabs = createBottomTabNavigator<OwnerTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
type IconName = ComponentProps<typeof Ionicons>['name'];

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

function useBadges() {
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () =>
      apiClient.request<{ items: { unreadCount: number }[] }>('/conversations?limit=50'),
    refetchInterval: 15_000,
  });
  return {
    messages: conversations.data?.items.reduce((sum, item) => sum + item.unreadCount, 0) ?? 0,
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
}: Pick<AppNavigationProperties, 'onModeChange' | 'ownerCapable'>) {
  const badges = useBadges();
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
            key={route.params?.conversationId ?? 'conversation-list'}
            initialConversationId={route.params?.conversationId}
          />
        )}
      </RenterTabs.Screen>
      <RenterTabs.Screen name="Profile">
        {() => <AccountScreen onModeChange={onModeChange} ownerCapable={ownerCapable} />}
      </RenterTabs.Screen>
    </RenterTabs.Navigator>
  );
}

function OwnerNavigation({
  onModeChange,
  ownerStatus,
}: Pick<AppNavigationProperties, 'onModeChange' | 'ownerStatus'>) {
  const badges = useBadges();
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
        prefixes: ['carrental://'],
        config: {
          screens: {
            Marketplace: 'marketplace',
            Notifications: 'notifications',
            Support: 'support/:ticketId',
            Conversation: 'messages/:conversationId',
            Booking: 'bookings/:bookingId',
            Claim: 'claims/:claimId',
            OwnerEarnings: 'earnings',
            Payout: 'payouts/:payoutId',
            Favorites: 'favorites',
            Reviews: 'reviews',
          },
        },
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
          options={{ headerShown: false }}
        />
        <Stack.Screen
          component={NotificationCenter}
          name="Notifications"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="Favorites" options={{ headerShown: false }}>
          {({ navigation }) => (
            <DiscoveryScreen initialMode="favorites" onExit={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen component={ReviewsScreen} name="Reviews" options={{ headerShown: false }} />
        <Stack.Screen name="Conversation" options={{ headerShown: false }}>
          {({ navigation, route }) => (
            <MessagesScreen
              initialConversationId={route.params.conversationId}
              onClose={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Booking" options={{ headerShown: false }}>
          {({ navigation, route }) => (
            <MyBookingsScreen
              initialBookingReference={route.params.bookingId}
              onClose={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Claim" options={{ headerShown: false }}>
          {({ navigation, route }) => (
            <ClaimDetailScreen
              claimId={route.params.claimId}
              ownerMode={properties.mode === 'owner'}
              onBack={() => navigation.goBack()}
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
