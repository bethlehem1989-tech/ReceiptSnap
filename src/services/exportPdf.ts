/**
 * PDF Export Service
 *
 * Layout per receipt card:
 *
 *  WITHOUT payment proof (2-column):
 *  ┌──────────────────┬─────────────────────────────┐
 *  │  Receipt image   │  Amount / merchant / date    │
 *  │  (200 × 280 px)  │  Category / notes / seq      │
 *  └──────────────────┴─────────────────────────────┘
 *
 *  WITH payment proof (3-column, LEFT-RIGHT images):
 *  ┌────────────┬────────────┬────────────────────────┐
 *  │  收据       │  付款凭证   │  Amount / merchant     │
 *  │  (160×280) │  (160×280) │  Match badge + detail  │
 *  │            │            │  Notes if mismatch      │
 *  └────────────┴────────────┴────────────────────────┘
 *
 * Images are embedded as base64 so the PDF is fully self-contained.
 * Uses expo-print (HTML → PDF), fully compatible with Hermes.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { format } from 'date-fns';
import { convertToCny } from './currency';
import { ExportOptions, Receipt, ReceiptCategory } from '../types';
import { getReceiptsByDateRange } from './receipts';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_ZH: Record<string, string> = {
  meals: '餐饮', transport: '交通', accommodation: '住宿',
  entertainment: '娱乐', office: '办公', other: '其他',
};

const CATEGORY_COLOR: Record<string, string> = {
  meals: '#FF6B6B', transport: '#4ECDC4', accommodation: '#45B7D1',
  entertainment: '#96CEB4', office: '#667EEA', other: '#A0AEC0',
};

/** Tolerance for amount matching (8 % covers FX fluctuation + payment fees) */
const MATCH_TOLERANCE = 0.08;

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportReceiptsToPdf(
  userId: string,
  options: ExportOptions,
): Promise<void> {
  const startStr = format(options.startDate, 'yyyy-MM-dd');
  const endStr   = format(options.endDate,   'yyyy-MM-dd');

  const receipts = await getReceiptsByDateRange(userId, startStr, endStr);

  if (receipts.length === 0) {
    throw new Error('该时间段内没有收据数据，请选择其他时间范围');
  }

  const imageMap = await loadImages(receipts);

  // Resolve CNY equivalent for each receipt
  const resolvedCny = await Promise.all(
    receipts.map((r) => (r as any).amount_cny != null
      ? Promise.resolve((r as any).amount_cny as number)
      : convertToCny(r.amount, r.currency)),
  );

  const html = buildHtml(receipts, imageMap, resolvedCny, startStr, endStr);

  const { uri: tempUri } = await Print.printToFileAsync({
    html,
    base64: false,
    width: 595,
    height: 842,
  });

  const filename = `receipts_${startStr}_to_${endStr}.pdf`;
  const destPath = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.copyAsync({ from: tempUri, to: destPath });
  await FileSystem.deleteAsync(tempUri, { idempotent: true });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(destPath, {
      mimeType: 'application/pdf',
      dialogTitle: `导出 ${filename}`,
      UTI: 'com.adobe.pdf',
    });
  }
}

// ─── Image loader ─────────────────────────────────────────────────────────────

async function loadImages(receipts: Receipt[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  await Promise.all(
    receipts.flatMap((r) => {
      const jobs: Promise<void>[] = [];
      if (r.image_url) {
        jobs.push(
          FileSystem.readAsStringAsync(r.image_url, { encoding: FileSystem.EncodingType.Base64 })
            .then((b64) => { map[r.id] = `data:image/jpeg;base64,${b64}`; })
            .catch(() => {}),
        );
      }
      if (r.payment_image_url) {
        jobs.push(
          FileSystem.readAsStringAsync(r.payment_image_url, { encoding: FileSystem.EncodingType.Base64 })
            .then((b64) => { map[`payment_${r.id}`] = `data:image/jpeg;base64,${b64}`; })
            .catch(() => {}),
        );
      }
      return jobs;
    }),
  );
  return map;
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildHtml(
  receipts: Receipt[],
  imageMap: Record<string, string>,
  resolvedCny: (number | null)[],
  startStr: string,
  endStr: string,
): string {
  const byCurrency: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  receipts.forEach((r) => {
    byCurrency[r.currency] = (byCurrency[r.currency] ?? 0) + r.amount;
    const cat = r.category ?? 'other';
    byCategory[cat] = (byCategory[cat] ?? 0) + r.amount;
  });

  const totalCny = resolvedCny.reduce((s: number, v) => s + (v ?? 0), 0);

  const currencyRows = Object.entries(byCurrency)
    .sort(([, a], [, b]) => b - a)
    .map(([cur, total]) =>
      `<div class="stat-row"><span class="stat-cur">${cur}</span><span class="stat-amt">${total.toLocaleString()}</span></div>`,
    ).join('');

  const categoryRows = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, total]) => {
      const color = CATEGORY_COLOR[cat] ?? '#A0AEC0';
      return `<div class="stat-row"><span class="cat-badge" style="background:${color}20;color:${color}">${CATEGORY_ZH[cat] ?? cat}</span><span class="stat-amt">${total.toLocaleString()}</span></div>`;
    }).join('');

  const receiptCards = receipts
    .map((r, i) => buildReceiptCard(r, imageMap, resolvedCny[i]))
    .join('');

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  color: #1a202c;
  background: #fff;
}

/* ── Cover ─────────────────────────────────────────────────────────── */
.cover {
  width: 100%;
  min-height: 100vh;
  padding: 60px 48px 48px;
  display: flex;
  flex-direction: column;
  page-break-after: always;
}
.cover-logo    { font-size: 36px; margin-bottom: 8px; }
.cover-title   { font-size: 28pt; font-weight: 800; color: #667eea; letter-spacing: -1px; margin-bottom: 6px; }
.cover-subtitle { font-size: 13pt; color: #718096; margin-bottom: 40px; }
.cover-meta    { display: flex; gap: 24px; margin-bottom: 40px; }
.meta-card     { background: #f7f8fc; border-radius: 12px; padding: 20px 24px; flex: 1; border-left: 4px solid #667eea; }
.meta-card-label { font-size: 9pt; font-weight: 700; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
.meta-card-value { font-size: 18pt; font-weight: 800; color: #2d3748; }
.summary-grid  { display: flex; gap: 24px; flex: 1; }
.summary-section { flex: 1; background: #f7f8fc; border-radius: 12px; padding: 20px; }
.summary-section h3 { font-size: 9pt; font-weight: 700; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 12px; }
.stat-row      { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #edf2f7; }
.stat-row:last-child { border-bottom: none; }
.stat-cur      { font-size: 11pt; font-weight: 700; color: #4a5568; background: #edf2f7; padding: 3px 8px; border-radius: 6px; }
.stat-amt      { font-size: 11pt; font-weight: 700; color: #2d3748; }
.cat-badge     { font-size: 10pt; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
.cover-totals  { display: flex; gap: 16px; margin-top: 20px; }
.total-pill    { flex: 1; padding: 12px 16px; border-radius: 10px; }
.total-pill-usd { background: #EBF4FF; border-left: 3px solid #667eea; }
.total-pill-cny { background: #ECFDF5; border-left: 3px solid #10B981; }
.total-pill-label { font-size: 8pt; font-weight: 700; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
.total-pill-value { font-size: 16pt; font-weight: 800; color: #2d3748; }
.cover-footer  { margin-top: 40px; padding-top: 20px; border-top: 1px solid #edf2f7; color: #a0aec0; font-size: 9pt; }

/* ── Cards page ────────────────────────────────────────────────────── */
.cards-page  { padding: 28px 32px; }
.page-header {
  font-size: 9pt; color: #a0aec0; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.8px;
  padding-bottom: 12px; border-bottom: 2px solid #667eea; margin-bottom: 18px;
}

/* ── Receipt card — base ────────────────────────────────────────────── */
.receipt-card {
  display: flex;
  flex-direction: row;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
  page-break-inside: avoid;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.07);
  min-height: 200px;
}

/* ── Single image column (no payment proof) ────────────────────────── */
.img-single {
  width: 190px;
  min-width: 190px;
  background: #f7f8fc;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
}
.img-single-label {
  font-size: 8pt; font-weight: 700; color: #718096;
  text-align: center; padding: 6px 0 5px;
  background: #fff; border-bottom: 1px solid #edf2f7;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.img-single img {
  width: 190px;
  flex: 1;
  min-height: 220px;
  object-fit: cover;
  object-position: center top;
  display: block;
}
.img-no-photo {
  flex: 1; min-height: 220px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: #cbd5e0; font-size: 28px;
}
.img-no-photo span { font-size: 9pt; color: #a0aec0; margin-top: 6px; }

/* ── Dual image columns (LEFT receipt | RIGHT payment proof) ────────── */
.img-pair {
  display: flex;
  flex-direction: row;
  width: 340px;
  min-width: 340px;
  border-right: 1px solid #e2e8f0;
}

.img-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f7f8fc;
}
.img-col + .img-col { border-left: 1px solid #e2e8f0; }

.img-col-label {
  font-size: 8pt; font-weight: 700; color: #718096;
  text-align: center; padding: 6px 0 5px;
  background: #fff; border-bottom: 1px solid #edf2f7;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.img-col img {
  width: 100%;
  flex: 1;
  min-height: 240px;
  object-fit: contain;        /* show full image, letterbox if needed */
  object-position: center top;
  display: block;
  background: #f0f2f5;
}
.img-col-empty {
  flex: 1; min-height: 240px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: #cbd5e0; font-size: 24px;
}
.img-col-empty span { font-size: 9pt; color: #a0aec0; margin-top: 6px; }

/* ── Card body (right column) ───────────────────────────────────────── */
.card-body {
  flex: 1;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.card-amount   { font-size: 20pt; font-weight: 800; color: #2d3748; letter-spacing: -0.5px; line-height: 1; }
.card-currency { font-size: 11pt; font-weight: 600; color: #718096; margin-left: 4px; }
.card-conv     { font-size: 10pt; color: #a0aec0; margin-top: 1px; }
.card-divider  { border: none; border-top: 1px solid #edf2f7; }
.card-field    { display: flex; flex-direction: column; gap: 2px; }
.field-label   { font-size: 8pt; font-weight: 700; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.8px; }
.field-value   { font-size: 10pt; font-weight: 500; color: #2d3748; }
.card-category { display: inline-block; font-size: 9pt; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
.card-seq      { font-size: 8pt; font-weight: 700; color: #a0aec0; margin-top: auto; padding-top: 8px; border-top: 1px solid #edf2f7; }

/* ── Match status ───────────────────────────────────────────────────── */
.match-section { border-radius: 8px; padding: 10px 12px; margin-top: 2px; }
.match-ok      { background: #D1FAE5; border: 1px solid #6EE7B7; }
.match-warn    { background: #FEE2E2; border: 1px solid #FCA5A5; }
.match-pending { background: #FEF3C7; border: 1px solid #FCD34D; }
.match-title   { font-size: 10pt; font-weight: 700; margin-bottom: 4px; }
.match-ok   .match-title { color: #065F46; }
.match-warn .match-title { color: #991B1B; }
.match-pending .match-title { color: #92400E; }
.match-detail  { font-size: 9pt; color: #4b5563; line-height: 1.4; }
.match-notes-label { font-size: 8pt; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 6px; margin-bottom: 2px; }
.match-notes-value { font-size: 9pt; color: #374151; font-style: italic; }
</style>
</head>
<body>

<!-- ══════════════ COVER PAGE ══════════════ -->
<div class="cover">
  <div class="cover-logo">🧾</div>
  <div class="cover-title">ReceiptSnap</div>
  <div class="cover-subtitle">报销收据汇总 · ${startStr} 至 ${endStr}</div>

  <div class="cover-meta">
    <div class="meta-card">
      <div class="meta-card-label">收据总数</div>
      <div class="meta-card-value">${receipts.length} 张</div>
    </div>
    <div class="meta-card">
      <div class="meta-card-label">导出日期</div>
      <div class="meta-card-value" style="font-size:13pt">${format(new Date(), 'yyyy年M月d日')}</div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-section">
      <h3>货币合计</h3>
      ${currencyRows || '<div style="color:#a0aec0;font-size:10pt">无数据</div>'}
    </div>
    <div class="summary-section">
      <h3>分类合计 (本位币)</h3>
      ${categoryRows || '<div style="color:#a0aec0;font-size:10pt">无数据</div>'}
    </div>
  </div>

  ${(totalCny ?? 0) > 0 ? `
  <div class="cover-totals">
    <div class="total-pill total-pill-cny"><div class="total-pill-label">合计（等值人民币）</div><div class="total-pill-value">¥${(totalCny as number).toFixed(2)}</div></div>
  </div>` : ''}

  <div class="cover-footer">
    由 ReceiptSnap 自动生成 · 共 ${receipts.length} 张收据
  </div>
</div>

<!-- ══════════════ RECEIPT CARDS ══════════════ -->
<div class="cards-page">
  <div class="page-header">收据明细 · ${startStr} 至 ${endStr}</div>
  ${receiptCards}
</div>

</body>
</html>`;
}

// ─── Single receipt card ──────────────────────────────────────────────────────

function buildReceiptCard(
  r: Receipt,
  imageMap: Record<string, string>,
  cnyVal: number | null,
): string {
  const cat      = r.category ?? 'other';
  const catLabel = CATEGORY_ZH[cat] ?? cat;
  const catColor = CATEGORY_COLOR[cat] ?? '#A0AEC0';
  const imgSrc   = imageMap[r.id];
  const paySrc   = r.payment_image_url ? imageMap[`payment_${r.id}`] : null;
  const hasProof = !!paySrc;

  // ── Image section ──────────────────────────────────────────────────────
  let imageSection: string;

  if (hasProof) {
    // LEFT-RIGHT layout: receipt | payment proof
    const receiptBlock = imgSrc
      ? `<img src="${imgSrc}" alt="收据" />`
      : `<div class="img-col-empty">🖼<span>无图片</span></div>`;

    const paymentBlock = `<img src="${paySrc}" alt="付款凭证" />`;

    imageSection = `
<div class="img-pair">
  <div class="img-col">
    <div class="img-col-label">📄 收据</div>
    ${receiptBlock}
  </div>
  <div class="img-col">
    <div class="img-col-label">💳 付款凭证</div>
    ${paymentBlock}
  </div>
</div>`;
  } else {
    // Single image
    const receiptBlock = imgSrc
      ? `<img src="${imgSrc}" alt="收据" />`
      : `<div class="img-no-photo">🖼<span>无图片</span></div>`;

    imageSection = `
<div class="img-single">
  <div class="img-single-label">📄 收据</div>
  ${receiptBlock}
</div>`;
  }

  // ── Conversion line (CNY equivalent only) ─────────────────────────────
  const convLines = cnyVal != null ? `≈ ¥${cnyVal.toFixed(2)} CNY` : '';

  // ── Match status section ───────────────────────────────────────────────
  let matchSection = '';
  if (hasProof) {
    const status = r.payment_match_status;

    if (status === 'matched') {
      matchSection = `
<div class="match-section match-ok">
  <div class="match-title">✓ 凭证金额已匹配</div>
  <div class="match-detail">收据与付款凭证金额在允许浮动范围内（±${Math.round(MATCH_TOLERANCE * 100)}%）</div>
</div>`;
    } else if (status === 'mismatch') {
      const notesBlock = r.notes
        ? `<div class="match-notes-label">差异说明</div><div class="match-notes-value">${escHtml(r.notes)}</div>`
        : `<div class="match-notes-label">差异说明</div><div class="match-notes-value" style="color:#9ca3af">（提交人未填写说明）</div>`;
      matchSection = `
<div class="match-section match-warn">
  <div class="match-title">⚠ 金额不符，请核实</div>
  <div class="match-detail">收据与凭证金额差异超过 ${Math.round(MATCH_TOLERANCE * 100)}%（含汇率浮动）</div>
  ${notesBlock}
</div>`;
    } else {
      // Proof exists but no match status computed yet
      matchSection = `
<div class="match-section match-pending">
  <div class="match-title">? 待财务核实</div>
  <div class="match-detail">系统未能自动完成金额比对</div>
</div>`;
    }
  }

  // ── Notes (only shown separately if no mismatch block already has them) ─
  const showSeparateNotes = r.notes && r.payment_match_status !== 'mismatch';
  const notesLine = showSeparateNotes
    ? `<div class="card-field">
         <div class="field-label">备注</div>
         <div class="field-value">${escHtml(r.notes!)}</div>
       </div>`
    : '';

  return `
<div class="receipt-card">
  ${imageSection}
  <div class="card-body">
    <div>
      <div class="card-amount">${r.amount.toLocaleString()}<span class="card-currency">${r.currency}</span></div>
      ${convLines ? `<div class="card-conv">${convLines}</div>` : ''}
    </div>
    ${matchSection}
    <hr class="card-divider"/>
    <div class="card-field">
      <div class="field-label">商户名称</div>
      <div class="field-value">${escHtml(r.description ?? '—')}</div>
    </div>
    <div class="card-field">
      <div class="field-label">日期</div>
      <div class="field-value">${r.date}</div>
    </div>
    <div class="card-field">
      <div class="field-label">分类</div>
      <div><span class="card-category" style="background:${catColor}20;color:${catColor}">${catLabel}</span></div>
    </div>
    ${notesLine}
    <div class="card-seq">编号 #${r.id.slice(-6).toUpperCase()}</div>
  </div>
</div>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
