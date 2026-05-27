import { Ionicons } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Glass, Radius } from '../constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { idle: IconName; active: IconName; label: string }> = {
  '首页':    { idle: 'home-outline',      active: 'home',      label: '首页' },
  '票据':    { idle: 'documents-outline', active: 'documents', label: '票据' },
  '报销包':  { idle: 'cube-outline',      active: 'cube',      label: '报销包' },
  '我的':    { idle: 'person-outline',    active: 'person',    label: '我的' },
};

/**
 * Floating cream-glass bottom tab bar. The active tab gets a forest-green
 * accent (icon + label + soft ink-blob behind the icon).
 */
export function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const cfg = Glass.chrome;

  return (
    <View
      pointerEvents="box-none"
      style={[
        s.outer,
        { paddingBottom: Math.max(insets.bottom - 4, 8) },
      ]}
    >
      <View style={s.barShadow}>
        <View
          style={[
            s.bar,
            {
              borderColor: cfg.border,
              backgroundColor: Platform.OS === 'ios' ? 'transparent' : cfg.fallback,
            },
          ]}
        >
          {Platform.OS === 'ios' ? (
            <BlurView
              tint={cfg.tint as any}
              intensity={cfg.intensity}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={s.row}>
            {state.routes.map((route, idx) => {
              const isFocused = state.index === idx;
              const meta = TAB_ICONS[route.name] ?? {
                idle: 'ellipse-outline' as IconName,
                active: 'ellipse' as IconName,
                label: route.name,
              };

              return (
                <Pressable
                  key={route.key}
                  onPress={() => {
                    const event = navigation.emit({
                      type: 'tabPress',
                      target: route.key,
                      canPreventDefault: true,
                    });
                    if (!isFocused && !event.defaultPrevented) {
                      navigation.navigate(route.name as never);
                    }
                  }}
                  style={({ pressed }) => [
                    s.tab,
                    pressed && { opacity: 0.55 },
                  ]}
                  hitSlop={6}
                >
                  <View
                    style={[
                      s.iconWrap,
                      isFocused && s.iconWrapActive,
                    ]}
                  >
                    <Ionicons
                      name={isFocused ? meta.active : meta.idle}
                      size={22}
                      color={isFocused ? Colors.accent : Colors.textTertiary}
                    />
                  </View>
                  <Text style={[s.label, isFocused && s.labelActive]}>
                    {meta.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    alignItems: 'stretch',
  },
  barShadow: {
    borderRadius: Radius.xxl,
    shadowColor: '#3A2E1A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 14,
  },
  bar: {
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  iconWrap: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  iconWrapActive: {
    backgroundColor: Colors.accentLight,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textTertiary,
    letterSpacing: 0.1,
  },
  labelActive: {
    color: Colors.accent,
    fontWeight: '700',
  },
});
