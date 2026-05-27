import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AmbientBackground } from '../components/AmbientBackground';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
import { exportReceiptsToExcel } from '../services/export';
import { exportReceiptsToPdf } from '../services/exportPdf';
import { getReceiptsForExport } from '../services/receipts';
import { convertToCny } from '../services/currency';
import { supabase } from '../services/supabase';
import { ExportOptions } from '../types';

type Format = 'pdf' | 'csv';

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return JSON.stringify(err);
}

export default function ExportScreen({ navigation }: any) {
  // Default to current month — user can adjust via the date pickers
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState<Date>(monthStart);
  const [endDate, setEndDate] = useState<Date>(today);
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);

  const [format_, setFormat] = useState<Format>('pdf');
  const [exporting, setExporting] = useState(false);

  // Live preview
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewCurrencies, setPreviewCurrencies] = useState<string[]>([]);

  // v1.2 #19 #20 #21: preview must match what export emits (no drafts, no mismatches)
  //                   and refresh whenever this tab regains focus
  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      setPreviewLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const receipts = await getReceiptsForExport(
          user.id,
          format(startDate, 'yyyy-MM-dd'),
          format(endDate, 'yyyy-MM-dd'),
        );
        if (cancelled) return;

        // Accumulate CNY totals + per-currency CNY for sorting
        let totalCny = 0;
        const byCurrencyCny: Record<string, number> = {};
        for (const r of receipts) {
          try {
            const cny = await convertToCny(r.amount, r.currency);
            const value = cny ?? r.amount; // convertToCny may resolve null
            totalCny += value;
            byCurrencyCny[r.currency] = (byCurrencyCny[r.currency] ?? 0) + value;
          } catch {
            // Fall back to raw amount if conversion fails
            byCurrencyCny[r.currency] = (byCurrencyCny[r.currency] ?? 0) + r.amount;
            totalCny += r.amount;
          }
        }
        if (cancelled) return;

        setPreviewCount(receipts.length);
        setPreviewTotal(totalCny);
        setPreviewCurrencies(
          Object.keys(byCurrencyCny).sort(
            (a, b) => (byCurrencyCny[b] ?? 0) - (byCurrencyCny[a] ?? 0),
          ),
        );
      } catch {
        // Best-effort preview
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }
    loadPreview();

    // v1.2 #19 #20: re-run preview every time the tab regains focus
    const unsub = navigation.addListener?.('focus', loadPreview);
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [startDate, endDate, navigation]);

  async function handleGenerate() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('未登录', '请先登录后再导出。'); return; }
    if (previewCount === 0) {
      Alert.alert('该范围内没有票据', '换一个时间范围再试试。');
      return;
    }
    setExporting(true);
    try {
      const options: ExportOptions = {
        startDate,
        endDate,
        includeImages: true,
        currencies: [],
      };
      if (format_ === 'pdf') await exportReceiptsToPdf(user.id, options);
      else await exportReceiptsToExcel(user.id, options);
    } catch (err) {
      Alert.alert('导出失败', errMsg(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AmbientBackground>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={s.header}>
            <Pressable
              onPress={() => navigation.navigate('首页' as never)}
              style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.5 }]}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={20} color={Colors.textPrimary} />
            </Pressable>
            <Text style={s.headerTitle}>导出报销包</Text>
            <View style={s.headerBtn}>
              <Text style={s.headerHelp}>?</Text>
            </View>
          </View>

          {/* Hero illustration */}
          <View style={s.hero}>
            <View style={s.heroStamp}>
              <Text style={s.heroStampText}>BUSINESS{'\n'}TRIP</Text>
            </View>
            <View style={s.heroIcons}>
              <Ionicons name="document-text" size={42} color="rgba(45, 60, 50, 0.45)" />
              <Ionicons name="airplane" size={38} color="rgba(45, 60, 50, 0.40)" style={{ marginLeft: -8 }} />
              <Ionicons name="briefcase" size={40} color={Colors.accent} style={{ marginLeft: -6 }} />
            </View>
          </View>

          {/* Step 1: date range */}
          <Text style={s.stepLabel}>1. 选择时间范围</Text>
          <View style={s.dateRow}>
            <Pressable
              onPress={() => setPickerTarget('start')}
              style={({ pressed }) => [s.datePick, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.dateValue}>{format(startDate, 'yyyy.MM.dd')}</Text>
              <Ionicons name="calendar-outline" size={14} color={Colors.textTertiary} />
            </Pressable>
            <Text style={s.dateSep}>至</Text>
            <Pressable
              onPress={() => setPickerTarget('end')}
              style={({ pressed }) => [s.datePick, pressed && { opacity: 0.7 }]}
            >
              <Text style={s.dateValue}>{format(endDate, 'yyyy.MM.dd')}</Text>
              <Ionicons name="calendar-outline" size={14} color={Colors.textTertiary} />
            </Pressable>
          </View>

          {/* Step 2: format */}
          <Text style={s.stepLabel}>2. 选择导出格式</Text>
          <View style={s.formatRow}>
            <FormatCard
              title="PDF 报销包"
              sub={'含封面、票据汇总\n与明细'}
              active={format_ === 'pdf'}
              onPress={() => setFormat('pdf')}
            />
            <FormatCard
              title="Excel 数据表"
              sub={'票据明细 CSV，\n便于分析'}
              active={format_ === 'csv'}
              onPress={() => setFormat('csv')}
            />
          </View>

          {/* Step 3: checklist + summary */}
          <Text style={s.stepLabel}>
            3. 报销清单{' '}
            <Text style={s.stepLabelMute}>（{format_ === 'pdf' ? '自动包含' : 'CSV 含明细'}）</Text>
          </Text>
          <View style={s.checklistRow}>
            <View style={s.checklist}>
              <ChecklistItem
                icon="document-outline"
                label="费用明细汇总"
                checked
              />
              <ChecklistItem
                icon="list-outline"
                label="票据明细清单"
                checked
              />
              <ChecklistItem
                icon="receipt-outline"
                label="支付凭证"
                checked={format_ === 'pdf'}
                muted={format_ !== 'pdf'}
                hint={format_ === 'pdf' ? '如有' : 'PDF 仅有'}
              />
              <ChecklistItem
                icon="reader-outline"
                label="报销说明页"
                checked={format_ === 'pdf'}
                muted={format_ !== 'pdf'}
                hint={format_ === 'pdf' ? undefined : 'PDF 仅有'}
              />
            </View>

            <View style={s.summary}>
              {previewLoading ? (
                <ActivityIndicator size="small" color={Colors.textPrimary} />
              ) : (
                <>
                  <Text style={s.summaryCount}>
                    共 {previewCount ?? 0} 张票据
                  </Text>
                  <Text style={s.summaryAmtLabel}>合计金额（CNY）</Text>
                  <Text style={s.summaryAmt}>
                    ¥{(previewTotal ?? 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                  {previewCurrencies.length > 0 && (
                    <>
                      <Text style={s.summaryCurrLabel}>
                        覆盖 {previewCurrencies.length} 种货币
                      </Text>
                      <View style={s.currRow}>
                        {previewCurrencies.slice(0, 6).map((c) => (
                          <View key={c} style={s.currPill}>
                            <Text style={s.currPillText}>{c}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                </>
              )}
            </View>
          </View>

          {/* Generate button */}
          <Pressable
            onPress={handleGenerate}
            disabled={exporting || previewCount === 0}
            style={({ pressed }) => [
              s.generateBtn,
              (exporting || previewCount === 0) && s.generateBtnDisabled,
              pressed && !exporting && previewCount !== 0 && { opacity: 0.88 },
            ]}
          >
            {exporting ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={s.generateBtnText}>
                {previewCount === 0 ? '该范围内无票据' : '生成报销包'}
              </Text>
            )}
          </Pressable>

          {/* v1.2 #1: bottom spacer so generate button isn't under the tab bar */}
          <View style={{ height: 200 }} />
        </ScrollView>

        {/* Date picker modal */}
        <DatePickerModal
          visible={pickerTarget !== null}
          title={pickerTarget === 'start' ? '选择开始日期' : '选择结束日期'}
          value={pickerTarget === 'start' ? startDate : endDate}
          maxDate={pickerTarget === 'start' ? endDate : new Date()}
          minDate={pickerTarget === 'end' ? startDate : undefined}
          onConfirm={(d) => {
            if (pickerTarget === 'start') setStartDate(d);
            else setEndDate(d);
            setPickerTarget(null);
          }}
          onCancel={() => setPickerTarget(null)}
        />
      </SafeAreaView>
    </AmbientBackground>
  );
}

// ─── Format card ─────────────────────────────────────────────────────────

function FormatCard({
  title, sub, active, onPress,
}: {
  title: string;
  sub: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.formatCard, active && s.formatCardActive, pressed && { opacity: 0.85 }]}
    >
      <Text style={s.formatTitle}>{title}</Text>
      <Text style={s.formatSub}>{sub}</Text>
      <View style={[s.formatRadio, active && s.formatRadioActive]}>
        {active ? <Ionicons name="checkmark" size={12} color={Colors.textInverse} /> : null}
      </View>
    </Pressable>
  );
}

// ─── Checklist item ──────────────────────────────────────────────────────

function ChecklistItem({
  icon, label, checked, muted, hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  checked: boolean;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <View style={s.checkItem}>
      <View style={s.checkLeft}>
        <Ionicons name={icon} size={13} color={muted ? Colors.textTertiary : Colors.textSecondary} />
        <Text style={[s.checkLabel, muted && { color: Colors.textTertiary }]}>{label}</Text>
        {hint && <Text style={s.checkHint}>· {hint}</Text>}
      </View>
      {checked ? (
        <Ionicons name="checkmark" size={14} color={Colors.accent} />
      ) : (
        <Ionicons name="remove" size={14} color={Colors.textTertiary} />
      )}
    </View>
  );
}

// ─── Inline date picker modal ────────────────────────────────────────────

const WEEKDAYS_HEADER = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS_ZH = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function buildCalendarCells(
  year: number,
  month: number,
): Array<{ y: number; m: number; d: number }> {
  const firstDow  = new Date(year, month - 1, 1).getDay();
  const daysInMon = new Date(year, month, 0).getDate();
  const prevDays  = new Date(year, month - 1, 0).getDate();
  const cells: Array<{ y: number; m: number; d: number }> = [];

  const prevM = month === 1 ? 12 : month - 1;
  const prevY = month === 1 ? year - 1 : year;
  for (let i = firstDow - 1; i >= 0; i--)
    cells.push({ y: prevY, m: prevM, d: prevDays - i });

  for (let d = 1; d <= daysInMon; d++) cells.push({ y: year, m: month, d });

  const nextM = month === 12 ? 1 : month + 1;
  const nextY = month === 12 ? year + 1 : year;
  let nd = 1;
  while (cells.length < 42) cells.push({ y: nextY, m: nextM, d: nd++ });

  return cells;
}

function DatePickerModal({
  visible, title, value, minDate, maxDate, onConfirm, onCancel,
}: {
  visible: boolean;
  title: string;
  value: Date;
  minDate?: Date;
  maxDate?: Date;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
}) {
  const [calYear, setCalYear] = useState(value.getFullYear());
  const [calMonth, setCalMonth] = useState(value.getMonth() + 1);
  const [selected, setSelected] = useState(value);

  useEffect(() => {
    if (visible) {
      setCalYear(value.getFullYear());
      setCalMonth(value.getMonth() + 1);
      setSelected(value);
    }
  }, [visible, value]);

  function prev() {
    if (calMonth === 1) { setCalYear((y) => y - 1); setCalMonth(12); }
    else setCalMonth((m) => m - 1);
  }
  function next() {
    if (calMonth === 12) { setCalYear((y) => y + 1); setCalMonth(1); }
    else setCalMonth((m) => m + 1);
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const cells = buildCalendarCells(calYear, calMonth);

  function isDisabled(c: { y: number; m: number; d: number }) {
    const d = new Date(c.y, c.m - 1, c.d);
    if (minDate && d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) return true;
    if (maxDate && d > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())) return true;
    return false;
  }
  function key(c: { y: number; m: number; d: number }) {
    return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
  }
  const selectedKey = format(selected, 'yyyy-MM-dd');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={p.overlay}>
        <View style={p.card}>
          <Text style={p.title}>{title}</Text>
          <View style={p.calHeader}>
            <Pressable onPress={prev} style={p.calNavBtn}>
              <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
            </Pressable>
            <Text style={p.calMonthLabel}>{calYear}年 {MONTHS_ZH[calMonth - 1]}</Text>
            <Pressable onPress={next} style={p.calNavBtn}>
              <Ionicons name="chevron-forward" size={18} color={Colors.textPrimary} />
            </Pressable>
          </View>
          <View style={p.weekRow}>
            {WEEKDAYS_HEADER.map((d) => (
              <Text key={d} style={p.weekDay}>{d}</Text>
            ))}
          </View>
          <View style={p.daysGrid}>
            {cells.map((cell) => {
              const k = key(cell);
              const isCurrent = cell.m === calMonth;
              const isToday = k === todayStr;
              const isSel = k === selectedKey;
              const disabled = isDisabled(cell);
              return (
                <TouchableOpacity
                  key={k}
                  style={[p.dayCell, isSel && p.dayCellSel, isToday && !isSel && p.dayCellToday]}
                  onPress={() => {
                    if (!disabled) setSelected(new Date(cell.y, cell.m - 1, cell.d));
                  }}
                  disabled={disabled}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      p.dayText,
                      isSel && p.dayTextSel,
                      isToday && !isSel && p.dayTextToday,
                      !isCurrent && p.dayTextOther,
                      disabled && p.dayTextDisabled,
                    ]}
                  >
                    {cell.d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={p.selectedLabel}>已选：{format(selected, 'yyyy年M月d日')}</Text>
          <View style={p.btnRow}>
            <Pressable style={p.cancelBtn} onPress={onCancel}>
              <Text style={p.cancelText}>取消</Text>
            </Pressable>
            <Pressable style={p.confirmBtn} onPress={() => onConfirm(selected)}>
              <Text style={p.confirmText}>确认</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.md, paddingTop: 4 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  headerHelp: { fontSize: 14, fontWeight: '600', color: Colors.textTertiary },

  // Hero illustration
  hero: {
    height: 130,
    borderRadius: Radius.xl,
    backgroundColor: '#E8DEC7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    marginBottom: 16,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'flex-end',
    padding: Spacing.md,
  },
  heroStamp: {
    position: 'absolute',
    top: 14,
    left: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(45, 60, 50, 0.40)',
    borderStyle: 'dashed',
    borderRadius: 4,
    transform: [{ rotate: '-6deg' }],
  },
  heroStampText: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(45, 60, 50, 0.55)',
    letterSpacing: 1,
  },
  heroIcons: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },

  // Step labels
  stepLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 6,
    marginBottom: 8,
  },
  stepLabelMute: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '500',
  },

  // Date row
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  datePick: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  dateSep: { fontSize: 12, color: Colors.textTertiary },

  // Format cards
  formatRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  formatCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: 12,
    minHeight: 80,
    position: 'relative',
  },
  formatCardActive: {
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  formatTitle: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary, marginRight: 24 },
  formatSub: { fontSize: 10, color: Colors.textTertiary, marginTop: 4, lineHeight: 14 },
  formatRadio: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatRadioActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },

  // Checklist + summary
  checklistRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  checklist: {
    flex: 1.2,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: 12,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  checkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  checkLabel: { fontSize: 12, color: Colors.textPrimary, fontWeight: '500' },
  checkHint: { fontSize: 10, color: Colors.textTertiary, marginLeft: 4 },

  summary: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCount: { fontSize: 11, color: Colors.textTertiary, fontWeight: '600' },
  summaryAmtLabel: {
    fontSize: 9,
    color: Colors.textTertiary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
  },
  summaryAmt: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 4,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  summaryCurrLabel: { fontSize: 9, color: Colors.textTertiary, marginTop: 8 },
  currRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 3,
    marginTop: 4,
  },
  currPill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: Colors.accentLight,
  },
  currPillText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.accent,
    letterSpacing: 0.3,
  },

  // Generate button
  generateBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    ...Shadows.md,
  },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText: {
    color: Colors.textInverse,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

const CELL = 38;
const p = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.lg, width: '100%', maxWidth: 360 },
  title: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginBottom: Spacing.md },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  calNavBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calMonthLabel: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekDay: { width: CELL, textAlign: 'center', fontSize: 11, fontWeight: '700', color: Colors.textTertiary },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center', borderRadius: CELL / 2 },
  dayCellSel: { backgroundColor: Colors.accent },
  dayCellToday: { borderWidth: 1.5, borderColor: Colors.accent },
  dayText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  dayTextSel: { color: Colors.textInverse, fontWeight: '700' },
  dayTextToday: { color: Colors.accent, fontWeight: '700' },
  dayTextOther: { color: Colors.textTertiary },
  dayTextDisabled: { color: Colors.borderStrong },
  selectedLabel: { textAlign: 'center', fontSize: 13, color: Colors.textSecondary, marginTop: Spacing.sm, marginBottom: Spacing.md },
  btnRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.accent, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '700', color: Colors.textInverse },
});
