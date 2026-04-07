import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Shadows, Spacing, Typography } from '../constants/theme';
import { exportReceiptsToExcel } from '../services/export';
import { exportReceiptsToPdf } from '../services/exportPdf';
import { supabase } from '../services/supabase';
import { ExportOptions } from '../types';

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return JSON.stringify(err);
}

type Preset = 'this_month' | 'last_month' | 'last_3_months';

const PRESETS: { key: Preset; label: string; sub: string }[] = [
  { key: 'this_month',    label: '本月',     sub: format(new Date(), 'MMM yyyy') },
  { key: 'last_month',    label: '上个月',   sub: format(subMonths(new Date(), 1), 'MMM yyyy') },
  { key: 'last_3_months', label: '近三个月', sub: `${format(subMonths(new Date(), 2), 'MMM')} – ${format(new Date(), 'MMM yyyy')}` },
];

function presetDates(preset: Preset): { start: Date; end: Date } {
  const now = new Date();
  switch (preset) {
    case 'this_month':    return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'last_month':    return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
    case 'last_3_months': return { start: startOfMonth(subMonths(now, 2)), end: endOfMonth(now) };
  }
}

export default function ExportScreen() {
  const [preset, setPreset]             = useState<Preset>('this_month');
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const { start, end } = presetDates(preset);
  const options: ExportOptions = { startDate: start, endDate: end, includeImages: true, currencies: [] };

  async function getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('未登录', '请先登录后再导出。'); return null; }
    return user;
  }

  async function handleCsvExport() {
    const user = await getUser();
    if (!user) return;
    setExportingCsv(true);
    try {
      await exportReceiptsToExcel(user.id, options);
    } catch (err) {
      Alert.alert('导出失败', errMsg(err));
    } finally {
      setExportingCsv(false);
    }
  }

  async function handlePdfExport() {
    const user = await getUser();
    if (!user) return;
    setExportingPdf(true);
    try {
      await exportReceiptsToPdf(user.id, options);
    } catch (err) {
      Alert.alert('导出失败', errMsg(err));
    } finally {
      setExportingPdf(false);
    }
  }

  const anyExporting = exportingCsv || exportingPdf;

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>导出报销明细</Text>
          <Text style={s.headerSub}>选择时间范围，导出 PDF 报销单或 CSV 数据表</Text>
        </View>

        {/* Preset selector */}
        <Text style={[Typography.label, s.sectionLabel]}>选择时间范围</Text>
        <View style={s.presetGrid}>
          {PRESETS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[s.presetCard, preset === p.key && s.presetCardActive]}
              onPress={() => setPreset(p.key)}
              activeOpacity={0.75}
            >
              <Text style={[s.presetLabel, preset === p.key && s.presetLabelActive]}>{p.label}</Text>
              <Text style={[s.presetSub, preset === p.key && s.presetSubActive]}>{p.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date range display */}
        <View style={s.dateRangeCard}>
          <View style={s.dateRangeItem}>
            <Text style={s.dateRangeLabel}>开始日期</Text>
            <Text style={s.dateRangeValue}>{format(start, 'MMM d, yyyy')}</Text>
          </View>
          <View style={s.dateRangeDivider} />
          <View style={s.dateRangeItem}>
            <Text style={s.dateRangeLabel}>结束日期</Text>
            <Text style={s.dateRangeValue}>{format(end, 'MMM d, yyyy')}</Text>
          </View>
        </View>

        {/* ── PDF export button (primary — black) ── */}
        <Text style={[Typography.label, s.sectionLabel]}>导出格式</Text>

        <TouchableOpacity
          style={[s.pdfBtn, anyExporting && s.btnDisabled]}
          onPress={handlePdfExport}
          disabled={anyExporting}
          activeOpacity={0.85}
        >
          {exportingPdf ? (
            <View style={s.btnInner}>
              <ActivityIndicator color={Colors.white} size="small" />
              <View>
                <Text style={s.pdfBtnTitle}>正在生成 PDF…</Text>
                <Text style={s.pdfBtnSubtitle}>正在嵌入收据图片，请稍候</Text>
              </View>
            </View>
          ) : (
            <View style={s.btnInner}>
              <View>
                <Text style={s.pdfBtnTitle}>导出 PDF 报销单</Text>
                <Text style={s.pdfBtnSubtitle}>含封面、收据图片和明细，适合报销审批</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* ── CSV export button (secondary — white + black border) ── */}
        <TouchableOpacity
          style={[s.csvBtn, anyExporting && s.btnDisabled]}
          onPress={handleCsvExport}
          disabled={anyExporting}
          activeOpacity={0.85}
        >
          {exportingCsv ? (
            <View style={s.btnInner}>
              <ActivityIndicator color={Colors.black} size="small" />
              <View>
                <Text style={s.csvBtnTitle}>正在生成 CSV…</Text>
              </View>
            </View>
          ) : (
            <View style={s.btnInner}>
              <View>
                <Text style={s.csvBtnTitle}>导出 CSV 数据表</Text>
                <Text style={s.csvBtnSubtitle}>可用 Excel / Numbers 打开，适合数据分析</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* Info cards */}
        <View style={s.infoGrid}>
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>PDF 内容</Text>
            <Text style={s.infoBody}>封面摘要 + 每张收据（图片 + 金额 + 商户 + 日期 + 分类）</Text>
          </View>
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>CSV 内容</Text>
            <Text style={s.infoBody}>货币 / 分类汇总 + 每张收据的结构化数据</Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.white },
  content: { padding: Spacing.md, paddingBottom: 48 },

  // Header — no emoji, black bold title
  header: { marginBottom: Spacing.lg, paddingTop: Spacing.sm },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.black,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  headerSub: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  sectionLabel: { marginBottom: 10, marginTop: 4 },

  // Preset cards — black border when selected, gray border when not
  presetGrid: { flexDirection: 'row', gap: 10, marginBottom: Spacing.md },
  presetCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  presetCardActive: {
    borderColor: Colors.black,
    borderWidth: 2,
  },
  presetLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  presetLabelActive: { color: Colors.black },
  presetSub: { fontSize: 10, color: Colors.textTertiary, textAlign: 'center' },
  presetSubActive: { color: Colors.textSecondary },

  // Date range card
  dateRangeCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    marginBottom: Spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  dateRangeItem: { flex: 1, padding: Spacing.md, alignItems: 'center' },
  dateRangeDivider: { width: 1, backgroundColor: Colors.border },
  dateRangeLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dateRangeValue: { fontSize: 15, fontWeight: '700', color: Colors.black },

  // PDF button — black filled
  pdfBtn: {
    backgroundColor: Colors.black,
    borderRadius: Radius.lg,
    paddingVertical: 18,
    paddingHorizontal: Spacing.md,
    marginBottom: 12,
  },
  pdfBtnTitle: { fontSize: 16, fontWeight: '700', color: Colors.white, marginBottom: 2 },
  pdfBtnSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.70)' },

  // CSV button — white + black border
  csvBtn: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    paddingVertical: 18,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.black,
  },
  csvBtnTitle: { fontSize: 16, fontWeight: '700', color: Colors.black, marginBottom: 2 },
  csvBtnSubtitle: { fontSize: 12, color: Colors.textSecondary },

  btnDisabled: { opacity: 0.45 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 14 },

  // Info cards — white, black left border accent
  infoGrid: { flexDirection: 'row', gap: 10 },
  infoCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: Colors.black,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  infoTitle: { fontSize: 13, fontWeight: '700', color: Colors.black, marginBottom: 4 },
  infoBody: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
});
