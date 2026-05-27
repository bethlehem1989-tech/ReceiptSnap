import { Ionicons } from '@expo/vector-icons';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AmbientBackground } from '../components/AmbientBackground';
import { GlassCard } from '../components/GlassCard';
import { CATEGORY_LABELS } from '../constants/i18n';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { ReceiptsStackParamList } from '../navigation';
import { convertToCny } from '../services/currency';
import { extractReceiptData } from '../services/ocr';
import { addPaymentProof, deleteReceipt, uploadReceiptImage } from '../services/receipts';
import { supabase } from '../services/supabase';
import { Receipt, ReceiptCategory } from '../types';

const CATEGORY_COLORS: Record<ReceiptCategory, string> = {
  meals: Colors.meals, transport: Colors.transport,
  accommodation: Colors.accommodation, entertainment: Colors.entertainment,
  office: Colors.office, other: Colors.other,
};

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return JSON.stringify(err);
}

type Props = {
  route: RouteProp<ReceiptsStackParamList, 'ReceiptDetail'>;
  navigation: NativeStackNavigationProp<ReceiptsStackParamList, 'ReceiptDetail'>;
};

export default function ReceiptDetailScreen({ route, navigation }: Props) {
  const { receiptId } = route.params;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingProof, setAddingProof] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => loadReceipt());
    loadReceipt();
    return unsubscribe;
  }, [receiptId, navigation]);

  // Show "Edit" button in the navigation header so users can switch to
  // EditReceiptScreen for completed receipts (previously edit was draft-only).
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('EditReceipt', { receiptId })}
          hitSlop={10}
          style={({ pressed }) => [{ opacity: pressed ? 0.55 : 1 }]}
        >
          <Text style={s.headerEditText}>编辑</Text>
        </Pressable>
      ),
    });
  }, [navigation, receiptId]);

  async function loadReceipt() {
    // v1.2 #17: use maybeSingle() so a record deleted from a child screen
    // doesn't throw "Cannot coerce result to single JSON object" when we
    // re-load on focus.
    const { data, error } = await supabase
      .from('receipts').select('*').eq('id', receiptId).maybeSingle();
    if (error) {
      Alert.alert('Error', error.message);
    } else if (!data) {
      // Receipt was deleted while we were away — pop back to list silently.
      navigation.goBack();
    } else {
      setReceipt(data);
    }
    setLoading(false);
  }

  async function handleDelete() {
    Alert.alert('删除收据', '确定要删除这张收据吗？此操作无法撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await deleteReceipt(receiptId);
            navigation.goBack();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            Alert.alert('删除失败', msg);
          }
        },
      },
    ]);
  }

  async function handleAddProof(source: 'camera' | 'library') {
    let result;
    if (source === 'camera') {
      result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
      });
    }
    if (result.canceled || !result.assets[0] || !receipt) return;

    const proofUri = result.assets[0].uri;
    setAddingProof(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('未登录'); return; }

      let matchStatus: 'matched' | 'mismatch' = 'mismatch';
      let mismatchMsg = '';
      let proofAmount: number | undefined;
      let proofCurrency: string | undefined;
      let proofAmountCny: number | undefined;
      try {
        const proofOcr = await extractReceiptData(proofUri, false);
        if (proofOcr.amount && proofOcr.currency) {
          proofAmount   = proofOcr.amount;
          proofCurrency = proofOcr.currency;
          const [receiptCny, pCny] = await Promise.all([
            convertToCny(receipt.amount, receipt.currency),
            convertToCny(proofOcr.amount, proofOcr.currency),
          ]);
          proofAmountCny = pCny ?? undefined;
          if (receiptCny != null && pCny != null && receiptCny > 0) {
            const diffPct = Math.abs(receiptCny - pCny) / receiptCny;
            matchStatus = diffPct <= 0.08 ? 'matched' : 'mismatch';
            if (matchStatus === 'mismatch') {
              mismatchMsg = `收据 ≈ ¥${receiptCny.toFixed(2)}\n凭证 ≈ ¥${pCny.toFixed(2)}\n差异 ${(diffPct * 100).toFixed(1)}%`;
            }
          }
        }
      } catch { /* OCR unavailable */ }

      const proofUrl = await uploadReceiptImage(proofUri, user.id);

      if (matchStatus === 'mismatch' && mismatchMsg) {
        await new Promise<void>((resolve) => {
          Alert.alert(
            '⚠️ 金额不匹配',
            `${mismatchMsg}\n\n是否需要填写备注向财务解释？`,
            [
              {
                text: '跳过', style: 'cancel', onPress: async () => {
                  await addPaymentProof(receiptId, proofUrl, 'mismatch', undefined, proofAmount, proofCurrency, proofAmountCny);
                  await loadReceipt();
                  resolve();
                },
              },
              {
                text: '填写备注', onPress: () => {
                  Alert.prompt(
                    '填写备注',
                    '请简要说明金额差异原因',
                    async (text) => {
                      await addPaymentProof(receiptId, proofUrl, 'mismatch', text || undefined, proofAmount, proofCurrency, proofAmountCny);
                      await loadReceipt();
                      resolve();
                    },
                    'plain-text',
                    receipt.notes ?? '',
                  );
                },
              },
            ],
          );
        });
      } else {
        await addPaymentProof(receiptId, proofUrl, matchStatus, undefined, proofAmount, proofCurrency, proofAmountCny);
        await loadReceipt();
        if (matchStatus === 'matched') {
          Alert.alert('✅ 凭证已匹配', '付款凭证与收据金额吻合。');
        }
      }
    } catch (err) {
      Alert.alert('上传失败', errMsg(err));
    } finally {
      setAddingProof(false);
    }
  }

  function showAddProofOptions() {
    Alert.alert('添加付款凭证', '请选择图片来源', [
      { text: '拍照', onPress: () => handleAddProof('camera') },
      { text: '从相册选取', onPress: () => handleAddProof('library') },
      { text: '取消', style: 'cancel' },
    ]);
  }

  if (loading) {
    return (
      <AmbientBackground>
        <View style={s.center}><ActivityIndicator size="large" color={Colors.textPrimary} /></View>
      </AmbientBackground>
    );
  }
  if (!receipt) {
    return (
      <AmbientBackground>
        <View style={s.center}><Text style={Typography.body}>收据未找到</Text></View>
      </AmbientBackground>
    );
  }

  const catColor = CATEGORY_COLORS[(receipt.category as ReceiptCategory) ?? 'other'];
  const matchStatus = receipt.payment_match_status;
  const catLabel = receipt.category ? (CATEGORY_LABELS[receipt.category] ?? receipt.category) : '未分类';

  return (
    <AmbientBackground>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 100, paddingBottom: 200 }}>
        {receipt.image_url ? (
          <Image source={{ uri: receipt.image_url }} style={s.heroImage} />
        ) : (
          <View style={s.heroImagePlaceholder}>
            <Ionicons name="document-text-outline" size={48} color={Colors.textTertiary} />
          </View>
        )}

        <GlassCard preset="thick" radius={Radius.xl} shadow="hero" style={s.heroCardWrap} contentStyle={s.heroCardContent}>
          <Text style={s.heroAmount}>
            {receipt.amount.toLocaleString()} <Text style={s.heroCurrency}>{receipt.currency}</Text>
          </Text>
          {receipt.amount_usd != null && (
            <Text style={s.heroUsd}>≈ ${receipt.amount_usd.toFixed(2)} USD</Text>
          )}
          {(receipt as any).amount_cny != null && (
            <Text style={s.heroUsd}>≈ ¥{(receipt as any).amount_cny.toFixed(2)} CNY</Text>
          )}
          <View style={[s.heroCategoryPill, { backgroundColor: catColor + '24' }]}>
            <Text style={[s.heroCategoryText, { color: catColor }]}>{catLabel}</Text>
          </View>
        </GlassCard>

        <GlassCard preset="regular" shadow="sm" style={s.card} contentStyle={s.cardContent}>
          <DetailRow icon="storefront-outline" label="商户" value={receipt.description || '—'} />
          <DetailRow icon="calendar-outline" label="日期" value={receipt.date ? format(new Date(receipt.date), 'yyyy年M月d日') : '—'} />
          {receipt.notes && <DetailRow icon="reader-outline" label="备注" value={receipt.notes} />}
        </GlassCard>

        <GlassCard preset="regular" shadow="sm" style={s.card} contentStyle={s.cardContent}>
          <View style={s.proofHeader}>
            <Text style={[Typography.label, { flex: 1 }]}>付款凭证</Text>
            {matchStatus === 'matched' && (
              <View style={s.matchBadgeGreen}>
                <Ionicons name="checkmark-circle" size={14} color="#0F766E" />
                <Text style={[s.matchBadgeText, { color: '#0F766E' }]}>已匹配</Text>
              </View>
            )}
            {matchStatus === 'mismatch' && (
              <View style={s.matchBadgeRed}>
                <Ionicons name="alert-circle" size={14} color="#B91C1C" />
                <Text style={[s.matchBadgeText, { color: '#B91C1C' }]}>金额不符</Text>
              </View>
            )}
          </View>

          {receipt.payment_image_url ? (
            <View style={{ marginTop: 10 }}>
              <Image source={{ uri: receipt.payment_image_url }} style={s.proofImage} />
              <Pressable
                onPress={showAddProofOptions}
                disabled={addingProof}
                style={({ pressed }) => [s.proofReplaceBtn, addingProof && { opacity: 0.5 }, pressed && { opacity: 0.6 }]}
              >
                {addingProof
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Text style={s.proofReplaceBtnText}>更换凭证</Text>
                }
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [s.proofAddBtn, addingProof && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
              onPress={showAddProofOptions}
              disabled={addingProof}
            >
              {addingProof ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color={Colors.accent} />
                  <Text style={s.proofAddBtnText}>正在识别凭证...</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
                  <Text style={s.proofAddBtnText}>添加付款凭证（可选）</Text>
                </View>
              )}
            </Pressable>
          )}
        </GlassCard>

        {receipt.ocr_confidence != null && receipt.ocr_confidence > 0 && (
          <GlassCard preset="thin" shadow="sm" style={s.card} contentStyle={s.confidenceCardContent}>
            <Text style={s.confidenceLabel}>AI 识别置信度</Text>
            <View style={s.confidenceBarTrack}>
              <View style={[s.confidenceBarFill, {
                width: `${Math.round(receipt.ocr_confidence * 100)}%` as any,
                backgroundColor: receipt.ocr_confidence > 0.7 ? Colors.success : Colors.warning,
              }]} />
            </View>
            <Text style={s.confidenceValue}>{Math.round(receipt.ocr_confidence * 100)}%</Text>
          </GlassCard>
        )}

        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [s.deleteBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          <Text style={s.deleteBtnText}>删除收据</Text>
        </Pressable>
      </ScrollView>
    </AmbientBackground>
  );
}

function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <View style={s.detailIconWrap}>
        <Ionicons name={icon} size={18} color={Colors.textPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text style={s.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  headerEditText: { fontSize: 16, color: Colors.accent, fontWeight: '600' },

  heroImage: { width: '100%', height: 280, resizeMode: 'cover' },
  heroImagePlaceholder: {
    width: '100%', height: 220, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceTertiary,
  },

  heroCardWrap: {
    marginHorizontal: Spacing.md,
    marginTop: -Spacing.xl,
  },
  heroCardContent: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  heroAmount: { fontSize: 38, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -1.2 },
  heroCurrency: { fontSize: 18, fontWeight: '600', color: Colors.textSecondary },
  heroUsd: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  heroCategoryPill: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full },
  heroCategoryText: { fontSize: 13, fontWeight: '700' },

  card: { marginHorizontal: Spacing.md, marginTop: Spacing.md },
  cardContent: { paddingHorizontal: Spacing.md },
  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.hairline,
    gap: 12,
  },
  detailIconWrap: {
    width: 32, height: 32,
    borderRadius: 10,
    backgroundColor: Colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  detailLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  detailValue: { fontSize: 15, fontWeight: '500', color: Colors.textPrimary },

  proofHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.md, paddingBottom: 4, gap: 8 },
  matchBadgeGreen: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.successLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  matchBadgeRed: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.dangerLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  matchBadgeText: { fontSize: 12, fontWeight: '700' },
  proofImage: { width: '100%', height: 200, borderRadius: Radius.sm, resizeMode: 'cover' },
  proofReplaceBtn: { marginTop: 10, marginBottom: Spacing.md, alignItems: 'center' },
  proofReplaceBtnText: { fontSize: 13, color: Colors.accent, fontWeight: '600' },
  proofAddBtn: {
    marginVertical: Spacing.md, paddingVertical: 16, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.4)',
  },
  proofAddBtnText: { fontSize: 14, color: Colors.accent, fontWeight: '600' },

  confidenceCardContent: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: Spacing.md,
  },
  confidenceLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500', width: 90 },
  confidenceBarTrack: { flex: 1, height: 6, backgroundColor: Colors.surfaceTertiary, borderRadius: 3, overflow: 'hidden' },
  confidenceBarFill: { height: '100%', borderRadius: 3 },
  confidenceValue: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary, width: 35, textAlign: 'right' },

  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginHorizontal: Spacing.md, marginTop: Spacing.md,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: 'rgba(255, 69, 58, 0.4)',
    backgroundColor: 'rgba(255, 69, 58, 0.06)',
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 15 },
});
