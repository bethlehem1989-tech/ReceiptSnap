import { StyleSheet } from 'react-native';

// ── Color palette ──────────────────────────────────────────────────────────
export const Colors = {
  // Core
  black:          '#000000',
  white:          '#FFFFFF',
  // Backgrounds
  background:     '#F5F7FA',   // page bg — very light gray
  surface:        '#FFFFFF',   // card bg
  surfaceSecondary:'#F5F7FA',  // secondary surface
  // Borders
  border:         '#E4E8ED',
  borderStrong:   '#C8CDD4',
  // Text
  textPrimary:    '#000000',
  textSecondary:  '#4A5568',
  textTertiary:   '#6C7A89',
  textInverse:    '#FFFFFF',
  // Accent (PayPal blue family)
  primary:        '#0070BA',   // main accent / links
  primaryDark:    '#003087',   // deep blue
  primaryLight:   '#EBF5FB',   // light blue tint
  primaryMid:     '#009CDE',   // mid blue
  // Semantic
  success:        '#27AE60',
  warning:        '#F39C12',
  danger:         '#E74C3C',
  // Category colors — muted palette that works on white
  meals:          '#E74C3C',
  transport:      '#2980B9',
  accommodation:  '#8E44AD',
  entertainment:  '#16A085',
  office:         '#2C3E50',
  other:          '#7F8C8D',
} as const;

// ── Spacing ────────────────────────────────────────────────────────────────
export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

// ── Border radius ──────────────────────────────────────────────────────────
export const Radius = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  28,
  full: 999,
} as const;

// ── Shadows ────────────────────────────────────────────────────────────────
export const Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

// ── Typography ─────────────────────────────────────────────────────────────
export const Typography = StyleSheet.create({
  h1: {
    fontSize: 32,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  h2: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  h3: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  bodyMedium: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    fontWeight: '400',
    color: '#000000',
    lineHeight: 22,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6C7A89',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6C7A89',
    lineHeight: 18,
  },
});
