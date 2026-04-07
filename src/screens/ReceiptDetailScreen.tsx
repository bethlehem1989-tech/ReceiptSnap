import * as ImagePicker from 'expo-image-picker';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
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
    loadReceipt();
  }, [receiptId]);

  async function loadReceipt() {
    const { data, error } = await supabase
      .from('receipts').select('*').eq('id', receiptId).single();
    if (error) Alert.alert('Error', error.message);
    else setReceipt(data);
    setLoading(false);
  }

  async function handleDelete() {
    Alert.alert('删除收据', '确定要删除这张收据吗？此操作无法撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          await deleteReceipt(receiptId);
          navigation.goBack();
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

      // OCR the proof to extract amount/currency, then compare in CNY
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
        // Ask for notes before saving
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
    return <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }
  if (!receipt) {
    return <View style={s.center}><Text style={Typography.body}>收据未找到</Text></View>;
  }

  const catColor = CATEGORY_COLORS[(receipt.category as ReceiptCategory) ?? 'other'];
  const matchStatus = receipt.payment_match_status;

  return (
    <ScrollView style={s.screen} showsVerticalScrollIndicator={false}>
      {/* Receipt image */}
      <Image source={{ uri: receipt.image_url }} style={s.heroImage} />

      {/* Hero amount card */}
      <View style={s.heroCard}>
        <Text style={s.heroAmount}>
          {receipt.amount.toLocaleString()} {receipt.currency}
        </Text>
        {receipt.amount_usd != null && (
          <Text style={s.heroUsd}>≈ ${receipt.amount_usd.toFixed(2)} USD</Text>
        )}
        {(receipt as any).amount_cny != null && (
          <Text style={s.heroUsd}>≈ ¥{(receipt as any).amount_cny.toFixed(2)} CNY</Text>
        )}
        {receipt.category && (
          <View style={[s.heroCategoryPill, { backgroundColor: catColor + '25' }]}>
            <Text style={[s.heroCategoryText, { color: catColor }]}>
              {receipt.category}
            </Text>
          </View>
        )}
      </View>

      {/* Details card */}
      <View style={s.card}>
        <DetailRow icon="🏪" label="商户" value={receipt.description || '—'} />
        <DetailRow icon="📅" label="日期" value={format(new Date(receipt.date), 'MMMM d, yyyy')} />
        {receipt.notes && <DetailRow icon="📝" label="备注" value={receipt.notes} />}
      </View>

      {/* Payment proof card */}
      <View style={s.card}>
        <View style={s.proofHeader}>
          <Text style={[Typography.label, { flex: 1 }]}>付款凭证</Text>
          {matchStatus === 'matched' && (
            <View style={s.matchBadgeGreen}><Text style={s.matchBadgeText}>✓ 已匹配</Text></View>
          )}
          {matchStatus === 'mismatch' && (
            <View style={s.matchBadgeRed}><Text style={s.matchBadgeText}>⚠ 金额不符</Text></View>
          )}
        </View>

        {receipt.payment_image_url ? (
          <View style={{ marginTop: 10 }}>
            <Image source={{ uri: receipt.payment_image_url }} style={s.proofImage} />
            <TouchableOpacity
              style={[s.proofReplaceBtn, addingProof && { opacity: 0.5 }]}
              onPress={showAddProofOptions}
              disabled={addingProof}
            >
              {addingProof
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Text style={s.proofReplaceBtnText}>🔄 更换凭证</Text>
              }
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[s.proofAddBtn, addingProof && { opacity: 0.5 }]}
            onPress={showAddProofOptions}
            disabled={addingProof}
          >
            {addingProof ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={s.proofAddBtnText}>正在识别凭证...</Text>
              </View>
            ) : (
              <Text style={s.proofAddBtnText}>＋ 添加付款凭证（可选）</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* OCR confidence */}
      {receipt.ocr_confidence != null && receipt.ocr_confidence > 0 && (
        <View style={s.ocrBadgeCard}>
          <Text style={s.ocrBadgeLabel}>AI 识别置信度</Text>
          <View style={s.ocrBarTrack}>
            <View style={[s.ocrBarFill, {
              width: `${Math.round(receipt.ocr_confidence * 100)}%` as any,
              backgroundColor: receipt.ocr_confidence > 0.7 ? Colors.success : Colors.warning,
            }]} />
          </View>
          <Text style={s.ocrBadgeValue}>{Math.round(receipt.ocr_confidence * 100)}%</Text>
        </View>
      )}

      {/* Delete */}
      <TouchableOpacity style={s.deleteBtn} onPress={handleDelete}>
        <Text style={s.deleteBtnText}>删除收据</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text style={s.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  heroImage: { width: '100%', height: 280, resizeMode: 'cover' },
  heroCard: {
    backgroundColor: Colors.surface, marginHorizontal: Spacing.md,
    marginTop: -Spacing.xl, borderRadius: Radius.xl, padding: Spacing.lg,
    alignItems: 'center', ...Shadows.lg,
  },
  heroAmount: { fontSize: 36, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -1 },
  heroUsd: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  heroCategoryPill: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full },
  heroCategoryText: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  card: {
    backgroundColor: Colors.surface, marginHorizontal: Spacing.md,
    marginTop: Spacing.md, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, ...Shadows.sm,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, gap: 12,
  },
  detailIcon: { fontSize: 20, marginTop: 2 },
  detailLabel: { fontSize: 11, fontWeight: '600', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  detailValue: { fontSize: 15, fontWeight: '500', color: Colors.textPrimary },

  // Payment proof
  proofHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.md, paddingBottom: 4 },
  matchBadgeGreen: { backgroundColor: '#D1FAE5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  matchBadgeRed: { backgroundColor: '#FEE2E2', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  matchBadgeText: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  proofImage: { width: '100%', height: 200, borderRadius: Radius.sm, resizeMode: 'cover' },
  proofReplaceBtn: { marginTop: 10, marginBottom: Spacing.md, alignItems: 'center' },
  proofReplaceBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  proofAddBtn: {
    marginVertical: Spacing.md, paddingVertical: 16, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center', backgroundColor: Colors.surfaceSecondary,
  },
  proofAddBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },

  ocrBadgeCard: {
    backgroundColor: Colors.surface, marginHorizontal: Spacing.md, marginTop: Spacing.md,
    borderRadius: Radius.lg, padding: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 10, ...Shadows.sm,
  },
  ocrBadgeLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500', width: 90 },
  ocrBarTrack: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  ocrBarFill: { height: '100%', borderRadius: 3 },
  ocrBadgeValue: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, width: 35, textAlign: 'right' },

  deleteBtn: {
    marginHorizontal: Spacing.md, marginTop: Spacing.md, paddingVertical: 14,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.danger, alignItems: 'center',
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 15 },
});
