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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AmbientBackground } from '../components/AmbientBackground';
import { GlassCard } from '../components/GlassCard';
import { COMMON_CURRENCIES, RECEIPT_CATEGORIES } from '../constants';
import { CATEGORY_ICONS, CATEGORY_LABELS, CURRENCY_LABELS } from '../constants/i18n';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { ReceiptsStackParamList } from '../navigation';
import { convertToCny, convertToUsd } from '../services/currency';
import { deleteReceipt, updateReceipt, uploadReceiptImage } from '../services/receipts';
import { supabase } from '../services/supabase';
import { Receipt, ReceiptCategory } from '../types';

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return JSON.stringify(err);
}

type Props = {
  route: RouteProp<ReceiptsStackParamList, 'EditReceipt'>;
  navigation: NativeStackNavigationProp<ReceiptsStackParamList, 'EditReceipt'>;
};

export default function EditReceiptScreen({ route, navigation }: Props) {
  const { receiptId } = route.params;

  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [original, setOriginal]   = useState<Receipt | null>(null);

  const [date, setDate]             = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount]         = useState('');
  const [currency, setCurrency]     = useState('USD');
  const [category, setCategory]     = useState<ReceiptCategory>('other');
  const [notes, setNotes]           = useState('');
  const [imageUri, setImageUri]     = useState<string | null>(null);
  const [saveTried, setSaveTried]   = useState(false);
  // v1.2 #10/#11: payment proof now editable here too
  const [paymentImageUri, setPaymentImageUri] = useState<string | null>(null);
  // v1.2 #9: track original currency to warn when user changes it
  const [originalCurrency, setOriginalCurrency] = useState<string>('USD');

  useEffect(() => { loadReceipt(); }, [receiptId]);

  async function loadReceipt() {
    // v1.2 #17: maybeSingle handles deleted-record edge case gracefully
    const { data, error } = await supabase
      .from('receipts').select('*').eq('id', receiptId).maybeSingle();
    if (error) {
      Alert.alert('加载失败', error.message);
      navigation.goBack();
      return;
    }
    if (!data) {
      // Receipt deleted elsewhere — silently bounce back to list
      navigation.goBack();
      return;
    }
    setOriginal(data);
    setDate(data.date ?? '');
    setDescription(data.description ?? '');
    setAmount(data.amount > 0 ? String(data.amount) : '');
    setCurrency(data.currency ?? 'USD');
    setCategory((data.category as ReceiptCategory) ?? 'other');
    setNotes(data.notes ?? '');
    setImageUri(data.image_url || null);
    setPaymentImageUri(data.payment_image_url || null);
    setOriginalCurrency(data.currency ?? 'USD');
    setLoading(false);
  }

  async function handleSave(asDraft: boolean) {
    // v1.2 #7: guard against rapid double-tap creating duplicate saves
    if (saving) return;
    setSaveTried(true);

    // v1.2 #5: even drafts now require at least one filled field so we don't
    // silently create totally-empty records.
    if (asDraft) {
      const hasAny = date.trim() || description.trim() || amount.trim();
      if (!hasAny) {
        Alert.alert('草稿至少填一项', '日期、商户、金额至少要填一个再保存草稿。');
        return;
      }
    }

    if (!asDraft) {
      const missing: string[] = [];
      if (!date.trim()) missing.push('日期');
      // v1.2 #18: merchant is now required for a "complete" receipt
      if (!description.trim()) missing.push('商户名称');
      if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
        missing.push('金额');
      if (missing.length > 0) {
        Alert.alert('请补充必填信息', `以下字段不能为空：\n${missing.join('、')}`);
        return;
      }

      // v1.2 #9: if user changed currency and a payment proof with a different
      // currency exists, warn before allowing save.
      const proofCurrency = (original as any)?.payment_currency;
      if (
        currency !== originalCurrency &&
        proofCurrency && proofCurrency !== currency
      ) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '⚠️ 货币不一致',
            `当前选择的币种为 ${currency}，但付款凭证币种为 ${proofCurrency}。\n保存后金额匹配状态可能不准确，建议核对。`,
            [
              { text: '取消修改', style: 'cancel', onPress: () => resolve(false) },
              { text: '仍要保存', style: 'destructive', onPress: () => resolve(true) },
            ],
          );
        });
        if (!proceed) return;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('未登录', '请先登录后再保存。'); return; }

    setSaving(true);
    try {
      const parsedAmount = parseFloat(amount) || 0;
      const saveDate = date.trim() || format(new Date(), 'yyyy-MM-dd');

      let imageUrl = original?.image_url ?? '';
      if (imageUri && imageUri !== original?.image_url) {
        imageUrl = await uploadReceiptImage(imageUri, user.id);
      } else if (!imageUri) {
        imageUrl = '';
      }

      // v1.2 #10 #11: persist payment-proof image URL if user added/changed one
      let paymentUrl: string | undefined = original?.payment_image_url ?? undefined;
      if (paymentImageUri && paymentImageUri !== original?.payment_image_url) {
        paymentUrl = await uploadReceiptImage(paymentImageUri, user.id);
      } else if (!paymentImageUri) {
        paymentUrl = undefined;
      }

      let freshAmountUsd: number | null = null;
      let freshAmountCny: number | null = null;
      if (parsedAmount > 0) {
        [freshAmountUsd, freshAmountCny] = await Promise.all([
          convertToUsd(parsedAmount, currency),
          convertToCny(parsedAmount, currency),
        ]);
      }

      await updateReceipt(receiptId, {
        image_url: imageUrl,
        date: saveDate,
        description,
        amount: parsedAmount,
        currency,
        amount_usd: freshAmountUsd ?? undefined,
        amount_cny: freshAmountCny ?? undefined,
        category,
        notes: notes || undefined,
        is_draft: asDraft,
        payment_image_url: paymentUrl,
      });

      Alert.alert(
        asDraft ? '📋 草稿已保存' : '✅ 保存成功',
        asDraft ? '草稿已保存，可在列表中继续编辑。' : '收据已更新。',
      );
      navigation.goBack();
    } catch (err) {
      Alert.alert('保存失败', errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    Alert.alert('删除收据', '确定要删除这张收据吗？此操作无法撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: async () => {
          try {
            await deleteReceipt(receiptId);
            // v1.2 #17: skip Detail screen (would crash on re-load of deleted row)
            // Pop both Edit + Detail screens back to ReceiptsList.
            const parent = navigation.getParent();
            if (parent && (parent as any).popToTop) {
              (parent as any).popToTop();
            } else {
              navigation.popToTop?.();
            }
          } catch (err) {
            Alert.alert('删除失败', errMsg(err));
          }
        },
      },
    ]);
  }

  async function handlePickImage(source: 'camera' | 'library') {
    let result;
    if (source === 'camera') {
      result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
      });
    }
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  function showImagePicker() {
    Alert.alert('更换图片', '请选择来源', [
      { text: '拍照', onPress: () => handlePickImage('camera') },
      { text: '从相册选取', onPress: () => handlePickImage('library') },
      { text: '取消', style: 'cancel' },
    ]);
  }

  // v1.2 #10 #11: payment proof picker (mirrors handlePickImage but writes to paymentImageUri)
  async function handlePickPaymentImage(source: 'camera' | 'library') {
    let result;
    if (source === 'camera') {
      result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
      });
    }
    if (!result.canceled && result.assets[0]) {
      setPaymentImageUri(result.assets[0].uri);
    }
  }

  function showPaymentImagePicker() {
    Alert.alert('添加 / 更换付款凭证', '请选择来源', [
      { text: '拍照', onPress: () => handlePickPaymentImage('camera') },
      { text: '从相册选取', onPress: () => handlePickPaymentImage('library') },
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

  const isDraft = original?.is_draft ?? false;

  return (
    <AmbientBackground>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {isDraft && (
            <GlassCard preset="thin" shadow="sm" contentStyle={s.draftBanner}>
              <Ionicons name="clipboard-outline" size={18} color="#7C5400" />
              <Text style={s.draftBannerText}>这是一条草稿，请补充信息后保存。</Text>
            </GlassCard>
          )}

          <GlassCard preset="regular" shadow="sm" contentStyle={s.cardContent}>
            <Text style={Typography.label}>收据图片</Text>
            {imageUri ? (
              <View style={s.imageWrap}>
                <Image source={{ uri: imageUri }} style={s.receiptImage} />
                <Pressable
                  onPress={showImagePicker}
                  style={({ pressed }) => [s.imageChangeBtn, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="swap-horizontal" size={14} color={Colors.textPrimary} />
                  <Text style={s.imageChangeBtnText}>更换图片</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={showImagePicker} style={({ pressed }) => [s.imagePlaceholder, pressed && { opacity: 0.7 }]}>
                <Ionicons name="camera-outline" size={28} color={Colors.textSecondary} />
                <Text style={s.imagePlaceholderText}>点击添加图片（可选）</Text>
              </Pressable>
            )}
          </GlassCard>

          <GlassCard preset="regular" shadow="sm" contentStyle={s.cardContent}>
            <Text style={Typography.label}>基本信息</Text>
            <FormField label="日期" value={date} onChange={setDate} placeholder="YYYY-MM-DD" hasError={saveTried && !date.trim()} />
            <FormField label="商户名称" value={description} onChange={setDescription} placeholder="商店 / 餐厅名称" />

            <View style={s.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <FormField
                  label="金额"
                  value={amount}
                  onChange={setAmount}
                  placeholder="0.00"
                  keyboard="decimal-pad"
                  hasError={saveTried && (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[Typography.label, { marginBottom: 6, marginTop: 12 }]}>货币</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {COMMON_CURRENCIES.slice(0, 6).map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[s.chip, currency === c && s.chipActive]}
                      onPress={() => setCurrency(c)}
                    >
                      <Text style={[s.chipText, currency === c && s.chipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </GlassCard>

          <GlassCard preset="regular" shadow="sm" contentStyle={s.cardContent}>
            <Text style={Typography.label}>所有货币</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              {COMMON_CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.chip, currency === c && s.chipActive]}
                  onPress={() => setCurrency(c)}
                >
                  <Text style={[s.chipText, currency === c && s.chipTextActive]}>
                    {CURRENCY_LABELS[c] ?? c}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </GlassCard>

          <GlassCard preset="regular" shadow="sm" contentStyle={s.cardContent}>
            <Text style={Typography.label}>费用分类</Text>
            <View style={s.categoryGrid}>
              {RECEIPT_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.categoryChip, category === c && s.categoryChipActive]}
                  onPress={() => setCategory(c as ReceiptCategory)}
                >
                  <Text style={s.categoryIcon}>{CATEGORY_ICONS[c]}</Text>
                  <Text style={[s.categoryText, category === c && s.categoryTextActive]}>
                    {CATEGORY_LABELS[c] ?? c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </GlassCard>

          {/* v1.2 #10 #11: payment proof now editable in EditReceiptScreen too */}
          <GlassCard preset="regular" shadow="sm" contentStyle={s.cardContent}>
            <Text style={Typography.label}>付款凭证</Text>
            {paymentImageUri ? (
              <View style={s.imageWrap}>
                <Image source={{ uri: paymentImageUri }} style={s.receiptImage} />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Pressable
                    onPress={showPaymentImagePicker}
                    style={({ pressed }) => [s.imageChangeBtn, { flex: 1 }, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="swap-horizontal" size={14} color={Colors.textPrimary} />
                    <Text style={s.imageChangeBtnText}>更换凭证</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setPaymentImageUri(null)}
                    style={({ pressed }) => [s.imageChangeBtn, { flex: 1, borderColor: 'rgba(255, 69, 58, 0.4)' }, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                    <Text style={[s.imageChangeBtnText, { color: Colors.danger }]}>移除凭证</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={showPaymentImagePicker} style={({ pressed }) => [s.imagePlaceholder, pressed && { opacity: 0.7 }]}>
                <Ionicons name="receipt-outline" size={28} color={Colors.textSecondary} />
                <Text style={s.imagePlaceholderText}>添加付款凭证（可选）</Text>
              </Pressable>
            )}
          </GlassCard>

          <GlassCard preset="regular" shadow="sm" contentStyle={s.cardContent}>
            <Text style={Typography.label}>备注</Text>
            <TextInput
              style={[s.input, s.notesInput, { marginTop: 8 }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="添加备注（可选）"
              placeholderTextColor={Colors.textTertiary}
              multiline
            />
          </GlassCard>

          <Pressable
            style={({ pressed }) => [s.primaryBtn, saving && s.btnDisabled, pressed && { opacity: 0.85 }]}
            onPress={() => handleSave(false)}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color={Colors.textInverse} />
              : <Text style={s.primaryBtnText}>保存并完成</Text>}
          </Pressable>

          <Pressable
            style={({ pressed }) => [s.draftBtn, saving && s.btnDisabled, pressed && { opacity: 0.7 }]}
            onPress={() => handleSave(true)}
            disabled={saving}
          >
            <Text style={s.draftBtnText}>保存草稿</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [s.deleteBtn, pressed && { opacity: 0.6 }]}
            onPress={handleDelete}
            disabled={saving}
          >
            <Ionicons name="trash-outline" size={16} color={Colors.danger} />
            <Text style={s.deleteBtnText}>删除收据</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </AmbientBackground>
  );
}

function FormField({
  label, value, onChange, placeholder, keyboard, hasError,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboard?: 'decimal-pad' | 'default';
  hasError?: boolean;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 }}>
        <Text style={Typography.label}>{label}</Text>
        {hasError && <Text style={s.fieldErrorTag}>必填</Text>}
      </View>
      <TextInput
        style={[s.input, hasError && s.inputError]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={hasError ? '#F87171' : Colors.textTertiary}
        keyboardType={keyboard ?? 'default'}
      />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  // v1.2 #1: extra bottom padding so last button isn't hidden behind tab bar
  content: { padding: Spacing.md, paddingBottom: 220, gap: Spacing.sm },

  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: Spacing.md,
    backgroundColor: 'rgba(255, 159, 10, 0.15)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  draftBannerText: { flex: 1, fontSize: 13, color: '#7C5400', fontWeight: '500', lineHeight: 18 },

  cardContent: { padding: Spacing.md },

  imageWrap: { marginTop: 10, borderRadius: Radius.sm, overflow: 'hidden' },
  receiptImage: { width: '100%', height: 200, resizeMode: 'cover' },
  imageChangeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    marginTop: 8, paddingVertical: 10,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
    backgroundColor: Colors.surfaceTertiary,
  },
  imageChangeBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  imagePlaceholder: {
    marginTop: 10, paddingVertical: 28, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.4)',
  },
  imagePlaceholderText: { fontSize: 13, color: Colors.textTertiary, fontWeight: '500' },

  row: { flexDirection: 'row', alignItems: 'flex-start' },

  input: {
    backgroundColor: Colors.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: Colors.textPrimary,
  },
  inputError: { borderColor: '#EF4444', backgroundColor: '#FFF5F5' },
  fieldErrorTag: {
    fontSize: 10, fontWeight: '700', color: '#EF4444',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },

  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
    marginRight: 6,
    backgroundColor: Colors.surfaceTertiary,
  },
  chipActive: { backgroundColor: Colors.textPrimary, borderColor: Colors.textPrimary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
    backgroundColor: Colors.surfaceTertiary,
    gap: 4,
  },
  categoryChipActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  categoryIcon: { fontSize: 14 },
  categoryText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  categoryTextActive: { color: Colors.accent, fontWeight: '700' },

  primaryBtn: {
    backgroundColor: Colors.textPrimary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16, shadowRadius: 14,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },

  draftBtn: {
    borderWidth: 1.5, borderColor: Colors.textPrimary,
    borderRadius: Radius.md, paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  draftBtnText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },

  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 4, paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: 'rgba(255, 69, 58, 0.4)',
    backgroundColor: 'rgba(255, 69, 58, 0.06)',
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 15 },
});
