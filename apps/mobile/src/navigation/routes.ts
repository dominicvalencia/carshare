export type MobileMode = 'renter' | 'owner';

export const renterTabs = ['Home', 'Wishlist', 'Bookings', 'Messages', 'Profile'] as const;
// Requests remains a route key for legacy navigation compatibility, but is no longer a visible tab.
export const ownerTabs = ['Dashboard', 'Vehicles', 'Requests', 'Messages', 'More'] as const;
export const visibleOwnerTabs = ['Dashboard', 'Vehicles', 'Messages', 'More'] as const;

export type RenterTab = (typeof renterTabs)[number];
export type OwnerTab = (typeof ownerTabs)[number];

export type RenterTabParamList = {
  Home: undefined;
  Wishlist: undefined;
  Bookings: { bookingId?: string | undefined } | undefined;
  Messages: { conversationId?: string | undefined } | undefined;
  Profile: { ticketId?: string | undefined } | undefined;
};
export type OwnerTabParamList = {
  Dashboard: { initialTab?: 'Today' | 'Upcoming' | 'Requests' } | undefined;
  Vehicles: undefined;
  Requests: undefined;
  Messages: { conversationId?: string | undefined } | undefined;
  More: { payoutId?: string | undefined } | undefined;
};

export type RootStackParamList = {
  Marketplace: undefined;
  PersonalInformation: undefined;
  Verification: undefined;
  LoginSecurity: undefined;
  ActiveDevices: undefined;
  OwnerOnboarding: undefined;
  OwnerProfile: undefined;
  Notifications: undefined;
  Favorites: undefined;
  Reviews: undefined;
  Conversation: { conversationId: string };
  Support: { ticketId?: string | undefined } | undefined;
  Settings: undefined;
  OwnerRentals: undefined;
  OwnerRequestHistory: undefined;
  OwnerEarnings: undefined;
  Booking: { bookingId: string };
  BookingRecovery: { bookingId: string };
  Claim: { claimId: string };
  Payout: { payoutId: string };
  HostProfile: { hostReference: string };
  VehicleDetails: { vehicleId: string };
  PublicReviews: { path: string; title: string };
};
