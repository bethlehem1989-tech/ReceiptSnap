import * as ImagePicker from 'expo-image-picker';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COMMON_CURRENCIES, RECEIPT_CATEGORIES } from '../constants';
import { CATEGORY_ICONS, CATEGORY_LABELS, CURRENCY_LABELS } from '../constants/i18n';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
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

  // Form fields
  const [date, setDate]             = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount]         = useState('');
  const [currency, setCurrency]     = useState('USD');
  const [category, setCategory]     = useState<ReceiptCategory>('other');
  const [notes, setNotes]           = useState('');
  const [imageUri, setImageUri]     = useState<string | null>(null);
  const [saveTried, setSaveTried]   = useState(false);

  useEffect(() => { loadReceipt(); }, [receiptId]);

  async function loadReceipt() {
    const { data, error } = await supabase
      .from('receipts').select('*').eq('id', receiptId).single();
    if (error || !data) {
      Alert.alert('加载失败', error?.message ?? '收据未找到');
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
    setLoading(false);
  }

  async function handleSave(asDraft: boolean) {
    setSaveTried(true);
    if (!asDraft) {
      const missing: string[] = [];
      if (!date.trim()) missing.push('日期');
      if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
        missing.push('金额');
      if (missing.length > 0) {
        Alert.alert('请补充必填信息', `以下字段不能为空：\n${missing.join('、')}`);
        return;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('未登录', '请先登录后再保存。'); return; }

    setSaving(true);
    try {
      const parsedAmount = parseFloat(amount) || 0;
      const saveDate = date.trim() || format(new Date(), 'yyyy-MM-dd');

      // Upload new image only if it changed from what's stored
      let imageUrl = original?.image_url ?? '';
      if (imageUri && imageUri !== original?.image_url) {
        imageUrl = await uploadReceiptImage(imageUri, user.id);
      } else if (!imageUri) {
        imageUrl = '';
      }

      // Recompute conversions if amount is meaningful
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
      });

      Alert.alert(
        asDraft ? '📋 草稿已保存' : '✅ 保存成功',
        asDraft ? '草稿已保存，可在列表中继续编辑。' : '收据已更新。',
      );
      navigation.goBack();
    } catch (err) {
      setSaving(false);
      Alert.alert('保存失败', errMsg(err));
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
            navigation.goBack();
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

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.black} />
      </View>
    );
  }

  const isDraft = original?.is_draft ?? false;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Draft banner */}
        {isDraft && (
          <View style={s.draftBanner}>
            <Text style={s.draftBannerIcon}>📋</Text>
            <Text style={s.draftBannerText}>这是一条草稿记录，请补充信息后保存。</Text>
          </View>
        )}

        {/* Image section */}
        <View style={s.card}>
          <Text style={Typography.label}>收据图片</Text>
          {imageUri ? (
            <View style={s.imageWrap}>
              <Image source={{ uri: imageUri }} style={s.receiptImage} />
              <TouchableOpacity style={s.imageChangeBtn} onPress={showImagePicker}>
                <Text style={s.imageChangeBtnText}>更换图片</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={s.imagePlaceholder} onPress={showImagePicker}>
              <Text style={s.imagePlaceholderIcon}>📷</Text>
              <Text style={s.imagePlaceholderText}>点击添加图片（可选）</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Basic info */}
        <View style={s.card}>
          <Text style={Typography.label}>基本信息</Text>

          <FormField
            label="日期"
            value={date}
            onChange={setDate}
            placeholder="YYYY-MM-DD"
            hasError={saveTried && !date.trim()}
          />
          <FormField
            label="商户名称"
            value={description}
            onChange={setDescription}
            placeholder="商店 / 餐厅名称"
          />

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
        </View>

        {/* All currencies */}
        <View style={s.card}>
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
        </View>

        {/* Category */}
        <View style={s.card}>
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
        </View>

        {/* Notes */}
        <View style={s.card}>
          <Text style={Typography.label}>备注</Text>
          <TextInput
            style={[s.input, s.notesInput, { marginTop: 8 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="添加备注（可选）"
            placeholderTextColor={Colors.textTertiary}
            multiline
          />
        </View>

        {/* Actions */}
        <TouchableOpacity
          style={[s.primaryBtn, saving && s.btnDisabled]}
          onPress={() => handleSave(false)}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={Colors.textInverse} />
            : <Text style={s.primaryBtnText}>保存并完成</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.draftBtn, saving && s.btnDisabled]}
          onPress={() => handleSave(true)}
          disabled={saving}
        >
          <Text style={s.draftBtnText}>保存草稿</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} disabled={saving}>
          <Text style={s.deleteBtnText}>删除收据</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── FormField ────────────────────────────────────────────────────────────────

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.background },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: 48, gap: Spacing.sm },

  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF8E7',
    borderRadius: Radius.md,
    borderLeftWidth: 3,
    borderLeftColor: '#F39C12',
    padding: Spacing.md,
  },
  draftBannerIcon: { fontSize: 18 },
  draftBannerText: { flex: 1, fontSize: 13, color: '#92400E', fontWeight: '500', lineHeight: 18 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadows.sm,
  },

  imageWrap: { marginTop: 10, borderRadius: Radius.sm, overflow: 'hidden' },
  receiptImage: { width: '100%', height: 200, resizeMode: 'cover' },
  imageChangeBtn: {
    marginTop: 8, paddingVertical: 10,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', backgroundColor: Colors.surfaceSecondary,
  },
  imageChangeBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  imagePlaceholder: {
    marginTop: 10, paddingVertical: 28, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center', gap: 8, backgroundColor: Colors.surfaceSecondary,
  },
  imagePlaceholderIcon: { fontSize: 28 },
  imagePlaceholderText: { fontSize: 13, color: Colors.textTertiary, fontWeight: '500' },

  row: { flexDirection: 'row', alignItems: 'flex-start' },

  input: {
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  inputError: { borderColor: '#EF4444', backgroundColor: '#FFF5F5' },
  fieldErrorTag: {
    fontSize: 10, fontWeight: '700', color: '#EF4444',
    backgroundColor: '#FEE2E2', paddingHorizontal: 6,
    paddingVertical: 2, borderRadius: 4,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },

  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, marginRight: 6, backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, gap: 4,
  },
  categoryChipActive: { backgroundColor: '#F0F0F0', borderColor: Colors.black },
  categoryIcon: { fontSize: 14 },
  categoryText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500', textTransform: 'capitalize' },
  categoryTextActive: { color: Colors.black, fontWeight: '600' },

  primaryBtn: {
    backgroundColor: Colors.black,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    ...Shadows.md,
  },
  primaryBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },

  draftBtn: {
    borderWidth: 1.5,
    borderColor: Colors.black,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  draftBtnText: { color: Colors.black, fontSize: 15, fontWeight: '600' },

  deleteBtn: {
    marginTop: 4, paddingVertical: 14,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.danger, alignItems: 'center',
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 15 },
});
