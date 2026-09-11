export type MobileMode = 'renter' | 'owner';

export const renterTabs = ['Home', 'Search', 'Bookings', 'Messages', 'Profile'] as const;
export const ownerTabs = ['Dashboard', 'Vehicles', 'Requests', 'Messages', 'More'] as const;

export type RenterTab = (typeof renterTabs)[number];
export type OwnerTab = (typeof ownerTabs)[number];

export type RenterTabParamList = {
  Home: undefined;
  Search: undefined;
  Bookings: { bookingId?: string | undefined } | undefined;
  Messages: { conversationId?: string | undefined } | undefined;
  Profile: { ticketId?: string | undefined } | undefined;
};
export type OwnerTabParamList = {
  Dashboard: undefined;
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
  OwnerEarnings: undefined;
  Booking: { bookingId: string };
  Claim: { claimId: string };
  Payout: { payoutId: string };
  HostProfile: { hostReference: string };
  VehicleDetails: { vehicleId: string };
  PublicReviews: { path: string; title: string };
};
