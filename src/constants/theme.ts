import { Platform, StyleSheet } from 'react-native';

// ── Color palette ──────────────────────────────────────────────────────────
//
// "Travel journal" identity — warm cream paper + deep forest green ink.
// Inspired by old passport stamps, leather travel folios, and curated
// magazine layouts. Replaces the earlier iOS-26 cool-blue Liquid Glass.

export const Colors = {
  // Core neutrals
  black:          '#1A1A18',          // warm near-black
  white:          '#FFFFFF',
  pureWhite:      '#FFFFFF',

  // Layered backgrounds — the "paper" feel comes from these
  background:     '#F4EFE3',          // base cream paper
  backgroundTint: '#E8E1CF',          // accent tint area
  backgroundWarm: '#F0E5D0',          // warm tint blob (soft sand)
  backgroundCool: '#E3E5DA',          // cool tint blob (sage hint)

  // Card surface colors
  surface:        '#FBF8F0',          // off-white card
  surfaceSecondary:'#EFEADC',         // grouped list bg
  surfaceTertiary: '#F5F1E5',         // sub-card / input bg

  // Borders / hairlines
  border:         'rgba(45, 60, 50, 0.14)',
  borderStrong:   'rgba(45, 60, 50, 0.28)',
  hairline:       'rgba(45, 60, 50, 0.10)',

  // Text — warm-tinted, not pure black
  textPrimary:    '#1A1A18',
  textSecondary:  '#5A5A52',
  textTertiary:   '#8B8B7E',
  textQuaternary: 'rgba(26, 26, 24, 0.30)',
  textInverse:    '#FBF8F0',

  // Accent (forest green family)
  accent:         '#2D4A3D',          // primary action / CTA
  accentDark:     '#1F3A2D',          // hover/active deeper
  accentLight:    'rgba(45, 74, 61, 0.12)',
  accentMid:      '#4A7058',          // secondary green

  // Backwards-compat aliases
  primary:        '#2D4A3D',
  primaryDark:    '#1F3A2D',
  primaryLight:   'rgba(45, 74, 61, 0.12)',
  primaryMid:     '#4A7058',

  // Semantic
  success:        '#3F7B5A',
  successLight:   'rgba(63, 123, 90, 0.16)',
  warning:        '#C68B2E',
  warningLight:   'rgba(198, 139, 46, 0.16)',
  danger:         '#B5483D',
  dangerLight:    'rgba(181, 72, 61, 0.14)',

  // Category colors — earthy, not synthetic
  meals:          '#C26144',          // terracotta
  transport:      '#3F6E8A',          // muted indigo
  accommodation:  '#7A5C9D',          // dusty plum
  entertainment:  '#3F7B5A',          // forest green (matches accent family)
  office:         '#5E6B5E',          // olive-grey
  other:          '#8B8B7E',          // taupe
} as const;

// ── Glass material presets ────────────────────────────────────────────────
//
// Cream-tinted glass over the warm paper background. iOS BlurView still does
// the real work; these presets just pick the right material + fallback color.

export const Glass = {
  regular: {
    tint: 'systemMaterial' as const,
    intensity: 55,
    fallback: 'rgba(251, 248, 240, 0.85)',
    border: 'rgba(45, 60, 50, 0.10)',
  },
  thin: {
    tint: 'systemThinMaterial' as const,
    intensity: 45,
    fallback: 'rgba(251, 248, 240, 0.65)',
    border: 'rgba(45, 60, 50, 0.08)',
  },
  thick: {
    tint: 'systemThickMaterial' as const,
    intensity: 70,
    fallback: 'rgba(251, 248, 240, 0.92)',
    border: 'rgba(45, 60, 50, 0.12)',
  },
  chrome: {
    tint: 'systemChromeMaterial' as const,
    intensity: 75,
    fallback: 'rgba(244, 239, 227, 0.94)',
    border: 'rgba(45, 60, 50, 0.14)',
  },
  ultraThin: {
    tint: 'systemUltraThinMaterial' as const,
    intensity: 28,
    fallback: 'rgba(251, 248, 240, 0.45)',
    border: 'rgba(45, 60, 50, 0.06)',
  },
  // Dark forest-green hero card (replaces iOS-blue dark glass)
  dark: {
    tint: 'systemMaterialDark' as const,
    intensity: 70,
    fallback: 'rgba(45, 74, 61, 0.96)',
    border: 'rgba(255, 255, 255, 0.10)',
  },
} as const;

export type GlassPreset = keyof typeof Glass;

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
  xs:   6,
  sm:   10,
  md:   14,
  lg:   18,
  xl:   24,
  xxl:  32,
  full: 999,
} as const;

// ── Shadows ────────────────────────────────────────────────────────────────
export const Shadows = {
  sm: Platform.select({
    ios: {
      shadowColor: '#3A2E1A',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
    },
    android: { elevation: 2 },
    default: {},
  })!,
  md: Platform.select({
    ios: {
      shadowColor: '#3A2E1A',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.10,
      shadowRadius: 14,
    },
    android: { elevation: 5 },
    default: {},
  })!,
  lg: Platform.select({
    ios: {
      shadowColor: '#3A2E1A',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.12,
      shadowRadius: 26,
    },
    android: { elevation: 10 },
    default: {},
  })!,
  hero: Platform.select({
    ios: {
      shadowColor: '#3A2E1A',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.15,
      shadowRadius: 32,
    },
    android: { elevation: 14 },
    default: {},
  })!,
} as const;

// ── Typography ─────────────────────────────────────────────────────────────
export const Typography = StyleSheet.create({
  display: {
    fontSize: 44,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -1.4,
    lineHeight: 50,
  },
  h1: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.7,
    lineHeight: 36,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  h3: {
    fontSize: 19,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
    lineHeight: 26,
  },
  bodyLarge: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.textPrimary,
    lineHeight: 24,
  },
  bodyMedium: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.7,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
    color: Colors.textSecondary,
  },
});
