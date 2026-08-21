export type MobileMode = 'renter' | 'owner';

export const renterTabs = ['Home', 'Search', 'Bookings', 'Messages', 'Profile'] as const;
export const ownerTabs = [
  'Dashboard',
  'Vehicles',
  'Requests',
  'Rentals',
  'Messages',
  'More',
] as const;

export type RenterTab = (typeof renterTabs)[number];
export type OwnerTab = (typeof ownerTabs)[number];

export type RenterTabParamList = Record<RenterTab, undefined>;
export type OwnerTabParamList = Record<OwnerTab, undefined>;
