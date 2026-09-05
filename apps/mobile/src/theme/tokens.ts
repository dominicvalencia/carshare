export const colors = {
  background: '#F6F7F4',
  border: '#DDE4DF',
  danger: '#B42318',
  dangerSoft: '#FEECEB',
  ink: '#10231B',
  muted: '#EBF0ED',
  onPrimary: '#FFFFFF',
  primary: '#126B4E',
  primaryDark: '#0C4E39',
  primarySoft: '#E0F2EA',
  subtleText: '#5B6B64',
  placeholder: '#69766F',
  surface: '#FFFFFF',
  warning: '#936000',
  warningSoft: '#FFF4D6',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  body: 15,
  caption: 12,
  heading: 21,
  hero: 32,
  label: 13,
  title: 27,
} as const;

export const shadows = {
  card: {
    elevation: 2,
    shadowColor: '#10231B',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
  },
} as const;
