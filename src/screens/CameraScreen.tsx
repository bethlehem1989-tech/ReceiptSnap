import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COMMON_CURRENCIES, RECEIPT_CATEGORIES } from '../constants';
import { CATEGORY_ICONS, CATEGORY_LABELS, CURRENCY_LABELS } from '../constants/i18n';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
import { convertToCny, convertToUsd } from '../services/currency';
import { extractReceiptData } from '../services/ocr';
import { createReceipt, uploadReceiptImage } from '../services/receipts';
import { supabase } from '../services/supabase';
import { OcrResult, ReceiptCategory } from '../types';
import { classifyReceiptCategory } from '../utils/classifyReceipt';
import { preprocessReceiptImage } from '../utils/imagePreprocessing';

type Stage = 'idle' | 'camera' | 'ocr' | 'form' | 'saving';

/** Convert any caught value to a readable string — avoids "[object Object]" */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return JSON.stringify(err);
}

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);

  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [category, setCategory] = useState<ReceiptCategory>('other');
  const [notes, setNotes] = useState('');
  const [paymentImageUri, setPaymentImageUri] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] = useState<number | null>(null);
  const [amountCny, setAmountCny] = useState<number | null>(null);

  // ── Zoom (pinch-to-zoom) ────────────────────────────────────────────────
  const [zoom, setZoom] = useState(0);
  const zoomRef  = useRef(0);   // ref so PanResponder closure always reads latest
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
        // Sensitivity 0.4 feels natural: one full open-to-close pinch ≈ +0.4 zoom
        const next = Math.max(0, Math.min(1, pinchRef.current.startZoom + (ratio - 1) * 0.4));
        zoomRef.current = next;
        setZoom(next);
      },
    }),
  ).current;

  const cancelOcrRef = useRef(false);
  const [proofMatchStatus, setProofMatchStatus] = useState<'checking' | 'matched' | 'mismatch' | null>(null);
  const [proofMatchDetail, setProofMatchDetail] = useState('');
  // Store the payment proof's OCR'd amount/currency so they can be saved in the DB
  const [proofOcrAmount, setProofOcrAmount] = useState<number | null>(null);
  const [proofOcrCurrency, setProofOcrCurrency] = useState<string | null>(null);
  // Set to true on first save attempt — triggers red-border on empty required fields
  const [saveTried, setSaveTried] = useState(false);

  async function handleCapture() {
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
    if (!photo) return;
    // Preprocess once here — shrinks the original 5-10 MB photo to ~400 KB.
    // The same compressed URI is reused for OCR and local storage,
    // eliminating the large base64 operations that caused the RangeError.
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
      if (cancelOcrRef.current) { setStage('idle'); return; }
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
    } catch {
      if (!cancelOcrRef.current) {
        Alert.alert('识别失败', '无法自动读取收据，请手动填写。');
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
        // Store proof OCR data so it can be persisted when the receipt is saved
        setProofOcrAmount(proofOcr.amount);
        setProofOcrCurrency(proofOcr.currency);

        const receiptAmt = parseFloat(amount);
        // Compare in CNY — consistent with the app's display currency
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
    // Could not determine match
    setProofMatchStatus(null);
    setProofMatchDetail('');
  }

  /** Enter camera mode — request permission first if not yet granted */
  async function handleStartCamera() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setStage('camera');
  }

  /** Skip OCR entirely — go straight to a blank form for manual data entry */
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

  async function handleSave(asDraft = false) {
    // ── Form validation — skipped for draft saves ─────────────────────────
    setSaveTried(true);
    if (!asDraft) {
      const missing: string[] = [];
      if (!date.trim())                       missing.push('日期');
      if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
                                              missing.push('金额');
      if (missing.length > 0) {
        Alert.alert('请补充必填信息', `以下字段不能为空：\n${missing.join('、')}`);
        return;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('未登录', '请先登录后再保存收据。'); return; }

    setStage('saving');
    try {
      // Use defaults for drafts: today's date if empty, 0 if amount invalid
      const parsedAmount = parseFloat(amount) || 0;
      const saveDate = date.trim() || format(new Date(), 'yyyy-MM-dd');

      // Recompute CNY/USD only when amount is meaningful
      let freshAmountUsd: number | null = null;
      let freshAmountCny: number | null = null;
      if (parsedAmount > 0) {
        [freshAmountUsd, freshAmountCny] = await Promise.all([
          convertToUsd(parsedAmount, currency),
          convertToCny(parsedAmount, currency),
        ]);
      }

      // Upload image if present; empty string for manual entry with no photo
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

        // Convert proof amount to CNY for storage (export transparency)
        if (proofOcrAmount != null && proofOcrCurrency != null) {
          finalProofAmountCny = (await convertToCny(proofOcrAmount, proofOcrCurrency)) ?? undefined;
        }

        // Only prompt mismatch notes for complete saves
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
      handleReset(); // always return to camera after save
    } catch (err) {
      // Keep the form visible so the user can fix issues and retry
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
    setStage('idle');
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

  // ── OCR loading ─────────────────────────────────────────────────────────
  if (stage === 'ocr') {
    return (
      <View style={s.ocrScreen}>
        <View style={s.ocrCard}>
          {imageUri && <Image source={{ uri: imageUri }} style={s.ocrPreview} blurRadius={1} />}
          <View style={s.ocrOverlay}>
            <ActivityIndicator size="large" color={Colors.black} />
            <Text style={[Typography.bodyMedium, { marginTop: 12, color: Colors.textPrimary }]}>
              AI 正在识别收据...
            </Text>
            <Text style={[Typography.caption, { marginTop: 4 }]}>
              由 Claude Vision 提供支持
            </Text>
          </View>
          <TouchableOpacity
            style={s.ocrCancelBtn}
            onPress={() => { cancelOcrRef.current = true; handleReset(); }}
          >
            <Text style={s.ocrCancelText}>✕ 取消识别</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Review form ─────────────────────────────────────────────────────────
  if (stage === 'form' || stage === 'saving') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={s.formScreen} contentContainerStyle={s.formContent} showsVerticalScrollIndicator={false}>

          {/* Image + OCR badge */}
          <View style={s.imageContainer}>
            {imageUri && <Image source={{ uri: imageUri }} style={s.formImage} />}
            {ocr && ocr.confidence > 0 && (
              <View style={[s.confidenceBadge, { backgroundColor: ocr.confidence > 0.7 ? Colors.success : Colors.warning }]}>
                <Text style={s.confidenceText}>
                  AI 识别 {Math.round(ocr.confidence * 100)}%
                </Text>
              </View>
            )}
          </View>

          {/* Fields */}
          <View style={s.card}>
            <Text style={Typography.label}>基本信息</Text>

            <FormField
              label="日期"
              value={date}
              onChange={setDate}
              placeholder="YYYY-MM-DD"
              hasError={saveTried && !date.trim()}
            />
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
                <Text style={[Typography.label, { marginBottom: 6 }]}>货币</Text>
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
            {/* Live conversion preview */}
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
          </View>

          {/* Full currency picker */}
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

          {/* Payment screenshot */}
          <View style={s.card}>
            <Text style={Typography.label}>付款凭证 <Text style={{ color: Colors.textTertiary, fontWeight: '400' }}>（可选）</Text></Text>
            {paymentImageUri ? (
              <View style={{ marginTop: 10 }}>
                <Image source={{ uri: paymentImageUri }} style={s.paymentThumb} />
                {/* Match result */}
                {proofMatchStatus === 'checking' && (
                  <View style={s.matchResultRow}>
                    <ActivityIndicator size="small" color={Colors.black} />
                    <Text style={s.matchResultText}>正在匹配金额...</Text>
                  </View>
                )}
                {proofMatchStatus === 'matched' && (
                  <View style={[s.matchResultRow, s.matchResultGreen]}>
                    <Text style={s.matchResultIcon}>✓</Text>
                    <Text style={s.matchResultText}>金额匹配 · {proofMatchDetail}</Text>
                  </View>
                )}
                {proofMatchStatus === 'mismatch' && (
                  <View style={[s.matchResultRow, s.matchResultRed]}>
                    <Text style={s.matchResultIcon}>⚠</Text>
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
                  <Text style={s.paymentBtnIcon}>📷</Text>
                  <Text style={s.paymentBtnText}>拍照</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.paymentBtn} onPress={handlePickPaymentFromLibrary}>
                  <Text style={s.paymentBtnIcon}>🖼</Text>
                  <Text style={s.paymentBtnText}>相册</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={[s.primaryBtn, stage === 'saving' && s.btnDisabled]}
            onPress={() => handleSave(false)}
            disabled={stage === 'saving'}
          >
            {stage === 'saving'
              ? <ActivityIndicator color={Colors.textInverse} />
              : <Text style={s.primaryBtnText}>保存收据</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.draftBtn, stage === 'saving' && s.btnDisabled]}
            onPress={() => handleSave(true)}
            disabled={stage === 'saving'}
          >
            <Text style={s.draftBtnText}>保存草稿</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.ghostBtn} onPress={handleReset}>
            <Text style={s.ghostBtnText}>丢弃</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Camera view (entered via 拍照识别 button) ────────────────────────────
  if (stage === 'camera') {
    if (!permission) return <View style={s.container} />;
    if (!permission.granted) {
      return (
        <SafeAreaView style={s.permissionScreen}>
          <View style={s.permissionCard}>
            <Text style={s.permissionIcon}>📷</Text>
            <Text style={[Typography.h2, s.center]}>需要相机权限</Text>
            <Text style={[Typography.body, s.center, { color: Colors.textSecondary, marginTop: 8 }]}>
              ReceiptSnap 需要访问相机来拍摄收据照片
            </Text>
            <TouchableOpacity style={s.primaryBtn} onPress={requestPermission}>
              <Text style={s.primaryBtnText}>允许访问相机</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    const zoomDisplay = (1 + zoom * 4).toFixed(1);
    return (
      <View style={s.container} {...pinchResponder.panHandlers}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={zoom} />

        {/* Top: back button + hint */}
        <SafeAreaView style={s.cameraTop}>
          <TouchableOpacity style={s.cameraBackBtn} onPress={() => setStage('idle')}>
            <Text style={s.cameraBackBtnText}>✕</Text>
          </TouchableOpacity>
          <View style={s.hintPill}>
            <Text style={s.hintText}>将收据放入画面内</Text>
          </View>
          <View style={{ width: 36 }} />
        </SafeAreaView>

        {/* Zoom badge */}
        {zoom > 0.01 && (
          <View style={s.zoomBadge} pointerEvents="none">
            <Text style={s.zoomBadgeText}>{zoomDisplay}×</Text>
          </View>
        )}

        {/* Bottom controls */}
        <SafeAreaView edges={['bottom']} style={s.cameraBottom}>
          <View style={s.cameraBottomRow}>
            <TouchableOpacity style={s.libraryBtn} onPress={handlePickFromLibrary}>
              <Text style={s.libraryIcon}>🖼</Text>
              <Text style={s.libraryText}>相册</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.shutter} onPress={handleCapture} activeOpacity={0.8}>
              <View style={s.shutterRing}>
                <View style={s.shutterInner} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.zoomResetBtn}
              onPress={() => { setZoom(0); zoomRef.current = 0; }}
            >
              <Text style={s.zoomResetText}>
                {zoom > 0.01 ? `${zoomDisplay}×` : '1×'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Landing page (default idle state) ───────────────────────────────────
  return (
    <SafeAreaView style={s.landingScreen}>
      {/* Decorative background blobs */}
      <View style={[s.deco, s.decoTL]} pointerEvents="none" />
      <View style={[s.deco, s.decoBR]} pointerEvents="none" />

      <View style={s.landingContent}>

        {/* Logo + wordmark */}
        <View style={s.landingLogoSection}>
          {/* Viewfinder wrapper + corner brackets */}
          <View style={s.logoViewfinder}>
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
            <View style={s.logoBadge}>
              <Ionicons name="receipt-outline" size={52} color="#fff" />
            </View>
          </View>
          <Text style={s.logoWordmark}>ReceiptSnap</Text>
          <Text style={s.logoTagline}>AI 智能识别 · 轻松管理报销</Text>
        </View>

        {/* Two action buttons */}
        <View style={s.landingBtns}>
          <TouchableOpacity
            style={s.landingPrimaryBtn}
            onPress={handleStartCamera}
            activeOpacity={0.85}
          >
            <Text style={s.landingBtnIcon}>📷</Text>
            <Text style={s.landingPrimaryBtnText}>拍照识别</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.landingSecondaryBtn}
            onPress={handleManualEntry}
            activeOpacity={0.85}
          >
            <Text style={s.landingBtnIcon}>✏</Text>
            <Text style={s.landingSecondaryBtnText}>手动录入</Text>
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
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
  container: { flex: 1, backgroundColor: '#000' },

  // Zoom
  zoomBadge: {
    position: 'absolute', top: '45%', alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, pointerEvents: 'none' as any,
  },
  zoomBadgeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  zoomResetBtn: {
    width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 26,
  },
  zoomResetText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Permission
  permissionScreen: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: Spacing.lg },
  permissionCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', ...Shadows.md },
  permissionIcon: { fontSize: 56, marginBottom: Spacing.md },
  center: { textAlign: 'center' },

  // OCR loading
  ocrScreen: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: Spacing.lg },
  ocrCard: { borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.surface, ...Shadows.lg },
  ocrPreview: { width: '100%', height: 240, resizeMode: 'cover' },
  ocrOverlay: { padding: Spacing.xl, alignItems: 'center' },

  // Form
  formScreen: { flex: 1, backgroundColor: Colors.background },
  formContent: { padding: Spacing.md, paddingBottom: 48, gap: Spacing.sm },
  imageContainer: { position: 'relative', borderRadius: Radius.lg, overflow: 'hidden', ...Shadows.md },
  formImage: { width: '100%', height: 220, resizeMode: 'cover' },
  confidenceBadge: {
    position: 'absolute', top: 10, right: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full,
  },
  confidenceText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadows.sm,
  },
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
  inputError: {
    borderColor: '#EF4444',
    backgroundColor: '#FFF5F5',
  },
  fieldErrorTag: {
    fontSize: 10, fontWeight: '700', color: '#EF4444',
    backgroundColor: '#FEE2E2', paddingHorizontal: 6,
    paddingVertical: 2, borderRadius: 4,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 6,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 4,
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
  ghostBtn: { alignItems: 'center', paddingVertical: 14 },
  ghostBtnText: { color: Colors.danger, fontSize: 15, fontWeight: '500' },

  // Landing page
  landingScreen: { flex: 1, backgroundColor: Colors.surface },
  deco: { position: 'absolute', borderRadius: 999, backgroundColor: Colors.black, opacity: 0.04 },
  decoTL: { width: 220, height: 220, top: -70, left: -70 },
  decoBR: { width: 300, height: 300, bottom: -90, right: -90 },
  landingContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  landingLogoSection: { alignItems: 'center', marginBottom: 64 },
  logoViewfinder: {
    width: 110, height: 110,
    marginBottom: 22,
    // overflow: 'visible' is RN default — corners protrude outside without clipping
  },
  logoBadge: {
    width: 110, height: 110, borderRadius: 28,
    backgroundColor: Colors.black,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22, shadowRadius: 24, elevation: 10,
  },
  corner: {
    position: 'absolute', width: 16, height: 16,
    borderColor: Colors.primary, // #0070BA PayPal blue
  },
  cornerTL: { top: -6, left: -6, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
  cornerTR: { top: -6, right: -6, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
  cornerBL: { bottom: -6, left: -6, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: -6, right: -6, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },
  logoWordmark: {
    fontSize: 34, fontWeight: '800', color: Colors.black,
    letterSpacing: -1.2, marginBottom: 8,
  },
  logoTagline: { fontSize: 14, color: Colors.textTertiary, letterSpacing: 0.2 },
  landingBtns: { width: '100%', gap: 14 },
  landingPrimaryBtn: {
    backgroundColor: Colors.black, borderRadius: Radius.lg,
    paddingVertical: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 6,
  },
  landingPrimaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  landingSecondaryBtn: {
    borderWidth: 2, borderColor: Colors.black, borderRadius: Radius.lg,
    paddingVertical: 17,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  landingSecondaryBtnText: { color: Colors.black, fontSize: 17, fontWeight: '600' },
  landingBtnIcon: { fontSize: 20 },

  // Camera
  cameraTop: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
  },
  cameraBackBtn: {
    width: 36, height: 36,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  cameraBackBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hintPill: {
    flex: 1, marginHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  hintText: { color: '#fff', fontSize: 13, fontWeight: '500' },

  cameraBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,   // 24 — less horizontal crush
    paddingBottom: Spacing.xxl,      // 48 — well above tab bar + home indicator
    paddingTop: Spacing.lg,          // 24 — breathing room at top of controls
    backgroundColor: 'rgba(0,0,0,0.45)',
    gap: 16,                          // more space between shutter row and manual entry
  },
  cameraBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: Spacing.sm,   // slight inset so buttons don't hug edges
  },
  manualEntryBtn: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: Radius.full,
    paddingHorizontal: 32,
    paddingVertical: 13,             // taller tap target (min 44pt with text)
  },
  manualEntryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // min 44×44pt touch target (Apple HIG)
  libraryBtn: { width: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4 },
  libraryIcon: { fontSize: 28 },
  libraryText: { color: '#fff', fontSize: 11, fontWeight: '500' },

  shutter: { alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.8)',
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
  },

  paymentThumb: { width: '100%', height: 160, borderRadius: Radius.sm, resizeMode: 'cover', marginTop: 8 },
  paymentRemove: { marginTop: 8, alignItems: 'center' },
  paymentRemoveText: { color: Colors.danger, fontSize: 13, fontWeight: '500' },
  paymentBtnRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  paymentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
    borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radius.sm, backgroundColor: Colors.surfaceSecondary,
  },
  paymentBtnIcon: { fontSize: 18 },
  paymentBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  conversionRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  conversionBadge: {
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full,
  },
  conversionText: { fontSize: 12, fontWeight: '600', color: Colors.black },

  ocrCancelBtn: {
    marginTop: 0, paddingVertical: 16, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  ocrCancelText: { color: Colors.danger, fontSize: 15, fontWeight: '600' },

  matchResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8, padding: 10, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceSecondary,
  },
  matchResultGreen: { backgroundColor: '#D1FAE5' },
  matchResultRed:   { backgroundColor: '#FEE2E2' },
  matchResultIcon: { fontSize: 16, fontWeight: '700' },
  matchResultText: { flex: 1, fontSize: 12, color: Colors.textPrimary, fontWeight: '500' },
});
