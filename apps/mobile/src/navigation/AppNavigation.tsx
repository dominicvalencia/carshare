import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getStateFromPath, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ComponentProps } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiClient } from '../auth/api-client';
import type { OwnerStatus, OwnerWorkspace } from '../auth/auth.types';
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
import { OwnerAddPayoutMethodScreen } from '../features/earnings/AddPayoutMethodScreen';
import { OwnerPayoutMethodsScreen } from '../features/earnings/PayoutPanels';
import { OwnerPayoutMethodDetailScreen } from '../features/earnings/PayoutMethodDetailScreen';
import { NotificationCenter } from '../features/notifications/NotificationCenter';
import { OwnerRentalsScreen } from '../features/rentals/OwnerRentalsScreen';
import { ReviewsScreen } from '../features/reviews/ReviewsScreen';
import {
  HostProfileScreen,
  PublicReviewsScreen,
} from '../features/reviews/MarketplaceReviewsScreens';
import { ClaimDetailScreen } from '../features/claims/ClaimsPanels';
import { SupportCenter } from '../features/support/SupportCenter';
import { OwnerStaffScreen } from '../features/staff/OwnerStaffScreen';
import { OwnerDashboardScreen } from '../features/vehicles/OwnerDashboardScreen';
import { OwnerVehicleChangeProposalScreen } from '../features/vehicles/OwnerVehicleChangeProposalScreen';
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
import { delegatedOwnerTabs, hasOwnerPermission } from './owner-workspace';

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

function AccessUnavailable() {
  return (
    <Screen scroll={false}>
      <StateView
        icon="lock-closed-outline"
        message="You no longer have access to this area."
        title="Access unavailable"
      />
    </Screen>
  );
}

interface AppNavigationProperties {
  readonly mode: MobileMode;
  readonly ownerCapable: boolean;
  readonly ownerStatus: OwnerStatus | null;
  readonly ownerWorkspace: OwnerWorkspace | null;
  readonly ownerWorkspaces: readonly OwnerWorkspace[];
  readonly onOwnerWorkspaceChange: (ownerProfileId: string) => void;
  readonly onModeChange: (mode: MobileMode) => void;
}

const renterIcons: Readonly<
  Record<keyof RenterTabParamList, { active: IconName; idle: IconName }>
> = {
  Home: { active: 'compass', idle: 'compass-outline' },
  Wishlist: { active: 'heart', idle: 'heart-outline' },
  Bookings: { active: 'briefcase', idle: 'briefcase-outline' },
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

function useBadges(mode: MobileMode, enabled = true, ownerWorkspace?: OwnerWorkspace | null) {
  const audience = mode.toUpperCase();
  const delegated = mode === 'owner' && ownerWorkspace?.capacity !== 'OWNER';
  const workspaceKey = delegated ? ownerWorkspace?.ownerProfileId : mode;
  const conversations = useQuery({
    enabled,
    queryKey: ['conversations', workspaceKey],
    queryFn: () =>
      apiClient.request<{ items: { unreadCount: number }[] }>(
        delegated
          ? `/owner/workspaces/${ownerWorkspace!.ownerProfileId}/conversations?limit=50`
          : `/conversations?limit=50&audience=${audience}`,
      ),
    refetchInterval: 15_000,
  });
  const notifications = useQuery({
    enabled: enabled && !delegated,
    queryKey: ['notification-summary', workspaceKey],
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
  const [renterTabsHidden, setRenterTabsHidden] = useState(false);
  const [exploreRootRequest, setExploreRootRequest] = useState(0);
  return (
    <RenterTabs.Navigator
      screenOptions={({ route }) => {
        const options = tabOptions(renterIcons[route.name], insets.bottom);
        const tabBarStyle =
          route.name === 'Home'
            ? { ...options.tabBarStyle, position: 'absolute' as const }
            : options.tabBarStyle;
        return {
          ...options,
          tabBarStyle: renterTabsHidden
            ? { ...tabBarStyle, display: 'none' as const }
            : tabBarStyle,
        };
      }}
    >
      <RenterTabs.Screen
        listeners={{
          tabPress: () => setExploreRootRequest((current) => current + 1),
        }}
        name="Home"
        options={{ tabBarAccessibilityLabel: 'Explore tab', tabBarLabel: 'Explore' }}
      >
        {() => (
          <DiscoveryScreen
            exploreRootRequest={exploreRootRequest}
            home
            onTabBarHiddenChange={setRenterTabsHidden}
          />
        )}
      </RenterTabs.Screen>
      <RenterTabs.Screen
        name="Wishlist"
        options={{ tabBarAccessibilityLabel: 'Wishlist tab', tabBarLabel: 'Wishlist' }}
      >
        {({ navigation }) => (
          <DiscoveryScreen
            initialMode="favorites"
            onExit={() => navigation.navigate('Home')}
            onTabBarHiddenChange={setRenterTabsHidden}
            wishlistTab
          />
        )}
      </RenterTabs.Screen>
      <RenterTabs.Screen
        name="Bookings"
        component={MyBookingsScreen}
        options={{ tabBarAccessibilityLabel: 'Trips tab', tabBarLabel: 'Trips' }}
      />
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
  ownerWorkspace,
  ownerWorkspaces,
  onOwnerWorkspaceChange,
}: Pick<
  AppNavigationProperties,
  'onModeChange' | 'ownerStatus' | 'ownerWorkspace' | 'ownerWorkspaces' | 'onOwnerWorkspaceChange'
>) {
  const tabs = ownerWorkspace
    ? delegatedOwnerTabs(ownerWorkspace)
    : { messages: false, more: true, today: false, vehicles: false };
  const badges = useBadges('owner', tabs.messages, ownerWorkspace);
  const insets = useSafeAreaInsets();
  if (!ownerWorkspace)
    return (
      <Screen scroll={false}>
        <StateView
          actionLabel="Return to renter mode"
          icon="lock-closed-outline"
          message="You no longer have access to this Owner workspace."
          onAction={() => onModeChange('renter')}
          title="Access unavailable"
        />
      </Screen>
    );
  const initialRouteName = tabs.today
    ? 'Dashboard'
    : tabs.vehicles
      ? 'Vehicles'
      : tabs.messages
        ? 'Messages'
        : 'More';
  return (
    <OwnerTabs.Navigator
      initialRouteName={initialRouteName}
      screenOptions={({ route }) => tabOptions(ownerIcons[route.name], insets.bottom)}
    >
      {tabs.today ? (
        <OwnerTabs.Screen
          name="Dashboard"
          options={{ tabBarAccessibilityLabel: 'Today tab', tabBarLabel: 'Today' }}
        >
          {() => (
            <OwnerDashboardScreen
              ownerStatus={ownerStatus}
              {...(ownerWorkspace.capacity === 'OWNER' ? {} : { ownerWorkspace })}
            />
          )}
        </OwnerTabs.Screen>
      ) : null}
      {tabs.vehicles ? (
        <OwnerTabs.Screen name="Vehicles">
          {({ route }) => (
            <VehiclesScreen
              {...(route.params?.vehicleId ? { initialVehicleId: route.params.vehicleId } : {})}
              ownerWorkspace={ownerWorkspace}
            />
          )}
        </OwnerTabs.Screen>
      ) : null}
      {tabs.messages ? (
        <OwnerTabs.Screen
          name="Messages"
          options={badges.messages ? { tabBarBadge: badges.messages } : {}}
        >
          {({ route }) => (
            <MessagesScreen
              mode="owner"
              ownerWorkspace={ownerWorkspace}
              key={route.params?.conversationId ?? 'conversation-list'}
              initialConversationId={route.params?.conversationId}
            />
          )}
        </OwnerTabs.Screen>
      ) : null}
      <OwnerTabs.Screen name="More">
        {() => (
          <OwnerMoreScreen
            onModeChange={onModeChange}
            onOwnerWorkspaceChange={onOwnerWorkspaceChange}
            ownerStatus={ownerStatus}
            ownerWorkspace={ownerWorkspace}
            ownerWorkspaces={ownerWorkspaces}
          />
        )}
      </OwnerTabs.Screen>
      {(ownerWorkspace.capacity === 'OWNER' || ownerWorkspace.capacity === 'MANAGER') &&
      hasOwnerPermission(ownerWorkspace, 'bookings.view') ? (
        <OwnerTabs.Screen
          name="Requests"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
          }}
        >
          {() =>
            ownerStatus === 'VERIFIED' ? (
              <OwnerBookingRequestsScreen
                {...(ownerWorkspace.capacity === 'OWNER' ? {} : { ownerWorkspace })}
              />
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
      ) : null}
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
            OwnerPayoutMethods: 'owner/payout-methods',
            OwnerAddPayoutMethod: 'owner/payout-methods/add',
            OwnerPayoutMethodDetail: 'owner/payout-methods/:payoutMethodId',
            Payout: 'payouts/:payoutId',
            Favorites: 'favorites',
            Reviews: 'reviews',
            Verification: 'verification',
            HostProfile: 'hosts/:hostReference',
            VehicleDetails: 'vehicles/:vehicleId',
            OwnerVehicleApproval: 'owner/vehicle-approvals/:vehicleId',
            OwnerVehicleChangeProposal: 'owner/vehicle-change-proposals/:vehicleId/:proposalId',
            OwnerWorkspaceVehicle: 'owner/vehicles/:vehicleId',
            PublicReviews: 'reviews/public',
          },
        },
        getStateFromPath: (path, options) =>
          withDeepLinkParent(getStateFromPath(path, options), properties.mode),
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
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
                onOwnerWorkspaceChange={properties.onOwnerWorkspaceChange}
                ownerStatus={properties.ownerStatus}
                ownerWorkspace={properties.ownerWorkspace}
                ownerWorkspaces={properties.ownerWorkspaces}
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
        <Stack.Screen name="OwnerProfile" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerProfileScreen />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="Notifications" options={{ headerShown: false }}>
          {() => <NotificationCenter mode={properties.mode} />}
        </Stack.Screen>
        <Stack.Screen name="OwnerVehicleApproval" options={{ headerShown: false }}>
          {({ route }) =>
            properties.mode === 'owner' && properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <VehiclesScreen initialVehicleId={route.params.vehicleId} />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerVehicleChangeProposal" options={{ headerShown: false }}>
          {({ route }) =>
            properties.mode === 'owner' && properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerVehicleChangeProposalScreen
                proposalId={route.params.proposalId}
                vehicleId={route.params.vehicleId}
              />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerWorkspaceVehicle" options={{ headerShown: false }}>
          {({ route }) => {
            const workspace = properties.ownerWorkspace;
            if (
              properties.mode !== 'owner' ||
              !workspace ||
              (workspace.capacity !== 'OWNER' && !hasOwnerPermission(workspace, 'vehicles.view'))
            )
              return <AccessUnavailable />;
            return workspace.capacity === 'OWNER' ? (
              <VehiclesScreen initialVehicleId={route.params.vehicleId} />
            ) : (
              <VehiclesScreen
                initialVehicleId={route.params.vehicleId}
                ownerWorkspace={workspace}
              />
            );
          }}
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
          {({ navigation, route }) =>
            properties.mode === 'owner' && properties.ownerWorkspace?.capacity !== 'OWNER' ? (
              hasOwnerPermission(properties.ownerWorkspace!, 'messages.view') ? (
                <MessagesScreen
                  initialConversationId={route.params.conversationId}
                  mode="owner"
                  onClose={() => closeToMarketplace(navigation)}
                  ownerWorkspace={properties.ownerWorkspace!}
                />
              ) : (
                <AccessUnavailable />
              )
            ) : (
              <ConversationDestination
                conversationId={route.params.conversationId}
                mode={properties.mode}
                onClose={() => closeToMarketplace(navigation)}
                onModeChange={properties.onModeChange}
              />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="Booking" options={{ headerShown: false }}>
          {({ navigation, route }) =>
            properties.mode === 'owner' && properties.ownerWorkspace?.capacity !== 'OWNER' ? (
              properties.ownerWorkspace!.capacity === 'MANAGER' &&
              hasOwnerPermission(properties.ownerWorkspace!, 'bookings.view') ? (
                <OwnerBookingDestination
                  reference={route.params.bookingId}
                  onClose={() => closeToMarketplace(navigation)}
                  ownerWorkspace={properties.ownerWorkspace!}
                />
              ) : hasOwnerPermission(properties.ownerWorkspace!, 'rentals.view') ? (
                <OwnerRentalsScreen
                  initialBookingReference={route.params.bookingId}
                  onClose={() => closeToMarketplace(navigation)}
                  ownerWorkspace={properties.ownerWorkspace!}
                />
              ) : (
                <AccessUnavailable />
              )
            ) : properties.mode === 'owner' ? (
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
          {({ navigation, route }) =>
            properties.mode === 'owner' && properties.ownerWorkspace?.capacity !== 'OWNER' ? (
              <AccessUnavailable />
            ) : (
              <MyBookingsScreen
                focusRecovery
                initialBookingReference={route.params.bookingId}
                onClose={() => closeToMarketplace(navigation)}
              />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="Claim" options={{ headerShown: false }}>
          {({ navigation, route }) =>
            properties.mode === 'owner' && properties.ownerWorkspace?.capacity !== 'OWNER' ? (
              hasOwnerPermission(properties.ownerWorkspace!, 'claims.view') ? (
                <ClaimDetailScreen
                  claimId={route.params.claimId}
                  onBack={() => closeToMarketplace(navigation)}
                  ownerMode
                  ownerWorkspace={properties.ownerWorkspace!}
                />
              ) : (
                <AccessUnavailable />
              )
            ) : (
              <ClaimDetailScreen
                claimId={route.params.claimId}
                ownerMode={properties.mode === 'owner'}
                onBack={() => closeToMarketplace(navigation)}
              />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="Support" options={{ headerShown: false }}>
          {({ route }) => <SupportCenter initialTicketId={route.params?.ticketId} />}
        </Stack.Screen>
        <Stack.Screen name="Settings" options={{ headerShown: false }}>
          {() =>
            properties.mode === 'owner' && properties.ownerWorkspace?.capacity !== 'OWNER' ? (
              <AccessUnavailable />
            ) : (
              <SettingsScreen />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerRentals" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace &&
            hasOwnerPermission(properties.ownerWorkspace, 'rentals.view') ? (
              <OwnerRentalsScreen
                {...(properties.ownerWorkspace.capacity === 'OWNER'
                  ? {}
                  : { ownerWorkspace: properties.ownerWorkspace })}
              />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerRequestHistory" options={{ title: 'Request history' }}>
          {() =>
            properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerBookingRequestsScreen history />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerBookingRequests" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace &&
            (properties.ownerWorkspace.capacity === 'OWNER' ||
              properties.ownerWorkspace.capacity === 'MANAGER') &&
            hasOwnerPermission(properties.ownerWorkspace, 'bookings.view') ? (
              <OwnerBookingRequestsScreen
                {...(properties.ownerWorkspace.capacity === 'OWNER'
                  ? {}
                  : { ownerWorkspace: properties.ownerWorkspace })}
              />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerEarnings" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerEarningsScreen />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerPayoutMethods" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerPayoutMethodsScreen />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerAddPayoutMethod" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerAddPayoutMethodScreen />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerPayoutMethodDetail" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerPayoutMethodDetailScreen />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="OwnerStaff" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace &&
            hasOwnerPermission(properties.ownerWorkspace, 'staff.view') ? (
              <OwnerStaffScreen
                capacity={properties.ownerWorkspace.capacity === 'OWNER' ? 'OWNER' : 'MANAGER'}
                ownerProfileId={properties.ownerWorkspace.ownerProfileId}
                workspaceLabel={properties.ownerWorkspace.workspaceLabel}
              />
            ) : (
              <AccessUnavailable />
            )
          }
        </Stack.Screen>
        <Stack.Screen name="Payout" options={{ headerShown: false }}>
          {() =>
            properties.ownerWorkspace?.capacity === 'OWNER' ? (
              <OwnerEarningsScreen />
            ) : (
              <AccessUnavailable />
            )
          }
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
  ownerWorkspace,
}: {
  readonly reference: string;
  readonly onClose: () => void;
  readonly ownerWorkspace?: OwnerWorkspace;
}) {
  const delegated = Boolean(ownerWorkspace && ownerWorkspace.capacity !== 'OWNER');
  const booking = useQuery({
    queryKey: ['owner-booking-destination', ownerWorkspace?.ownerProfileId ?? 'owner', reference],
    queryFn: () =>
      apiClient.request<{
        latestAmendment?: { amendmentId: string; status: string } | null;
        status: string;
      }>(
        delegated
          ? `/owner/workspaces/${ownerWorkspace!.ownerProfileId}/bookings/${reference}`
          : `/owner/bookings/${reference}`,
      ),
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
  const rentalSurface =
    ownerBookingSurface(booking.data.status) === 'rental' &&
    booking.data.latestAmendment?.status !== 'PENDING_OWNER';
  if (rentalSurface && delegated && !hasOwnerPermission(ownerWorkspace!, 'rentals.view'))
    return <AccessUnavailable />;
  return rentalSurface ? (
    <OwnerRentalsScreen
      initialBookingReference={reference}
      onClose={onClose}
      {...(delegated ? { ownerWorkspace } : {})}
    />
  ) : (
    <OwnerBookingRequestsScreen
      {...(booking.data.latestAmendment?.status === 'PENDING_OWNER'
        ? { initialAmendmentReference: booking.data.latestAmendment.amendmentId }
        : {})}
      initialBookingReference={reference}
      onClose={onClose}
      {...(delegated ? { ownerWorkspace } : {})}
    />
  );
}
