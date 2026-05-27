import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors, Glass, GlassPreset, Radius, Shadows } from '../constants/theme';

type Props = {
  children: React.ReactNode;
  preset?: GlassPreset;
  /** Border radius — defaults to Radius.lg (20). Pass a number to override. */
  radius?: number;
  /** Drop shadow level. Defaults to 'sm'. */
  shadow?: 'none' | 'sm' | 'md' | 'lg' | 'hero';
  /** Extra style to merge on the outer wrapper (margins, width, etc). */
  style?: StyleProp<ViewStyle>;
  /** Style for the inner content wrapper (padding, layout). */
  contentStyle?: StyleProp<ViewStyle>;
  /** When true, the inner highlight border is omitted (used for tab bars / hero cards). */
  noBorder?: boolean;
};

/**
 * Glass-effect card that uses iOS BlurView when available and falls back
 * gracefully on Android (which doesn't have UIBlurEffect parity). The
 * fallback is a tinted translucent rectangle which still reads as a card.
 *
 * Usage:
 *   <GlassCard preset="regular" contentStyle={{ padding: 16 }}>
 *     <Text>Hello</Text>
 *   </GlassCard>
 */
export function GlassCard({
  children,
  preset = 'regular',
  radius = Radius.lg,
  shadow = 'sm',
  style,
  contentStyle,
  noBorder = false,
}: Props) {
  const cfg = Glass[preset];
  const shadowStyle = shadow === 'none' ? null : Shadows[shadow];

  return (
    <View
      style={[
        { borderRadius: radius, overflow: 'visible' },
        shadowStyle,
        style,
      ]}
    >
      <View
        style={{
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : cfg.fallback,
          borderWidth: noBorder ? 0 : StyleSheet.hairlineWidth,
          borderColor: cfg.border,
        }}
      >
        {Platform.OS === 'ios' ? (
          <BlurView
            tint={cfg.tint as any}
            intensity={cfg.intensity}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={[contentStyle]}>{children}</View>
      </View>
    </View>
  );
}

/**
 * A solid-white card (no glass effect). Used when the surface needs to be
 * fully opaque (e.g., the splash background, full-screen overlays). This is
 * still part of the same design system — just no blur.
 */
export function SolidCard({
  children,
  radius = Radius.lg,
  shadow = 'sm',
  style,
  contentStyle,
}: Omit<Props, 'preset' | 'noBorder'>) {
  const shadowStyle = shadow === 'none' ? null : Shadows[shadow];
  return (
    <View
      style={[
        {
          backgroundColor: Colors.surface,
          borderRadius: radius,
          overflow: 'hidden',
        },
        shadowStyle,
        style,
      ]}
    >
      <View style={contentStyle}>{children}</View>
    </View>
  );
}
