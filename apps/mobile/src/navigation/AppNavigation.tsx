import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import type { MobileMode, OwnerTabParamList, RenterTabParamList } from './routes';
import { PlaceholderScreen } from '../features/shared/foundation/PlaceholderScreen';
import { colors } from '../theme/tokens';
import { AccountScreen } from '../features/account/AccountScreen';
import { VehiclesScreen } from '../features/vehicles/VehiclesScreen';
import { OwnerDashboardScreen } from '../features/vehicles/OwnerDashboardScreen';
import { DiscoveryScreen } from '../features/discovery/DiscoveryScreen';
import { MyBookingsScreen } from '../features/bookings/MyBookingsScreen';
import { OwnerBookingRequestsScreen } from '../features/bookings/OwnerBookingRequestsScreen';
import { OwnerEarningsScreen } from '../features/earnings/OwnerEarningsScreen';
import { OwnerRentalsScreen } from '../features/rentals/OwnerRentalsScreen';

const RenterTabs = createBottomTabNavigator<RenterTabParamList>();
const OwnerTabs = createBottomTabNavigator<OwnerTabParamList>();

interface AppNavigationProperties {
  readonly mode: MobileMode;
}

function RenterNavigation() {
  return (
    <RenterTabs.Navigator
      screenOptions={{
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
      }}
    >
      <RenterTabs.Screen name="Home">{() => <DiscoveryScreen home />}</RenterTabs.Screen>
      <RenterTabs.Screen name="Search">{() => <DiscoveryScreen />}</RenterTabs.Screen>
      <RenterTabs.Screen name="Bookings">{() => <MyBookingsScreen />}</RenterTabs.Screen>
      <RenterTabs.Screen name="Messages">
        {() => <PlaceholderScreen title="Messages" />}
      </RenterTabs.Screen>
      <RenterTabs.Screen name="Profile">{() => <AccountScreen />}</RenterTabs.Screen>
    </RenterTabs.Navigator>
  );
}

function OwnerNavigation() {
  return (
    <OwnerTabs.Navigator
      screenOptions={{
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
      }}
    >
      <OwnerTabs.Screen name="Dashboard">{() => <OwnerDashboardScreen />}</OwnerTabs.Screen>
      <OwnerTabs.Screen name="Vehicles">{() => <VehiclesScreen />}</OwnerTabs.Screen>
      <OwnerTabs.Screen name="Requests">{() => <OwnerBookingRequestsScreen />}</OwnerTabs.Screen>
      <OwnerTabs.Screen name="Rentals">{() => <OwnerRentalsScreen />}</OwnerTabs.Screen>
      <OwnerTabs.Screen name="Messages">
        {() => <PlaceholderScreen title="Messages" />}
      </OwnerTabs.Screen>
      <OwnerTabs.Screen name="More">{() => <OwnerEarningsScreen />}</OwnerTabs.Screen>
    </OwnerTabs.Navigator>
  );
}

export function AppNavigation({ mode }: AppNavigationProperties) {
  return (
    <NavigationContainer>
      {mode === 'renter' ? <RenterNavigation /> : <OwnerNavigation />}
    </NavigationContainer>
  );
}
