import { StatusBar } from 'expo-status-bar';
import React, { Component, useEffect, useState } from 'react';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message + '\n' + e.stack }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, padding: 24, paddingTop: 60, backgroundColor: '#fff' }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'red', marginBottom: 12 }}>崩溃错误（请截图发给开发者）</Text>
          <Text selectable style={{ fontSize: 11, color: '#333', fontFamily: 'monospace' }}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Shadows, Spacing } from './src/constants/theme';
import AppNavigator from './src/navigation';
import { supabase } from './src/services/supabase';

type AppState = 'loading' | 'ready' | 'needs_anon_setup';

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');

  useEffect(() => {
    initSession();

    // Keep session fresh across tab switches / token refreshes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setAppState('ready');
    });

    return () => subscription.unsubscribe();
  }, []);

  async function initSession() {
    try {
      // 1. Restore any persisted session from AsyncStorage
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { setAppState('ready'); return; }

      // 2. No session — sign in anonymously (no email / password needed)
      await attemptAnonSignIn();
    } catch (e) {
      console.warn('initSession error:', e);
      await attemptAnonSignIn();
    }
  }

  async function attemptAnonSignIn() {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.session) {
        // Anonymous sign-ins not yet enabled in this Supabase project
        setAppState('needs_anon_setup');
      } else {
        setAppState('ready');
      }
    } catch (e) {
      console.warn('anonSignIn error:', e);
      setAppState('needs_anon_setup');
    }
  }

  if (appState === 'loading') {
    return (
      <SafeAreaProvider>
        <View style={s.splash}>
          <View style={s.splashLogo}>
            <Text style={{ fontSize: 40 }}>🧾</Text>
          </View>
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 24 }} />
          <Text style={s.splashText}>正在启动...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (appState === 'needs_anon_setup') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.setupScreen}>
          <ScrollView contentContainerStyle={s.setupContent}>
            <View style={s.setupIcon}>
              <Text style={{ fontSize: 44 }}>⚙️</Text>
            </View>
            <Text style={s.setupTitle}>最后一步设置</Text>
            <Text style={s.setupSub}>
              需要在 Supabase 里开启一个开关，{'\n'}之后 App 就能直接使用，无需任何登录
            </Text>

            <View style={s.stepsCard}>
              {[
                '打开 supabase.com，进入你的项目',
                '左侧菜单点击 "Authentication"',
                '点击顶部 "Configuration" → "Sign In / Up"',
                '找到 "Anonymous sign-ins"，打开开关',
                '点击 "Save" 保存',
                '回到 App，点下方"已完成"按钮',
              ].map((step, i) => (
                <View key={i} style={s.stepRow}>
                  <View style={s.stepBadge}>
                    <Text style={s.stepNum}>{i + 1}</Text>
                  </View>
                  <Text style={s.stepText}>{step}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={s.dashboardBtn}
              onPress={() => Linking.openURL('https://supabase.com/dashboard')}
            >
              <Text style={s.dashboardBtnText}>打开 Supabase Dashboard →</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.retryBtn} onPress={attemptAnonSignIn}>
              <Text style={s.retryBtnText}>已完成，进入 App</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // appState === 'ready'
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <AppNavigator />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({
  splash: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.background,
  },
  splashLogo: {
    width: 88, height: 88, borderRadius: 24,
    backgroundColor: Colors.primary, alignItems: 'center',
    justifyContent: 'center', ...Shadows.lg,
  },
  splashText: {
    marginTop: 12, fontSize: 14, color: Colors.textSecondary,
  },

  setupScreen: { flex: 1, backgroundColor: Colors.background },
  setupContent: { padding: Spacing.lg, paddingBottom: 48 },
  setupIcon: {
    width: 88, height: 88, borderRadius: 24,
    backgroundColor: '#FEF3CD', alignItems: 'center',
    justifyContent: 'center', alignSelf: 'center',
    marginTop: Spacing.xl, marginBottom: Spacing.md, ...Shadows.md,
  },
  setupTitle: {
    fontSize: 26, fontWeight: '800', color: Colors.textPrimary,
    textAlign: 'center', marginBottom: 8,
  },
  setupSub: {
    fontSize: 15, color: Colors.textSecondary, textAlign: 'center',
    lineHeight: 22, marginBottom: Spacing.lg,
  },
  stepsCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, ...Shadows.md, marginBottom: Spacing.md,
  },
  stepRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: 14, gap: 12,
  },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary, alignItems: 'center',
    justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  stepNum: { color: '#fff', fontSize: 12, fontWeight: '800' },
  stepText: { flex: 1, fontSize: 14, color: Colors.textPrimary, lineHeight: 22 },

  dashboardBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 16, alignItems: 'center',
    marginBottom: Spacing.sm, ...Shadows.md,
  },
  dashboardBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  retryBtn: {
    borderWidth: 1.5, borderColor: Colors.primary,
    borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center',
  },
  retryBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
});
