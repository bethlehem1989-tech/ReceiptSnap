import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmbientBackground } from '../components/AmbientBackground';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
import {
  AI_PROVIDERS,
  AiProviderId,
  getActiveProvider,
  getProviderKey,
  setActiveProvider,
  setProviderKey,
} from '../services/aiProvider';
import { testProviderKey } from '../services/ocr';

const PROVIDER_ORDER: AiProviderId[] = ['qwen', 'anthropic', 'openai', 'gemini'];

export default function ProfileScreen() {
  const [activeId, setActiveId] = useState<AiProviderId>('qwen');
  const [editingId, setEditingId] = useState<AiProviderId>('qwen');
  const [keyInput, setKeyInput] = useState('');
  const [keys, setKeys] = useState<Record<AiProviderId, string>>({
    qwen: '', openai: '', anthropic: '', gemini: '',
  });
  const [testing, setTesting] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const active = await getActiveProvider();
    setActiveId(active.id);
    setEditingId(active.id);
    setKeyInput(active.apiKey);
    const all: Record<AiProviderId, string> = {
      qwen: '', openai: '', anthropic: '', gemini: '',
    };
    for (const id of PROVIDER_ORDER) all[id] = await getProviderKey(id);
    setKeys(all);
  }

  function selectEditing(id: AiProviderId) {
    setEditingId(id);
    setKeyInput(keys[id] ?? '');
  }

  async function handleSetActive(id: AiProviderId) {
    await setActiveProvider(id);
    setActiveId(id);
  }

  async function handleSaveKey() {
    await setProviderKey(editingId, keyInput);
    setKeys((prev) => ({ ...prev, [editingId]: keyInput }));
    Alert.alert('已保存', `${AI_PROVIDERS[editingId].shortName} 的 API Key 已更新。`);
  }

  async function handleClearKey() {
    Alert.alert(
      '清除 API Key',
      `确定要清除 ${AI_PROVIDERS[editingId].shortName} 的本地 API Key 吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: async () => {
            await setProviderKey(editingId, '');
            setKeys((prev) => ({ ...prev, [editingId]: '' }));
            const fresh = await getProviderKey(editingId);
            setKeyInput(fresh);
          },
        },
      ],
    );
  }

  async function handleTest() {
    setTesting(true);
    try {
      await testProviderKey(editingId, keyInput);
      Alert.alert('✓ 测试通过', '该 Key 可用，识别调用没问题。');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('✗ 测试失败', msg);
    } finally {
      setTesting(false);
    }
  }

  const editingInfo = AI_PROVIDERS[editingId];
  const editingHasKey = (keys[editingId] ?? '').length > 0;

  // v1.2 #4: profile card is informational; tapping shows app-version info
  // so the chevron-right doesn't mislead users into thinking it's broken.
  function handleProfileTap() {
    Alert.alert(
      '关于账户',
      `当前为本地匿名账户，所有数据云端同步。\n\nReceiptSnap v1.2.0\n海外差旅报销助手`,
      [{ text: '好的', style: 'cancel' }],
    );
  }

  return (
    <AmbientBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Profile header */}
          <Text style={s.screenTitle}>我的</Text>

          <Pressable
            onPress={handleProfileTap}
            style={({ pressed }) => [s.profileCard, pressed && { opacity: 0.8 }]}
          >
            <View style={s.avatar}>
              <Ionicons name="person" size={28} color={Colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>差旅用户</Text>
              <Text style={s.profileSub}>本地账户 · 数据云同步</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </Pressable>

          {/* AI provider section */}
          <Text style={s.sectionLabel}>识别引擎</Text>
          <View style={s.providerCard}>
            {PROVIDER_ORDER.map((id, idx) => {
              const info = AI_PROVIDERS[id];
              const isActive = activeId === id;
              const isEditing = editingId === id;
              const hasKey = (keys[id] ?? '').length > 0;
              return (
                <Pressable
                  key={id}
                  onPress={() => selectEditing(id)}
                  style={({ pressed }) => [
                    s.providerRow,
                    idx > 0 && s.providerRowBorder,
                    isEditing && s.providerRowEditing,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={[s.providerIcon, { backgroundColor: PROVIDER_COLORS[id] + '22' }]}>
                    <Text style={[s.providerIconText, { color: PROVIDER_COLORS[id] }]}>
                      {info.shortName[0]}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.providerNameRow}>
                      <Text style={s.providerName}>{info.name}</Text>
                      {isActive && (
                        <View style={s.activePill}>
                          <Text style={s.activePillText}>使用中</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.providerDesc} numberOfLines={2}>{info.description}</Text>
                  </View>
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <View
                      style={[
                        s.keyStatusDot,
                        { backgroundColor: hasKey ? Colors.success : Colors.warning },
                      ]}
                    />
                    <Text style={s.keyStatusLabel}>{hasKey ? '已配置' : '缺 Key'}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Use this provider */}
          <Pressable
            onPress={() => handleSetActive(editingId)}
            disabled={activeId === editingId}
            style={({ pressed }) => [
              s.useBtn,
              activeId === editingId && s.useBtnDisabled,
              pressed && !(activeId === editingId) && { opacity: 0.85 },
            ]}
          >
            <Ionicons
              name={activeId === editingId ? 'checkmark-circle' : 'flash-outline'}
              size={18}
              color={activeId === editingId ? Colors.success : Colors.textInverse}
            />
            <Text
              style={[
                s.useBtnText,
                activeId === editingId && { color: Colors.success },
              ]}
            >
              {activeId === editingId
                ? `当前使用 ${editingInfo.shortName}`
                : `切换到 ${editingInfo.shortName}`}
            </Text>
          </Pressable>

          {/* Edit key */}
          <Text style={s.sectionLabel}>{editingInfo.shortName} · API Key</Text>
          <View style={s.keyCard}>
            <Text style={s.keyHint}>{editingInfo.keyHint}</Text>
            <Pressable onPress={() => Linking.openURL(editingInfo.keyUrl)} style={s.keyLinkRow}>
              <Ionicons name="open-outline" size={14} color={Colors.accent} />
              <Text style={s.keyLink} numberOfLines={1}>{editingInfo.keyUrl}</Text>
            </Pressable>

            <TextInput
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder="粘贴你的 API Key"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={s.keyInput}
            />

            <View style={s.keyBtnRow}>
              <Pressable
                onPress={handleSaveKey}
                style={({ pressed }) => [s.keyBtn, s.keyBtnPrimary, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.keyBtnPrimaryText}>保存</Text>
              </Pressable>
              <Pressable
                onPress={handleTest}
                disabled={testing || !keyInput}
                style={({ pressed }) => [
                  s.keyBtn,
                  s.keyBtnSecondary,
                  (testing || !keyInput) && { opacity: 0.4 },
                  pressed && { opacity: 0.6 },
                ]}
              >
                {testing ? (
                  <ActivityIndicator size="small" color={Colors.textPrimary} />
                ) : (
                  <Text style={s.keyBtnSecondaryText}>测试 Key</Text>
                )}
              </Pressable>
              {editingHasKey && (
                <Pressable
                  onPress={handleClearKey}
                  style={({ pressed }) => [s.keyBtn, s.keyBtnDanger, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                </Pressable>
              )}
            </View>

            <Text style={s.keyFootnote}>Key 只保存在你本机，不会上传到服务器。</Text>
          </View>

          <View style={{ height: 200 }} />
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const PROVIDER_COLORS: Record<AiProviderId, string> = {
  qwen: '#615CED',
  openai: '#10A37F',
  anthropic: '#C15F3C',
  gemini: '#4285F4',
};

const s = StyleSheet.create({
  content: { padding: Spacing.md, paddingTop: Spacing.sm },

  screenTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.7,
    marginBottom: Spacing.md,
  },

  // Profile header card
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
    ...Shadows.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  profileSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 10,
    marginTop: 4,
  },

  // Provider list
  providerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: 4,
    ...Shadows.sm,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    gap: 12,
  },
  providerRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.hairline,
  },
  providerRowEditing: {
    backgroundColor: Colors.accentLight,
  },
  providerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerIconText: { fontSize: 18, fontWeight: '800' },
  providerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  providerName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  providerDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 3, lineHeight: 16 },

  activePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.accentLight,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.accent,
    letterSpacing: 0.3,
  },

  keyStatusDot: { width: 8, height: 8, borderRadius: 4 },
  keyStatusLabel: { fontSize: 9, color: Colors.textTertiary, fontWeight: '600' },

  // Use button
  useBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    marginTop: Spacing.md,
    ...Shadows.sm,
  },
  useBtnDisabled: { backgroundColor: Colors.successLight, ...Shadows.sm },
  useBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

  // Key card
  keyCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md,
    ...Shadows.sm,
  },
  keyHint: { fontSize: 12, color: Colors.textSecondary, marginBottom: 6, lineHeight: 17 },
  keyLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: Spacing.md },
  keyLink: { fontSize: 12, color: Colors.accent, flex: 1 },

  keyInput: {
    backgroundColor: Colors.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    fontFamily: 'Menlo',
  },

  keyBtnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  keyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBtnPrimary: { flex: 1, backgroundColor: Colors.accent },
  keyBtnPrimaryText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  keyBtnSecondary: {
    flex: 1,
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  keyBtnSecondaryText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  keyBtnDanger: {
    width: 44,
    backgroundColor: Colors.dangerLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(181, 72, 61, 0.30)',
  },

  keyFootnote: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 10,
    lineHeight: 16,
  },
});
