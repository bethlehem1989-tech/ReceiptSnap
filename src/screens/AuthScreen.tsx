import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Shadows, Spacing } from '../constants/theme';
import { supabase } from '../services/supabase';

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // true when Supabase requires email confirmation before login is possible
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) { setError('请输入邮箱和密码'); return; }
    if (password.length < 6) { setError('密码至少需要 6 位'); return; }

    setError('');
    setNeedsEmailConfirm(false);
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        // onAuthStateChange in App.tsx automatically navigates to main screen

      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;

        if (data.session) {
          // Supabase has "Confirm email" disabled — user is immediately logged in.
          // onAuthStateChange in App.tsx handles the navigation automatically.
        } else {
          // Supabase requires email confirmation before login.
          setNeedsEmailConfirm(true);
        }
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? '操作失败，请重试';
      setError(translateError(msg));
    } finally {
      setLoading(false);
    }
  }

  // ── Email confirmation instructions screen ──────────────────────────────
  if (needsEmailConfirm) {
    return (
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.logoWrap}>
            <Text style={s.appName}>ReceiptSnap</Text>
            <Text style={s.appTagline}>需要关闭邮箱验证</Text>
            <Text style={s.appSubtitle}>按以下步骤操作后即可直接登录</Text>
          </View>

          <View style={s.stepsCard}>
            <Text style={s.stepsTitle}>操作步骤（1 分钟）</Text>
            {[
              '打开 supabase.com，进入你的项目',
              '左侧菜单点击 "Authentication"',
              '点击 "Providers"，找到 "Email"',
              '关闭 "Confirm email" 开关',
              '点击 "Save" 保存',
              '回到 App，用刚才的邮箱和密码登录',
            ].map((step, i) => (
              <View key={i} style={s.stepRow}>
                <View style={s.stepBadge}>
                  <Text style={s.stepNumber}>{i + 1}</Text>
                </View>
                <Text style={s.stepText}>{step}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={s.openDashboardBtn}
            onPress={() => Linking.openURL('https://supabase.com/dashboard')}
          >
            <Text style={s.openDashboardText}>打开 Supabase Dashboard →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.backBtn}
            onPress={() => { setNeedsEmailConfirm(false); setMode('login'); }}
          >
            <Text style={s.backBtnText}>已完成，返回登录</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Main auth form ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Wordmark */}
          <View style={s.logoWrap}>
            <Text style={s.appName}>ReceiptSnap</Text>
            <Text style={s.appTagline}>智能收据管理，专为商务出行设计</Text>
          </View>

          {/* Mode switcher */}
          <View style={s.modeSwitcher}>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'login' && s.modeBtnActive]}
              onPress={() => { setMode('login'); setError(''); }}
            >
              <Text style={[s.modeBtnText, mode === 'login' && s.modeBtnTextActive]}>登录</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'register' && s.modeBtnActive]}
              onPress={() => { setMode('register'); setError(''); }}
            >
              <Text style={[s.modeBtnText, mode === 'register' && s.modeBtnTextActive]}>注册</Text>
            </TouchableOpacity>
          </View>

          {/* Form card */}
          <View style={s.card}>
            <View style={s.field}>
              <Text style={s.fieldLabel}>邮箱地址</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={(v) => { setEmail(v); setError(''); }}
                placeholder="your@email.com"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={[s.field, { marginTop: Spacing.sm }]}>
              <Text style={s.fieldLabel}>密码</Text>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={(v) => { setPassword(v); setError(''); }}
                placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                placeholderTextColor={Colors.textTertiary}
                secureTextEntry
              />
            </View>

            {!!error && (
              <View style={s.errorBanner}>
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.submitBtn, loading && s.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={s.submitBtnText}>{mode === 'login' ? '登录' : '创建账号'}</Text>
              }
            </TouchableOpacity>
          </View>

          <View style={s.switchHint}>
            <Text style={s.switchHintText}>
              {mode === 'login' ? '还没有账号？' : '已有账号？'}
            </Text>
            <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
              <Text style={s.switchHintLink}>
                {mode === 'login' ? '立即注册' : '返回登录'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={s.disclaimer}>登录即代表您同意我们的服务条款与隐私政策</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function translateError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return '邮箱或密码不正确';
  if (msg.includes('Email not confirmed')) return '邮箱未验证 — 请先去 Supabase 关闭"Confirm email"选项';
  if (msg.includes('User already registered')) return '该邮箱已注册，请切换到登录';
  if (msg.includes('Password should be at least')) return '密码至少需要 6 位';
  if (msg.includes('Unable to validate email')) return '邮箱格式不正确';
  if (msg.includes('network') || msg.includes('Network')) return '网络错误，请检查网络连接';
  return msg;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.white },
  content: { padding: Spacing.lg, paddingBottom: 48, flexGrow: 1 },

  // Wordmark section
  logoWrap: { alignItems: 'center', marginTop: Spacing.xl, marginBottom: Spacing.xl },
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.black,
    letterSpacing: -1,
    marginBottom: 8,
  },
  appTagline: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  appSubtitle: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 6,
  },

  // Mode switcher
  modeSwitcher: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: 3,
    marginBottom: Spacing.md,
  },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center' },
  modeBtnActive: { backgroundColor: Colors.white, ...Shadows.sm },
  modeBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  modeBtnTextActive: { color: Colors.black },

  // Form card
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadows.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  field: {},
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.black,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: Colors.black,
  },

  // Error
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: Radius.sm,
    padding: 12,
    marginTop: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.danger,
  },
  errorText: { color: Colors.danger, fontSize: 14, fontWeight: '500' },

  // Submit button — black
  submitBtn: {
    backgroundColor: Colors.black,
    borderRadius: Radius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  submitBtnDisabled: { opacity: 0.55 },
  submitBtnText: { color: Colors.white, fontSize: 16, fontWeight: '700' },

  // Toggle link
  switchHint: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginBottom: Spacing.md },
  switchHintText: { fontSize: 14, color: Colors.textSecondary },
  switchHintLink: { fontSize: 14, color: Colors.primary, fontWeight: '600' },

  disclaimer: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center', lineHeight: 18 },

  // Email confirmation steps
  stepsCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadows.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepsTitle: { fontSize: 16, fontWeight: '700', color: Colors.black, marginBottom: Spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumber: { color: Colors.white, fontSize: 13, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 14, color: Colors.black, lineHeight: 22 },

  // Dashboard button — black
  openDashboardBtn: {
    backgroundColor: Colors.black,
    borderRadius: Radius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  openDashboardText: { color: Colors.white, fontSize: 16, fontWeight: '700' },

  // Back button — outlined
  backBtn: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: { color: Colors.black, fontSize: 15, fontWeight: '600' },
});
