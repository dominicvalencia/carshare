import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { apiClient } from '../auth/api-client';
import type { OwnerStatus } from '../auth/auth.types';
import {
  AccountScreen,
  ActiveDevicesScreen,
  OwnerMoreScreen,
  OwnerOnboardingScreen,
  PersonalInformationScreen,
  SettingsScreen,
} from '../features/account/AccountScreen';
import { MyBookingsScreen } from '../features/bookings/MyBookingsScreen';
import { OwnerBookingRequestsScreen } from '../features/bookings/OwnerBookingRequestsScreen';
import { MessagesScreen } from '../features/communications/MessagesScreen';
import { DiscoveryScreen } from '../features/discovery/DiscoveryScreen';
import { OwnerEarningsScreen } from '../features/earnings/OwnerEarningsScreen';
import { NotificationCenter } from '../features/notifications/NotificationCenter';
import { OwnerRentalsScreen } from '../features/rentals/OwnerRentalsScreen';
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
  const notifications = useQuery({
    queryKey: ['notification-summary'],
    queryFn: () => apiClient.request<{ unreadCount: number }>('/notifications/summary'),
    refetchInterval: 30_000,
  });
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () =>
      apiClient.request<{ items: { unreadCount: number }[] }>('/conversations?limit=50'),
    refetchInterval: 15_000,
  });
  return {
    messages: conversations.data?.items.reduce((sum, item) => sum + item.unreadCount, 0) ?? 0,
    notifications: notifications.data?.unreadCount ?? 0,
  };
}

function tabOptions(icons: { active: IconName; idle: IconName }) {
  return {
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.subtleText,
    tabBarHideOnKeyboard: true,
    tabBarIcon: ({ color, focused, size }: { color: string; focused: boolean; size: number }) => (
      <Ionicons color={color} name={focused ? icons.active : icons.idle} size={size} />
    ),
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' as const },
    tabBarStyle: { borderTopColor: colors.border, height: 66, paddingBottom: 7, paddingTop: 5 },
  };
}

function RenterNavigation({
  onModeChange,
  ownerCapable,
}: Pick<AppNavigationProperties, 'onModeChange' | 'ownerCapable'>) {
  const badges = useBadges();
  return (
    <RenterTabs.Navigator screenOptions={({ route }) => tabOptions(renterIcons[route.name])}>
      <RenterTabs.Screen name="Home">{() => <DiscoveryScreen home />}</RenterTabs.Screen>
      <RenterTabs.Screen name="Search">{() => <DiscoveryScreen />}</RenterTabs.Screen>
      <RenterTabs.Screen name="Bookings" component={MyBookingsScreen} />
      <RenterTabs.Screen
        name="Messages"
        options={badges.messages ? { tabBarBadge: badges.messages } : {}}
      >
        {({ route }) => <MessagesScreen initialConversationId={route.params?.conversationId} />}
      </RenterTabs.Screen>
      <RenterTabs.Screen
        name="Profile"
        options={badges.notifications ? { tabBarBadge: badges.notifications } : {}}
      >
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
  return (
    <OwnerTabs.Navigator screenOptions={({ route }) => tabOptions(ownerIcons[route.name])}>
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
        {({ route }) => <MessagesScreen initialConversationId={route.params?.conversationId} />}
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
        <Stack.Screen component={SupportCenter} name="Support" options={{ headerShown: false }} />
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
