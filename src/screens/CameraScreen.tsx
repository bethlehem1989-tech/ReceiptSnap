import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { BlurView } from 'expo-blur';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmbientBackground } from '../components/AmbientBackground';
import { GlassCard } from '../components/GlassCard';
import { COMMON_CURRENCIES, RECEIPT_CATEGORIES } from '../constants';
import { CATEGORY_ICONS, CATEGORY_LABELS, CURRENCY_LABELS } from '../constants/i18n';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { getActiveProvider } from '../services/aiProvider';
import { convertToCny, convertToUsd } from '../services/currency';
import { extractReceiptData } from '../services/ocr';
import {
  createReceipt,
  DuplicateMatch,
  findDuplicateReceipts,
  uploadReceiptImage,
} from '../services/receipts';
import { supabase } from '../services/supabase';
import { OcrResult, ReceiptCategory } from '../types';
import { classifyReceiptCategory } from '../utils/classifyReceipt';
import { preprocessReceiptImage } from '../utils/imagePreprocessing';

type Stage = 'idle' | 'camera' | 'ocr' | 'form' | 'saving';

/** Discrete zoom presets — maps to expo-camera's `zoom` 0..1 logical scale. */
const ZOOM_PRESETS = [
  { label: '1×', value: 0 },
  { label: '2×', value: 0.25 },
  { label: '3×', value: 0.5 },
] as const;

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return JSON.stringify(err);
}

type CameraScreenProps = {
  navigation: { goBack: () => void; navigate: (name: string, params?: any) => void };
  route?: { params?: { manualEntry?: boolean } };
};

export default function CameraScreen({ navigation, route }: CameraScreenProps) {
  const startAtManualEntry = route?.params?.manualEntry === true;
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [stage, setStage] = useState<Stage>(startAtManualEntry ? 'form' : 'camera');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [providerLabel, setProviderLabel] = useState('Qwen VL');

  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [category, setCategory] = useState<ReceiptCategory>('other');
  const [notes, setNotes] = useState('');
  const [paymentImageUri, setPaymentImageUri] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] = useState<number | null>(null);
  const [amountCny, setAmountCny] = useState<number | null>(null);

  // ── Zoom (pinch + discrete buttons) ────────────────────────────────────
  const [zoom, setZoom] = useState(0);
  const zoomRef = useRef(0);
  const pinchRef = useRef({ startDist: 0, startZoom: 0 });

  const pinchResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder:  (evt) => evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: (evt) => {
        const t = evt.nativeEvent.touches;
        if (t.length < 2) return;
        const dx = t[0].pageX - t[1].pageX;
        const dy = t[0].pageY - t[1].pageY;
        pinchRef.current = {
          startDist: Math.sqrt(dx * dx + dy * dy),
          startZoom: zoomRef.current,
        };
      },
      onPanResponderMove: (evt) => {
        const t = evt.nativeEvent.touches;
        if (t.length < 2) return;
        const dx = t[0].pageX - t[1].pageX;
        const dy = t[0].pageY - t[1].pageY;
        const dist  = Math.sqrt(dx * dx + dy * dy);
        const ratio = dist / (pinchRef.current.startDist || 1);
        const next = Math.max(0, Math.min(1, pinchRef.current.startZoom + (ratio - 1) * 0.4));
        zoomRef.current = next;
        setZoom(next);
      },
    }),
  ).current;

  const cancelOcrRef = useRef(false);
  const [proofMatchStatus, setProofMatchStatus] = useState<'checking' | 'matched' | 'mismatch' | null>(null);
  const [proofMatchDetail, setProofMatchDetail] = useState('');
  const [proofOcrAmount, setProofOcrAmount] = useState<number | null>(null);
  const [proofOcrCurrency, setProofOcrCurrency] = useState<string | null>(null);
  const [saveTried, setSaveTried] = useState(false);

  // Track which provider is in use, just for the "AI 正在识别" attribution
  React.useEffect(() => {
    getActiveProvider().then((p) => setProviderLabel(p.info.shortName));
  }, [stage]);

  function setZoomPreset(value: number) {
    zoomRef.current = value;
    setZoom(value);
  }

  async function handleCapture() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
    if (!photo) return;
    const processedUri = await preprocessReceiptImage(photo.uri);
    setImageUri(processedUri);
    await runOcr(processedUri);
  }

  async function handlePickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const processedUri = await preprocessReceiptImage(result.assets[0].uri);
    setImageUri(processedUri);
    await runOcr(processedUri);
  }

  async function runOcr(uri: string) {
    cancelOcrRef.current = false;
    setStage('ocr');
    try {
      const result = await extractReceiptData(uri, true);
      if (cancelOcrRef.current) { navigation.goBack(); return; }
      setOcr(result);
      setDate(result.date ?? '');
      setDescription(result.description ?? '');
      setAmount(result.amount?.toString() ?? '');
      setCurrency(result.currency ?? 'USD');
      setCategory(classifyReceiptCategory(result.description ?? '', result.rawText ?? ''));
      if (result.amount && result.currency) {
        convertToUsd(result.amount, result.currency).then(setAmountUsd);
        convertToCny(result.amount, result.currency).then(setAmountCny);
      }
    } catch (err) {
      // Silent fall-through to manual form — never block the user. The OCR
      // raw text (if any) is preserved so they don't lose anything.
      if (!cancelOcrRef.current) {
        // Show a non-blocking toast-style alert with the actual error so
        // a missing/invalid API key doesn't fail silently.
        Alert.alert('识别未完成', `${errMsg(err)}\n\n已切换到手动录入。`);
      }
    } finally {
      if (!cancelOcrRef.current) setStage('form');
    }
  }

  async function runProofMatching(proofUri: string) {
    setProofMatchStatus('checking');
    setProofOcrAmount(null);
    setProofOcrCurrency(null);
    try {
      const proofOcr = await extractReceiptData(proofUri, false);
      if (proofOcr.amount && proofOcr.currency) {
        setProofOcrAmount(proofOcr.amount);
        setProofOcrCurrency(proofOcr.currency);

        const receiptAmt = parseFloat(amount);
        const [receiptCny, proofCny] = await Promise.all([
          convertToCny(receiptAmt, currency),
          convertToCny(proofOcr.amount, proofOcr.currency),
        ]);
        if (receiptCny != null && proofCny != null && receiptCny > 0) {
          const diffPct = Math.abs(receiptCny - proofCny) / receiptCny;
          const status = diffPct <= 0.08 ? 'matched' : 'mismatch';
          setProofMatchStatus(status);
          setProofMatchDetail(
            `收据 ≈ ¥${receiptCny.toFixed(2)}  凭证 ≈ ¥${proofCny.toFixed(2)}  差异 ${(diffPct * 100).toFixed(1)}%`
          );
          return;
        }
      }
    } catch { /* OCR unavailable */ }
    setProofMatchStatus(null);
    setProofMatchDetail('');
  }

  async function handleStartCamera() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setStage('camera');
  }

  function handleManualEntry() {
    setImageUri(null);
    setOcr(null);
    setDate(''); setDescription(''); setAmount('');
    setCurrency('USD'); setCategory('other'); setNotes('');
    setPaymentImageUri(null); setAmountUsd(null); setAmountCny(null);
    setProofMatchStatus(null); setProofMatchDetail('');
    setProofOcrAmount(null); setProofOcrCurrency(null);
    setZoom(0); zoomRef.current = 0;
    setSaveTried(false);
    setStage('form');
  }

  /** Returns true if the user agreed to save anyway / no duplicates were found. */
  async function checkForDuplicates(userId: string): Promise<boolean> {
    const parsed = parseFloat(amount);
    if (!date.trim() || !(parsed > 0)) return true;

    let dupes: DuplicateMatch[] = [];
    try {
      dupes = await findDuplicateReceipts(userId, {
        date: date.trim(),
        amount: parsed,
        currency,
        description: description.trim() || undefined,
        category,
      });
    } catch { return true; /* network problem — don't block save */ }

    if (dupes.length === 0) return true;

    return new Promise<boolean>((resolve) => {
      const top = dupes[0];
      const summary =
        `已存在 ${dupes.length} 张相似收据。最相近的一张：\n` +
        `· ${top.receipt.date} · ${top.receipt.description || '未命名'} · ${top.receipt.amount} ${top.receipt.currency}\n` +
        `· 相似原因：${top.reason}`;
      Alert.alert(
        '⚠️ 可能是重复收据',
        summary,
        [
          { text: '继续保存', onPress: () => resolve(true) },
          { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  async function handleSave(asDraft = false) {
    // v1.2 #7: hard debounce — block re-entry even before stage flips to 'saving'.
    // The button is also visually disabled, but a rapid double-tap can squeeze
    // a second invocation through before React commits the next render.
    if (stage === 'saving') return;
    setSaveTried(true);
    if (!asDraft) {
      const missing: string[] = [];
      if (!date.trim()) missing.push('日期');
      // v1.2 #18: merchant required for a complete (non-draft) receipt
      if (!description.trim()) missing.push('商户名称');
      if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
        missing.push('金额');
      if (missing.length > 0) {
        Alert.alert('请补充必填信息', `以下字段不能为空：\n${missing.join('、')}`);
        return;
      }
    } else {
      // v1.2 #5: even drafts must have at least one filled field
      const hasAny = date.trim() || description.trim() || amount.trim();
      if (!hasAny) {
        Alert.alert('草稿至少填一项', '日期、商户、金额至少要填一个再保存草稿。');
        return;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('未登录', '请先登录后再保存收据。'); return; }

    // Duplicate check (skipped for drafts since they're often incomplete)
    if (!asDraft) {
      const proceed = await checkForDuplicates(user.id);
      if (!proceed) return;
    }

    setStage('saving');
    try {
      const parsedAmount = parseFloat(amount) || 0;
      const saveDate = date.trim() || format(new Date(), 'yyyy-MM-dd');

      let freshAmountUsd: number | null = null;
      let freshAmountCny: number | null = null;
      if (parsedAmount > 0) {
        [freshAmountUsd, freshAmountCny] = await Promise.all([
          convertToUsd(parsedAmount, currency),
          convertToCny(parsedAmount, currency),
        ]);
      }

      const imageUrl = imageUri ? await uploadReceiptImage(imageUri, user.id) : '';

      let paymentUrl: string | undefined;
      let finalMatchStatus: 'matched' | 'mismatch' | undefined;
      let finalNotes = notes;
      let finalProofAmountCny: number | undefined;

      if (paymentImageUri) {
        paymentUrl = await uploadReceiptImage(paymentImageUri, user.id);
        if (proofMatchStatus === 'matched' || proofMatchStatus === 'mismatch') {
          finalMatchStatus = proofMatchStatus;
        }
        if (proofOcrAmount != null && proofOcrCurrency != null) {
          finalProofAmountCny = (await convertToCny(proofOcrAmount, proofOcrCurrency)) ?? undefined;
        }
        if (finalMatchStatus === 'mismatch' && !asDraft) {
          await new Promise<void>((resolve) => {
            Alert.alert(
              '⚠️ 金额不匹配',
              `${proofMatchDetail}\n\n是否需要填写备注向财务解释？`,
              [
                { text: '跳过', style: 'cancel', onPress: () => resolve() },
                {
                  text: '填写备注',
                  onPress: () => {
                    Alert.prompt(
                      '填写备注',
                      '请简要说明金额差异原因',
                      (text) => { if (text) finalNotes = text; resolve(); },
                      'plain-text',
                      notes,
                    );
                  },
                },
              ],
            );
          });
        }
      }

      await createReceipt({
        user_id: user.id,
        image_url: imageUrl,
        payment_image_url: paymentUrl,
        payment_match_status: finalMatchStatus,
        payment_amount: proofOcrAmount ?? undefined,
        payment_currency: proofOcrCurrency ?? undefined,
        payment_amount_cny: finalProofAmountCny,
        date: saveDate,
        description,
        amount: parsedAmount,
        currency,
        amount_usd: freshAmountUsd ?? undefined,
        amount_cny: freshAmountCny ?? undefined,
        category,
        notes: finalNotes,
        ocr_raw: ocr?.rawText,
        ocr_confidence: ocr?.confidence,
        is_draft: asDraft,
      });

      Alert.alert(
        asDraft ? '📋 草稿已保存' : '✅ 保存成功',
        asDraft ? '草稿已保存，可在列表中继续编辑。' : '收据已保存。',
      );
      handleReset();
    } catch (err) {
      setStage('form');
      Alert.alert('保存失败', errMsg(err));
    }
  }

  async function handlePickPaymentFromCamera() {
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setPaymentImageUri(uri);
    if (amount) runProofMatching(uri);
  }

  async function handlePickPaymentFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setPaymentImageUri(uri);
    if (amount) runProofMatching(uri);
  }

  function handleReset() {
    // After save / discard from the camera flow, drop back to HomeScreen.
    navigation.goBack();
    setImageUri(null);
    setOcr(null);
    setDate(''); setDescription(''); setAmount('');
    setCurrency('USD'); setCategory('other'); setNotes('');
    setPaymentImageUri(null); setAmountUsd(null); setAmountCny(null);
    setProofMatchStatus(null); setProofMatchDetail('');
    setProofOcrAmount(null); setProofOcrCurrency(null);
    setZoom(0); zoomRef.current = 0;
    setSaveTried(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OCR loading
  // ─────────────────────────────────────────────────────────────────────────
  if (stage === 'ocr') {
    return (
      <AmbientBackground>
        <SafeAreaView style={s.ocrScreen}>
          <GlassCard preset="thick" radius={Radius.xl} shadow="hero" style={{ marginHorizontal: Spacing.md }} contentStyle={{ overflow: 'hidden' }}>
            {imageUri && (
              <Image source={{ uri: imageUri }} style={s.ocrPreview} blurRadius={2} />
            )}
            <View style={s.ocrOverlay}>
              <ActivityIndicator size="large" color={Colors.textPrimary} />
              <Text style={[Typography.bodyMedium, { marginTop: 12, color: Colors.textPrimary }]}>
                AI 正在识别收据…
              </Text>
              <Text style={[Typography.caption, { marginTop: 4 }]}>
                由 {providerLabel} 提供识别
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.ocrCancelBtn, pressed && { opacity: 0.55 }]}
              onPress={() => { cancelOcrRef.current = true; handleReset(); }}
            >
              <Text style={s.ocrCancelText}>✕ 取消识别</Text>
            </Pressable>
          </GlassCard>
        </SafeAreaView>
      </AmbientBackground>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Review form
  // ─────────────────────────────────────────────────────────────────────────
  if (stage === 'form' || stage === 'saving') {
    return (
      <AmbientBackground>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <ScrollView contentContainerStyle={s.formContent} showsVerticalScrollIndicator={false}>

              {imageUri && (
                <View style={s.imageContainer}>
                  <Image source={{ uri: imageUri }} style={s.formImage} />
                  {ocr && ocr.confidence > 0 && (
                    <View style={[s.confidenceBadge, { backgroundColor: ocr.confidence > 0.7 ? Colors.success : Colors.warning }]}>
                      <Text style={s.confidenceText}>
                        AI 识别 {Math.round(ocr.confidence * 100)}%
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <GlassCard preset="regular" contentStyle={s.cardContent}>
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

                {(amountUsd != null || amountCny != null) && (
                  <View style={s.conversionRow}>
                    {amountUsd != null && (
                      <View style={s.conversionBadge}>
                        <Text style={s.conversionText}>≈ ${amountUsd.toFixed(2)} USD</Text>
                      </View>
                    )}
                    {amountCny != null && (
                      <View style={s.conversionBadge}>
                        <Text style={s.conversionText}>≈ ¥{amountCny.toFixed(2)} CNY</Text>
                      </View>
                    )}
                  </View>
                )}
              </GlassCard>

              <GlassCard preset="regular" contentStyle={s.cardContent}>
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

              <GlassCard preset="regular" contentStyle={s.cardContent}>
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

              <GlassCard preset="regular" contentStyle={s.cardContent}>
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

              <GlassCard preset="regular" contentStyle={s.cardContent}>
                <Text style={Typography.label}>付款凭证 <Text style={{ color: Colors.textTertiary, fontWeight: '400' }}>（可选）</Text></Text>
                {paymentImageUri ? (
                  <View style={{ marginTop: 10 }}>
                    <Image source={{ uri: paymentImageUri }} style={s.paymentThumb} />
                    {proofMatchStatus === 'checking' && (
                      <View style={s.matchResultRow}>
                        <ActivityIndicator size="small" color={Colors.textPrimary} />
                        <Text style={s.matchResultText}>正在匹配金额...</Text>
                      </View>
                    )}
                    {proofMatchStatus === 'matched' && (
                      <View style={[s.matchResultRow, s.matchResultGreen]}>
                        <Ionicons name="checkmark-circle" size={16} color="#0F766E" />
                        <Text style={s.matchResultText}>金额匹配 · {proofMatchDetail}</Text>
                      </View>
                    )}
                    {proofMatchStatus === 'mismatch' && (
                      <View style={[s.matchResultRow, s.matchResultRed]}>
                        <Ionicons name="alert-circle" size={16} color="#B91C1C" />
                        <Text style={s.matchResultText}>金额不符 · {proofMatchDetail}</Text>
                      </View>
                    )}
                    <TouchableOpacity onPress={() => setPaymentImageUri(null)} style={s.paymentRemove}>
                      <Text style={s.paymentRemoveText}>✕ 移除凭证</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={s.paymentBtnRow}>
                    <TouchableOpacity style={s.paymentBtn} onPress={handlePickPaymentFromCamera}>
                      <Ionicons name="camera-outline" size={18} color={Colors.textPrimary} />
                      <Text style={s.paymentBtnText}>拍照</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.paymentBtn} onPress={handlePickPaymentFromLibrary}>
                      <Ionicons name="image-outline" size={18} color={Colors.textPrimary} />
                      <Text style={s.paymentBtnText}>相册</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </GlassCard>

              <Pressable
                style={({ pressed }) => [s.primaryBtn, stage === 'saving' && s.btnDisabled, pressed && { opacity: 0.85 }]}
                onPress={() => handleSave(false)}
                disabled={stage === 'saving'}
              >
                {stage === 'saving'
                  ? <ActivityIndicator color={Colors.textInverse} />
                  : <Text style={s.primaryBtnText}>保存收据</Text>}
              </Pressable>

              <Pressable
                style={({ pressed }) => [s.draftBtn, stage === 'saving' && s.btnDisabled, pressed && { opacity: 0.7 }]}
                onPress={() => handleSave(true)}
                disabled={stage === 'saving'}
              >
                <Text style={s.draftBtnText}>保存草稿</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [s.ghostBtn, pressed && { opacity: 0.5 }]}
                onPress={handleReset}
              >
                <Text style={s.ghostBtnText}>丢弃</Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </AmbientBackground>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Camera viewfinder
  // ─────────────────────────────────────────────────────────────────────────
  if (stage === 'camera') {
    if (!permission) return <View style={s.container} />;
    if (!permission.granted) {
      return (
        <AmbientBackground>
          <SafeAreaView style={s.permissionScreen}>
            <GlassCard preset="thick" shadow="lg" contentStyle={s.permissionCard}>
              <Ionicons name="camera-outline" size={56} color={Colors.textPrimary} />
              <Text style={[Typography.h2, s.center, { marginTop: 12 }]}>需要相机权限</Text>
              <Text style={[Typography.body, s.center, { color: Colors.textSecondary, marginTop: 8 }]}>
                ReceiptSnap 需要访问相机来拍摄收据照片
              </Text>
              <Pressable
                style={({ pressed }) => [s.primaryBtn, { marginTop: 20 }, pressed && { opacity: 0.85 }]}
                onPress={requestPermission}
              >
                <Text style={s.primaryBtnText}>允许访问相机</Text>
              </Pressable>
            </GlassCard>
          </SafeAreaView>
        </AmbientBackground>
      );
    }

    const zoomDisplay = (1 + zoom * 4).toFixed(1);
    const activePreset = ZOOM_PRESETS.findIndex((p) => Math.abs(p.value - zoom) < 0.02);

    return (
      <View style={s.container} {...pinchResponder.panHandlers}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={zoom} />

        {/* Top: back + hint */}
        <SafeAreaView style={s.cameraTop}>
          <Pressable style={({ pressed }) => [s.cameraBackBtn, pressed && { opacity: 0.7 }]} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>
          <View style={s.hintPill}>
            <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
            <Text style={s.hintText}>将收据放入画面内</Text>
            <Text style={s.hintSubText}>横版发票请保持手机竖向，让发票横躺入画</Text>
          </View>
          <View style={{ width: 40 }} />
        </SafeAreaView>

        {/* Zoom badge (mid-screen during pinch) */}
        {zoom > 0.01 && activePreset === -1 && (
          <View style={s.zoomBadge} pointerEvents="none">
            <Text style={s.zoomBadgeText}>{zoomDisplay}×</Text>
          </View>
        )}

        {/* Bottom: zoom presets + shutter row */}
        <SafeAreaView edges={['bottom']} style={s.cameraBottom}>
          {/* Zoom preset capsule */}
          <View style={s.zoomCapsuleWrap}>
            <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={s.zoomCapsuleRow}>
              {ZOOM_PRESETS.map((p, i) => {
                const isActive = i === activePreset;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => setZoomPreset(p.value)}
                    style={({ pressed }) => [
                      s.zoomPresetBtn,
                      isActive && s.zoomPresetBtnActive,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[s.zoomPresetText, isActive && s.zoomPresetTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={s.cameraBottomRow}>
            <Pressable style={({ pressed }) => [s.libraryBtn, pressed && { opacity: 0.7 }]} onPress={handlePickFromLibrary}>
              <Ionicons name="image-outline" size={28} color="#FFFFFF" />
              <Text style={s.libraryText}>相册</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [s.shutter, pressed && { opacity: 0.85 }]} onPress={handleCapture}>
              <View style={s.shutterRing}>
                <View style={s.shutterInner} />
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [s.zoomResetBtn, pressed && { opacity: 0.7 }]}
              onPress={() => setZoomPreset(0)}
            >
              <Text style={s.zoomResetText}>{zoom > 0.01 ? `${zoomDisplay}×` : '1×'}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // The landing UI now lives in HomeScreen — this screen is opened explicitly
  // from there and starts in 'camera' or 'form' stage. If we ever land here
  // with no matching stage we just bail back to home.
  return null;
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
  container: { flex: 1, backgroundColor: '#000' },

  // ── Permission card ────────────────────────────────────────────────────
  permissionScreen: { flex: 1, justifyContent: 'center', padding: Spacing.lg },
  permissionCard: { padding: Spacing.xl, alignItems: 'center' },
  center: { textAlign: 'center' },

  // ── OCR loading ────────────────────────────────────────────────────────
  ocrScreen: { flex: 1, justifyContent: 'center' },
  ocrPreview: { width: '100%', height: 240 },
  ocrOverlay: { padding: Spacing.xl, alignItems: 'center' },
  ocrCancelBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.hairline,
  },
  ocrCancelText: { color: Colors.danger, fontSize: 15, fontWeight: '600' },

  // ── Form screen ────────────────────────────────────────────────────────
  formContent: {
    padding: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: 140,
    gap: Spacing.sm,
  },
  imageContainer: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
  },
  formImage: { width: '100%', height: 220, resizeMode: 'cover' },
  confidenceBadge: {
    position: 'absolute',
    top: 10, right: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full,
  },
  confidenceText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  cardContent: { padding: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start' },

  input: {
    backgroundColor: Colors.surfaceTertiary,
    borderWidth: StyleSheet.hairlineWidth,
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
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginRight: 6,
    backgroundColor: Colors.surfaceTertiary,
  },
  chipActive: { backgroundColor: Colors.textPrimary, borderColor: Colors.textPrimary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceTertiary,
    gap: 4,
  },
  categoryChipActive: {
    backgroundColor: Colors.accentLight,
    borderColor: Colors.accent,
  },
  categoryIcon: { fontSize: 14 },
  categoryText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  categoryTextActive: { color: Colors.accent, fontWeight: '700' },

  conversionRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  conversionBadge: {
    backgroundColor: Colors.surfaceTertiary,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  conversionText: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },

  primaryBtn: {
    backgroundColor: Colors.textPrimary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: Spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
  },
  primaryBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  draftBtn: {
    borderWidth: 1.5,
    borderColor: Colors.textPrimary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  draftBtnText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  ghostBtn: { alignItems: 'center', paddingVertical: 14 },
  ghostBtnText: { color: Colors.danger, fontSize: 15, fontWeight: '500' },

  // ── Payment thumb / match results ──────────────────────────────────────
  paymentThumb: { width: '100%', height: 160, borderRadius: Radius.sm, resizeMode: 'cover', marginTop: 8 },
  paymentRemove: { marginTop: 8, alignItems: 'center' },
  paymentRemoveText: { color: Colors.danger, fontSize: 13, fontWeight: '500' },
  paymentBtnRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  paymentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
    borderRadius: Radius.sm, backgroundColor: Colors.surfaceTertiary,
  },
  paymentBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  matchResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8, padding: 10, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceTertiary,
  },
  matchResultGreen: { backgroundColor: Colors.successLight, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(52, 199, 89, 0.40)' },
  matchResultRed:   { backgroundColor: Colors.dangerLight, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 69, 58, 0.40)' },
  matchResultText: { flex: 1, fontSize: 12, color: Colors.textPrimary, fontWeight: '500' },

  // ── Landing page ───────────────────────────────────────────────────────
  landingScreen: { flex: 1 },
  landingContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  landingLogoSection: { alignItems: 'center', marginBottom: 64 },
  logoViewfinder: { width: 124, height: 124, marginBottom: 24 },
  logoBadge: {
    width: 124, height: 124, borderRadius: 32,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22, shadowRadius: 30,
  },
  corner: {
    position: 'absolute', width: 18, height: 18,
    borderColor: Colors.accent,
  },
  cornerTL: { top: -8, left: -8, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  cornerTR: { top: -8, right: -8, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  cornerBL: { bottom: -8, left: -8, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: -8, right: -8, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  logoWordmark: {
    fontSize: 36, fontWeight: '800', color: Colors.textPrimary,
    letterSpacing: -1.4, marginBottom: 8,
  },
  logoTagline: { fontSize: 14, color: Colors.textTertiary, letterSpacing: 0.2 },
  landingBtns: { width: '100%', gap: 14 },
  landingPrimaryBtn: {
    backgroundColor: Colors.textPrimary, borderRadius: Radius.lg,
    paddingVertical: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 18,
  },
  landingPrimaryBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  landingSecondaryBtn: {
    borderWidth: 1.5, borderColor: Colors.textPrimary, borderRadius: Radius.lg,
    paddingVertical: 17,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
  },
  landingSecondaryBtnText: { color: Colors.textPrimary, fontSize: 17, fontWeight: '600' },

  // ── Camera viewfinder ──────────────────────────────────────────────────
  cameraTop: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
  },
  cameraBackBtn: {
    width: 40, height: 40,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  hintPill: {
    flex: 1, marginHorizontal: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  hintText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500', textAlign: 'center' },
  hintSubText: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '400', textAlign: 'center', marginTop: 2 },

  zoomBadge: {
    position: 'absolute', top: '45%', alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  zoomBadgeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  cameraBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    paddingTop: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
    gap: 16,
  },
  cameraBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: Spacing.sm,
  },
  zoomCapsuleWrap: {
    borderRadius: Radius.full,
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(20,20,24,0.55)',
  },
  zoomCapsuleRow: { flexDirection: 'row', padding: 4, gap: 4 },
  zoomPresetBtn: {
    minWidth: 50, paddingVertical: 7, paddingHorizontal: 14,
    borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  zoomPresetBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  zoomPresetText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
  zoomPresetTextActive: { color: '#0A0A0F' },

  libraryBtn: { width: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4 },
  libraryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '500' },

  shutter: { alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)',
    padding: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFFFFF' },

  zoomResetBtn: {
    width: 52, height: 52,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 26,
  },
  zoomResetText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
