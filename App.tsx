import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { Component, useEffect, useState } from 'react';
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
import { AmbientBackground } from './src/components/AmbientBackground';
import { GlassCard } from './src/components/GlassCard';
import { Colors, Radius, Spacing, Typography } from './src/constants/theme';
import AppNavigator from './src/navigation';
import { supabase } from './src/services/supabase';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message + '\n' + e.stack }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, padding: 24, paddingTop: 60, backgroundColor: '#fff' }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'red', marginBottom: 12 }}>
            崩溃错误（请截图发给开发者）
          </Text>
          <Text selectable style={{ fontSize: 11, color: '#333', fontFamily: 'monospace' }}>
            {this.state.error}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

type AppState = 'loading' | 'ready' | 'needs_anon_setup';

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');

  useEffect(() => {
    initSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setAppState('ready');
    });
    return () => subscription.unsubscribe();
  }, []);

  async function initSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { setAppState('ready'); return; }
      await attemptAnonSignIn();
    } catch (e) {
      console.warn('initSession error:', e);
      await attemptAnonSignIn();
    }
  }

  async function attemptAnonSignIn() {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.session) setAppState('needs_anon_setup');
      else setAppState('ready');
    } catch (e) {
      console.warn('anonSignIn error:', e);
      setAppState('needs_anon_setup');
    }
  }

  if (appState === 'loading') {
    return (
      <SafeAreaProvider>
        <AmbientBackground>
          <View style={s.splash}>
            <View style={s.splashLogo}>
              <Ionicons name="receipt-outline" size={48} color="#FFFFFF" />
            </View>
            <Text style={s.splashName}>ReceiptSnap</Text>
            <ActivityIndicator size="small" color={Colors.textPrimary} style={{ marginTop: 18 }} />
            <Text style={s.splashText}>正在启动...</Text>
          </View>
        </AmbientBackground>
      </SafeAreaProvider>
    );
  }

  if (appState === 'needs_anon_setup') {
    return (
      <SafeAreaProvider>
        <AmbientBackground>
          <SafeAreaView style={s.setupScreen}>
            <ScrollView contentContainerStyle={s.setupContent}>
              <View style={s.setupIcon}>
                <Ionicons name="construct-outline" size={36} color="#7C5400" />
              </View>
              <Text style={s.setupTitle}>最后一步设置</Text>
              <Text style={s.setupSub}>
                需要在 Supabase 里开启一个开关，{'\n'}之后 App 就能直接使用，无需任何登录
              </Text>

              <GlassCard preset="regular" shadow="md" style={{ marginBottom: Spacing.md }} contentStyle={s.stepsCardContent}>
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
              </GlassCard>

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
        </AmbientBackground>
      </SafeAreaProvider>
    );
  }

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
  },
  splashLogo: {
    width: 96, height: 96, borderRadius: 26,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.20, shadowRadius: 28,
  },
  splashName: {
    marginTop: 18,
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.6,
  },
  splashText: {
    marginTop: 10,
    fontSize: 13,
    color: Colors.textSecondary,
  },

  setupScreen: { flex: 1 },
  setupContent: { padding: Spacing.lg, paddingBottom: 48 },
  setupIcon: {
    width: 84, height: 84, borderRadius: 24,
    backgroundColor: 'rgba(255, 159, 10, 0.18)',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
    marginTop: Spacing.xl, marginBottom: Spacing.md,
  },
  setupTitle: {
    fontSize: 26, fontWeight: '800', color: Colors.textPrimary,
    textAlign: 'center', marginBottom: 8,
  },
  setupSub: {
    fontSize: 15, color: Colors.textSecondary, textAlign: 'center',
    lineHeight: 22, marginBottom: Spacing.lg,
  },
  stepsCardContent: { padding: Spacing.lg },
  stepRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: 14, gap: 12,
  },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepNum: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  stepText: { flex: 1, fontSize: 14, color: Colors.textPrimary, lineHeight: 22 },

  dashboardBtn: {
    backgroundColor: Colors.textPrimary,
    borderRadius: Radius.md,
    paddingVertical: 16, alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  dashboardBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  retryBtn: {
    borderWidth: 1.5, borderColor: Colors.textPrimary,
    borderRadius: Radius.md, paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  retryBtnText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
