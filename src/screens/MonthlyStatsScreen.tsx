import { addMonths, format, startOfMonth, subMonths } from 'date-fns';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CATEGORY_LABELS } from '../constants/i18n';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
import { getDateRangeSummary, getMonthlySummary } from '../services/receipts';
import { supabase } from '../services/supabase';
import { MonthlySummary, ReceiptCategory } from '../types';

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<ReceiptCategory, { color: string; icon: string }> = {
  meals:         { color: Colors.meals,         icon: '🍽' },
  transport:     { color: Colors.transport,     icon: '🚗' },
  accommodation: { color: Colors.accommodation, icon: '🏨' },
  entertainment: { color: Colors.entertainment, icon: '🎭' },
  office:        { color: Colors.office,        icon: '💼' },
  other:         { color: Colors.other,         icon: '📎' },
};

type Mode = 'monthly' | 'custom';

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MonthlyStatsScreen() {
  const [mode, setMode]               = useState<Mode>('monthly');
  const [selectedDate, setSelectedDate] = useState(new Date());   // monthly mode
  const [customStart, setCustomStart] = useState(startOfMonth(new Date())); // custom mode start
  const [customEnd,   setCustomEnd]   = useState(new Date());               // custom mode end
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);
  const [summary, setSummary]         = useState<MonthlySummary | null>(null);
  const [loading, setLoading]         = useState(true);

  // Load data whenever mode or the relevant dates change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) { setLoading(false); return; }

      let data: MonthlySummary;
      if (mode === 'monthly') {
        data = await getMonthlySummary(
          user.id,
          selectedDate.getFullYear(),
          selectedDate.getMonth() + 1,
        );
      } else {
        data = await getDateRangeSummary(
          user.id,
          format(customStart, 'yyyy-MM-dd'),
          format(customEnd,   'yyyy-MM-dd'),
        );
      }
      if (!cancelled) { setSummary(data); setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [mode, selectedDate, customStart, customEnd]);

  // Monthly mode nav
  const isCurrentMonth = format(selectedDate, 'yyyy-MM') === format(new Date(), 'yyyy-MM');
  function prevMonth() { setSelectedDate((d) => subMonths(d, 1)); }
  function nextMonth() {
    const next = addMonths(selectedDate, 1);
    if (next <= new Date()) setSelectedDate(next);
  }

  const catTotal = summary?.totalCny ?? 0;
  const hasData  = summary && summary.receiptCount > 0;

  // Title shown in the hero card
  const rangeTitle = mode === 'monthly'
    ? format(selectedDate, 'yyyy年M月')
    : `${format(customStart, 'yyyy.MM.dd')} — ${format(customEnd, 'yyyy.MM.dd')}`;

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Mode tabs ── */}
        <View style={s.modeTabs}>
          <TouchableOpacity
            style={[s.modeTab, mode === 'monthly' && s.modeTabActive]}
            onPress={() => setMode('monthly')}
          >
            <Text style={[s.modeTabText, mode === 'monthly' && s.modeTabTextActive]}>按月统计</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeTab, mode === 'custom' && s.modeTabActive]}
            onPress={() => setMode('custom')}
          >
            <Text style={[s.modeTabText, mode === 'custom' && s.modeTabTextActive]}>自定义范围</Text>
          </TouchableOpacity>
        </View>

        {/* ── Monthly navigator (monthly mode only) ── */}
        {mode === 'monthly' && (
          <View style={s.monthNav}>
            <TouchableOpacity style={s.navArrow} onPress={prevMonth}>
              <Text style={s.navArrowText}>‹</Text>
            </TouchableOpacity>
            <Text style={s.monthLabel}>{format(selectedDate, 'MMMM yyyy')}</Text>
            <TouchableOpacity
              style={[s.navArrow, isCurrentMonth && s.navArrowDisabled]}
              onPress={nextMonth}
              disabled={isCurrentMonth}
            >
              <Text style={[s.navArrowText, isCurrentMonth && { color: Colors.border }]}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Custom range pickers ── */}
        {mode === 'custom' && (
          <View style={s.customRangeRow}>
            <TouchableOpacity style={s.datePill} onPress={() => setPickerTarget('start')}>
              <Text style={s.datePillLabel}>开始</Text>
              <Text style={s.datePillValue}>{format(customStart, 'yyyy.MM.dd')}</Text>
            </TouchableOpacity>
            <Text style={s.dateSep}>—</Text>
            <TouchableOpacity style={s.datePill} onPress={() => setPickerTarget('end')}>
              <Text style={s.datePillLabel}>结束</Text>
              <Text style={s.datePillValue}>{format(customEnd, 'yyyy.MM.dd')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Calendar picker modal ── */}
        <DatePickerModal
          visible={pickerTarget !== null}
          title={pickerTarget === 'start' ? '选择开始日期' : '选择结束日期'}
          value={pickerTarget === 'start' ? customStart : customEnd}
          maxDate={pickerTarget === 'start' ? customEnd : new Date()}
          minDate={pickerTarget === 'end'   ? customStart : undefined}
          onConfirm={(d) => {
            if (pickerTarget === 'start') setCustomStart(d);
            else setCustomEnd(d);
            setPickerTarget(null);
          }}
          onCancel={() => setPickerTarget(null)}
        />

        {/* ── Data ── */}
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : !hasData ? (
          <View style={s.emptyState}>
            <Text style={s.emptyEmoji}>📊</Text>
            <Text style={[Typography.h3, { marginBottom: 8 }]}>
              {mode === 'monthly' ? '本月暂无数据' : '该范围内暂无数据'}
            </Text>
            <Text style={[Typography.caption, { textAlign: 'center' }]}>
              {mode === 'monthly' ? '本月还没有收据记录' : '所选日期范围内没有收据'}
            </Text>
          </View>
        ) : (
          <>
            {/* Hero card */}
            <View style={s.heroWrap}>
              <View style={s.heroCard}>
                <Text style={s.heroLabel}>总支出（等值人民币）</Text>
                <Text style={s.heroAmount}>
                  {catTotal > 0 ? `¥${catTotal.toFixed(2)}` : '—'}
                </Text>
                <Text style={s.heroSub}>
                  {summary!.receiptCount} 张收据 · {rangeTitle}
                </Text>
              </View>
            </View>

            {/* Category breakdown */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={Typography.label}>分类明细</Text>
                <Text style={s.sectionNote}>人民币等值</Text>
              </View>
              <View style={{ marginTop: Spacing.md, gap: 12 }}>
                {summary!.byCategoryCny && Object.entries(summary!.byCategoryCny)
                  .filter(([, v]) => v > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, amount]) => (
                    <CategoryRow
                      key={cat}
                      category={cat as ReceiptCategory}
                      amount={amount}
                      total={catTotal}
                    />
                  ))}
              </View>
            </View>

            {/* Currency detail table */}
            {Object.keys(summary!.byCurrency).length > 0 && (
              <View style={s.section}>
                <Text style={[Typography.label, { marginBottom: Spacing.sm }]}>货币明细</Text>

                <View style={s.currencyHeaderRow}>
                  <Text style={[s.currencyColLabel, { flex: 1.2 }]}>货币</Text>
                  <Text style={[s.currencyColLabel, { flex: 1.8, textAlign: 'right' }]}>原始金额</Text>
                  <Text style={[s.currencyColLabel, { flex: 1.5, textAlign: 'right' }]}>≈ CNY</Text>
                </View>

                {Object.entries(summary!.byCurrency)
                  .sort(([a], [b]) =>
                    (summary!.byCurrencyCny[b] ?? 0) - (summary!.byCurrencyCny[a] ?? 0)
                  )
                  .map(([currency, amount], i, arr) => {
                    const cnyVal = summary!.byCurrencyCny[currency] ?? 0;
                    return (
                      <View
                        key={currency}
                        style={[s.currencyRow, i < arr.length - 1 && s.currencyRowBorder]}
                      >
                        <View style={[s.currencyFlag, { flex: 1.2 }]}>
                          <Text style={s.currencyFlagText}>{currency}</Text>
                        </View>
                        <Text style={[s.currencyNative, { flex: 1.8 }]}>
                          {amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </Text>
                        <Text style={[s.currencyConverted, { flex: 1.5 }]}>
                          {cnyVal > 0 ? `¥${cnyVal.toFixed(2)}` : '—'}
                        </Text>
                      </View>
                    );
                  })}

                {/* Totals row — equals catTotal exactly (same source data) */}
                <View style={[s.currencyRow, s.currencyTotalRow]}>
                  <Text style={[s.currencyTotalLabel, { flex: 1.2 }]}>合计</Text>
                  <Text style={[s.currencyNative, { flex: 1.8, color: Colors.textTertiary }]}>—</Text>
                  <Text style={[s.currencyConverted, s.currencyTotalVal, { flex: 1.5 }]}>
                    {catTotal > 0 ? `¥${catTotal.toFixed(2)}` : '—'}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── CategoryRow ──────────────────────────────────────────────────────────────

function CategoryRow({ category, amount, total }: {
  category: ReceiptCategory;
  amount: number;
  total: number;
}) {
  const meta = CATEGORY_META[category];
  const pct  = total > 0 ? (amount / total) * 100 : 0;
  return (
    <View>
      <View style={s.catRowHeader}>
        <View style={s.catRowLeft}>
          <View style={[s.catIconBadge, { backgroundColor: meta.color + '20' }]}>
            <Text style={{ fontSize: 14 }}>{meta.icon}</Text>
          </View>
          <Text style={s.catName}>{CATEGORY_LABELS[category] ?? category}</Text>
        </View>
        <View style={s.catRowRight}>
          <Text style={s.catAmount}>¥{amount.toFixed(2)}</Text>
          <Text style={s.catPct}>{pct.toFixed(0)}%</Text>
        </View>
      </View>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${pct}%` as any, backgroundColor: meta.color }]} />
      </View>
    </View>
  );
}

// ─── DatePickerModal ──────────────────────────────────────────────────────────

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS_ZH = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function buildCalendarCells(year: number, month: number): Array<{ y: number; m: number; d: number }> {
  const firstDow   = new Date(year, month - 1, 1).getDay();     // 0=Sun
  const daysInMon  = new Date(year, month, 0).getDate();
  const prevDays   = new Date(year, month - 1, 0).getDate();
  const cells: Array<{ y: number; m: number; d: number }> = [];

  const prevM = month === 1 ? 12 : month - 1;
  const prevY = month === 1 ? year - 1 : year;
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ y: prevY, m: prevM, d: prevDays - i });

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
  const [calYear,  setCalYear]  = useState(value.getFullYear());
  const [calMonth, setCalMonth] = useState(value.getMonth() + 1);
  const [selected, setSelected] = useState(value);

  // Sync when the modal reopens with a new value
  React.useEffect(() => {
    if (visible) {
      setCalYear(value.getFullYear());
      setCalMonth(value.getMonth() + 1);
      setSelected(value);
    }
  }, [visible, value]);

  function prevCalMonth() {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
    else setCalMonth(m => m - 1);
  }
  function nextCalMonth() {
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
    else setCalMonth(m => m + 1);
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const cells = buildCalendarCells(calYear, calMonth);

  function isDisabled(cell: { y: number; m: number; d: number }) {
    const d = new Date(cell.y, cell.m - 1, cell.d);
    if (minDate && d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) return true;
    if (maxDate && d > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())) return true;
    return false;
  }

  function cellKey(c: { y: number; m: number; d: number }) {
    return `${c.y}-${String(c.m).padStart(2,'0')}-${String(c.d).padStart(2,'0')}`;
  }
  const selectedKey = format(selected, 'yyyy-MM-dd');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={p.overlay}>
        <View style={p.card}>

          {/* Title */}
          <Text style={p.title}>{title}</Text>

          {/* Month nav */}
          <View style={p.calHeader}>
            <TouchableOpacity style={p.calNavBtn} onPress={prevCalMonth}>
              <Text style={p.calNavText}>‹</Text>
            </TouchableOpacity>
            <Text style={p.calMonthLabel}>
              {calYear}年 {MONTHS_ZH[calMonth - 1]}
            </Text>
            <TouchableOpacity style={p.calNavBtn} onPress={nextCalMonth}>
              <Text style={p.calNavText}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Weekday headers */}
          <View style={p.weekRow}>
            {WEEKDAYS.map((d) => (
              <Text key={d} style={p.weekDay}>{d}</Text>
            ))}
          </View>

          {/* Day cells — 6 rows × 7 cols */}
          <View style={p.daysGrid}>
            {cells.map((cell) => {
              const key      = cellKey(cell);
              const isCurrent = cell.m === calMonth;
              const isToday  = key === todayStr;
              const isSel    = key === selectedKey;
              const disabled = isDisabled(cell);

              return (
                <TouchableOpacity
                  key={key}
                  style={[p.dayCell, isSel && p.dayCellSel, isToday && !isSel && p.dayCellToday]}
                  onPress={() => {
                    if (!disabled) setSelected(new Date(cell.y, cell.m - 1, cell.d));
                  }}
                  disabled={disabled}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    p.dayText,
                    isSel      && p.dayTextSel,
                    isToday && !isSel && p.dayTextToday,
                    !isCurrent && p.dayTextOther,
                    disabled   && p.dayTextDisabled,
                  ]}>
                    {cell.d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected date display */}
          <Text style={p.selectedLabel}>
            已选：{format(selected, 'yyyy年M月d日')}
          </Text>

          {/* Buttons */}
          <View style={p.btnRow}>
            <TouchableOpacity style={p.cancelBtn} onPress={onCancel}>
              <Text style={p.cancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={p.confirmBtn} onPress={() => onConfirm(selected)}>
              <Text style={p.confirmText}>确认</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },

  // Mode tabs
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 0,
  },
  modeTab: {
    paddingHorizontal: Spacing.md, paddingVertical: 10, marginRight: 4,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  modeTabActive: { borderBottomColor: Colors.black },
  modeTabText:   { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  modeTabTextActive: { color: Colors.black },

  // Monthly navigator
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  navArrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navArrowDisabled: { opacity: 0.3 },
  navArrowText: { fontSize: 30, color: Colors.black, fontWeight: '300', marginTop: -4 },
  monthLabel: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },

  // Custom range row
  customRangeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 8,
  },
  datePill: {
    flex: 1, backgroundColor: Colors.surfaceSecondary,
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  datePillLabel: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  datePillValue: { fontSize: 15, fontWeight: '700', color: Colors.black, marginTop: 2 },
  dateSep: { fontSize: 18, color: Colors.textTertiary, fontWeight: '300' },

  loadingWrap: { marginTop: 80, alignItems: 'center' },
  emptyState:  { marginTop: 80, alignItems: 'center', paddingHorizontal: 40 },
  emptyEmoji:  { fontSize: 56, marginBottom: Spacing.md },

  // Hero
  heroWrap: { marginHorizontal: Spacing.md, marginTop: Spacing.md },
  heroCard: { borderRadius: Radius.xl, padding: Spacing.lg, backgroundColor: Colors.black, ...Shadows.lg },
  heroLabel:  { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroAmount: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -1, marginTop: 6 },
  heroSub:    { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 6 },

  // Section
  section: {
    backgroundColor: Colors.surface, marginHorizontal: Spacing.md,
    marginTop: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md, ...Shadows.sm,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionNote:   { fontSize: 11, fontWeight: '600', color: Colors.textTertiary, fontStyle: 'italic' },

  // Category rows
  catRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  catRowLeft:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catIconBadge: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  catName:      { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  catRowRight:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catAmount:    { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  catPct:       { fontSize: 12, color: Colors.textSecondary, width: 32, textAlign: 'right' },
  barTrack:     { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  barFill:      { height: '100%', borderRadius: 3 },

  // Currency table
  currencyHeaderRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 4,
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  currencyColLabel:  { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  currencyRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  currencyRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  currencyTotalRow:  { marginTop: 4, paddingTop: 10, borderTopWidth: 1.5, borderTopColor: Colors.border },
  currencyFlag:      {},
  currencyFlagText:  {
    fontSize: 12, fontWeight: '800', color: Colors.primary,
    backgroundColor: Colors.primaryLight, paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: Radius.sm, alignSelf: 'flex-start',
  },
  currencyNative:    { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, textAlign: 'right' },
  currencyConverted: { fontSize: 12, color: Colors.textSecondary, textAlign: 'right' },
  currencyTotalLabel: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  currencyTotalVal:   { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
});

// Calendar picker styles (separate namespace to avoid collision)
const CELL = 38;
const p = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, width: '100%', maxWidth: 360, ...Shadows.lg,
  },
  title: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginBottom: Spacing.md },

  // Month nav
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  calNavBtn:  { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calNavText: { fontSize: 26, color: Colors.black, fontWeight: '300', marginTop: -3 },
  calMonthLabel: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },

  // Weekday row
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekDay: { width: CELL, textAlign: 'center', fontSize: 11, fontWeight: '700', color: Colors.textTertiary },

  // Day grid
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: CELL, height: CELL,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: CELL / 2,
  },
  dayCellSel:   { backgroundColor: Colors.black },
  dayCellToday: { borderWidth: 1.5, borderColor: Colors.black },
  dayText:         { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  dayTextSel:      { color: '#fff', fontWeight: '700' },
  dayTextToday:    { color: Colors.black, fontWeight: '700' },
  dayTextOther:    { color: Colors.textTertiary },
  dayTextDisabled: { color: Colors.border },

  // Footer
  selectedLabel: {
    textAlign: 'center', fontSize: 13, color: Colors.textSecondary,
    marginTop: Spacing.sm, marginBottom: Spacing.md,
  },
  btnRow:     { flexDirection: 'row', gap: 10 },
  cancelBtn:  {
    flex: 1, paddingVertical: 12, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.black, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
