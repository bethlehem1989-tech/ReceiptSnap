/**
 * CSV export service — replaces ExcelJS which crashes Hermes at import time.
 * CSV opens natively in Excel, Numbers and Google Sheets.
 * All converted amounts are expressed in CNY (人民币).
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { format } from 'date-fns';
import { convertToCny } from './currency';
import { ExportOptions, Receipt } from '../types';
import { getReceiptsByDateRange } from './receipts';

const CATEGORY_ZH: Record<string, string> = {
  meals: '餐饮', transport: '交通', accommodation: '住宿',
  entertainment: '娱乐', office: '办公', other: '其他',
};

export async function exportReceiptsToExcel(
  userId: string,
  options: ExportOptions,
): Promise<void> {
  const startStr = format(options.startDate, 'yyyy-MM-dd');
  const endStr   = format(options.endDate,   'yyyy-MM-dd');

  const receipts = await getReceiptsByDateRange(userId, startStr, endStr);

  if (receipts.length === 0) {
    throw new Error('该时间段内没有收据数据，请选择其他时间范围');
  }

  const csv      = await buildCsv(receipts, startStr, endStr);
  const filename = `receipts_${startStr}_to_${endStr}.csv`;
  const tempPath = `${FileSystem.cacheDirectory}${filename}`;

  const BOM = '\uFEFF';
  await FileSystem.writeAsStringAsync(tempPath, BOM + csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(tempPath, {
      mimeType: 'text/csv',
      dialogTitle: `导出 ${filename}`,
      UTI: 'public.comma-separated-values-text',
    });
  }
}

// ─── CSV builder ──────────────────────────────────────────────────────────────

async function buildCsv(
  receipts: Receipt[],
  startStr: string,
  endStr: string,
): Promise<string> {
  const rows: string[] = [];

  // Resolve CNY equivalent for every receipt
  // (use stored value when available, otherwise call live API)
  const resolvedCny: (number | null)[] = await Promise.all(
    receipts.map((r) => (r as any).amount_cny != null
      ? Promise.resolve((r as any).amount_cny as number)
      : convertToCny(r.amount, r.currency)),
  );

  // ── Summary section ──────────────────────────────────────────────────────
  rows.push(esc('汇总'));
  rows.push(row('日期范围', `${startStr} 至 ${endStr}`));
  rows.push(row('收据数量', String(receipts.length)));

  const byCurrency: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  receipts.forEach((r) => {
    byCurrency[r.currency] = (byCurrency[r.currency] ?? 0) + r.amount;
    const cat = r.category ?? 'other';
    byCategory[cat] = (byCategory[cat] ?? 0) + r.amount;
  });

  const totalCny = resolvedCny.reduce((s: number, v) => s + (v ?? 0), 0);
  rows.push(row('合计 (CNY)', totalCny > 0 ? `¥${totalCny.toFixed(2)}` : '—'));

  rows.push('');
  rows.push(esc('货币合计'));
  Object.entries(byCurrency)
    .sort(([, a], [, b]) => b - a)
    .forEach(([cur, total]) => {
      rows.push(row('', `${cur}  ${total.toLocaleString()}`));
    });

  rows.push('');
  rows.push(esc('分类合计 (本位币)'));
  Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .forEach(([cat, total]) => {
      rows.push(row('', `${CATEGORY_ZH[cat] ?? cat}  ${total.toLocaleString()}`));
    });

  rows.push('');
  rows.push('');

  // ── Detail section ───────────────────────────────────────────────────────
  rows.push(esc('收据明细'));
  // Always include the payment columns — they are empty when no proof exists.
  // This ensures a consistent column layout for downstream processing.
  // IMPORTANT: statistics use "收据等值人民币" only. "付款等值人民币" is for
  // transparency only and must NOT be used to compute totals.
  const headers = [
    '日期', '商户名称', '原始金额', '原始币种', '收据等值人民币',
    '付款金额', '付款币种', '付款等值人民币',
    '凭证匹配', '分类', '备注',
  ];
  rows.push(headers.map(esc).join(','));

  receipts.forEach((r, i) => {
    const cnyVal = resolvedCny[i];

    let matchLabel = '— 无凭证';
    if (r.payment_match_status === 'matched') matchLabel = '✓ 已匹配';
    else if (r.payment_match_status === 'mismatch') matchLabel = '⚠ 金额不符';
    else if (r.payment_image_url) matchLabel = '? 未验证';

    const payAmt  = r.payment_amount   != null ? String(r.payment_amount)         : '';
    const payCur  = r.payment_currency ?? '';
    const payCny  = r.payment_amount_cny != null ? `¥${r.payment_amount_cny.toFixed(2)}` : '';

    const cols = [
      r.date,
      r.description ?? '',
      String(r.amount),
      r.currency,
      cnyVal != null ? `¥${cnyVal.toFixed(2)}` : '',
      payAmt,
      payCur,
      payCny,
      matchLabel,
      CATEGORY_ZH[r.category ?? 'other'] ?? r.category ?? '',
      r.notes ?? '',
    ];
    rows.push(cols.map(esc).join(','));
  });

  return rows.join('\r\n');
}

function row(key: string, value: string): string {
  return `${esc(key)},${esc(value)}`;
}

function esc(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\r') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
