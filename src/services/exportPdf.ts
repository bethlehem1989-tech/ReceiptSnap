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

import { format } from 'date-fns';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { ExportOptions, Receipt } from '../types';
import { getActiveProvider } from './aiProvider';
import { convertToCny } from './currency';
import { getReceiptsForExport } from './receipts';

const CATEGORY_ZH: Record<string, string> = {
  meals: '餐饮', transport: '交通', accommodation: '住宿',
  entertainment: '娱乐', office: '办公', other: '其他',
};

// Cream-paper-friendly category colors (mirror src/constants/theme.ts)
const CATEGORY_COLOR: Record<string, string> = {
  meals: '#C26144', transport: '#3F6E8A', accommodation: '#7A5C9D',
  entertainment: '#3F7B5A', office: '#5E6B5E', other: '#8B8B7E',
};

/** Tolerance for amount matching (8% covers FX fluctuation + payment fees) */
const MATCH_TOLERANCE = 0.08;

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportReceiptsToPdf(
  userId: string,
  options: ExportOptions,
): Promise<void> {
  const startStr = format(options.startDate, 'yyyy-MM-dd');
  const endStr   = format(options.endDate,   'yyyy-MM-dd');

  // v1.2 fix #21: exclude drafts +金额不符凭证 from the report
  const receipts = await getReceiptsForExport(userId, startStr, endStr);

  if (receipts.length === 0) {
    throw new Error('该时间段内没有可导出的收据（草稿与金额不符的票据已自动排除）');
  }

  const imageMap = await loadImages(receipts);

  const resolvedCny = await Promise.all(
    receipts.map((r) => (r as any).amount_cny != null
      ? Promise.resolve((r as any).amount_cny as number)
      : convertToCny(r.amount, r.currency)),
  );

  const provider = await getActiveProvider();
  const html = buildHtml(receipts, imageMap, resolvedCny, startStr, endStr, provider.info.shortName);

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
  providerName: string,
): string {
  const byCurrency: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byCategoryCny: Record<string, number> = {};
  receipts.forEach((r, i) => {
    byCurrency[r.currency] = (byCurrency[r.currency] ?? 0) + r.amount;
    const cat = r.category ?? 'other';
    byCategory[cat] = (byCategory[cat] ?? 0) + r.amount;
    byCategoryCny[cat] = (byCategoryCny[cat] ?? 0) + (resolvedCny[i] ?? 0);
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
      return `<div class="stat-row"><span class="cat-badge" style="background:${color}22;color:${color}">${CATEGORY_ZH[cat] ?? cat}</span><span class="stat-amt">${total.toLocaleString()}</span></div>`;
    }).join('');

  // Pie chart segments using conic-gradient (no chart library needed)
  const pieSegments = buildPieGradient(byCategoryCny, totalCny);
  const pieLegend = Object.entries(byCategoryCny)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, v]) => {
      const color = CATEGORY_COLOR[cat] ?? '#A0AEC0';
      const pct = totalCny > 0 ? (v / totalCny * 100).toFixed(0) : '0';
      return `<div class="pie-legend-row">
        <span class="pie-legend-dot" style="background:${color}"></span>
        <span class="pie-legend-name">${CATEGORY_ZH[cat] ?? cat}</span>
        <span class="pie-legend-val">¥${v.toFixed(2)}</span>
        <span class="pie-legend-pct">${pct}%</span>
      </div>`;
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
  font-family: -apple-system, "PingFang SC", "Hiragino Sans", "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  color: #1A1A18;
  background: #fff;
}

/* ── Cover ─────────────────────────────────────────────────────────── */
.cover {
  width: 100%;
  min-height: 100vh;
  padding: 56px 44px 44px;
  display: flex;
  flex-direction: column;
  page-break-after: always;
  background: linear-gradient(135deg, #F4EFE3 0%, #FFFFFF 40%, #E8DEC7 100%);
}

.cover-brand-row {
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 36px;
}
.cover-mark {
  width: 56px; height: 56px;
  background: #1A1A18; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28px; font-weight: 800;
  letter-spacing: -1px;
}
.cover-brand-name { font-size: 20pt; font-weight: 800; color: #1A1A18; letter-spacing: -0.5px; }
.cover-brand-sub  { font-size: 10pt; color: #5A5A52; margin-top: 2px; }

.cover-title    { font-size: 30pt; font-weight: 800; color: #1A1A18; letter-spacing: -1.2px; margin-bottom: 8px; }
.cover-subtitle { font-size: 12pt; color: #5A5A52; margin-bottom: 36px; }

/* CNY hero strip */
.total-strip {
  background: #2D4A3D; color: #fff;
  border-radius: 22px;
  padding: 22px 26px;
  margin-bottom: 32px;
  display: flex; justify-content: space-between; align-items: flex-end;
}
.total-strip-left { font-size: 9pt; color: rgba(255,255,255,0.65); font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
.total-strip-amt { font-size: 28pt; font-weight: 800; color: #fff; letter-spacing: -1.2px; margin-top: 4px; }
.total-strip-right { text-align: right; }
.total-strip-count { font-size: 9pt; color: rgba(255,255,255,0.65); font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
.total-strip-count-val { font-size: 18pt; font-weight: 800; color: #fff; margin-top: 4px; }

.meta-row { display: flex; gap: 14px; margin-bottom: 28px; }
.meta-card {
  background: rgba(255,255,255,0.65);
  border: 1px solid rgba(60,60,67,0.10);
  border-radius: 14px;
  padding: 14px 18px;
  flex: 1;
}
.meta-card-label { font-size: 9pt; font-weight: 700; color: #8B8B7E; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
.meta-card-value { font-size: 13pt; font-weight: 800; color: #1A1A18; }

/* Pie + summary */
.summary-row {
  display: flex;
  gap: 20px;
  margin-bottom: 24px;
}
.pie-card {
  flex: 1;
  background: rgba(255,255,255,0.7);
  border: 1px solid rgba(60,60,67,0.10);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.pie-chart-wrap {
  position: relative;
  width: 130px; height: 130px;
  flex-shrink: 0;
}
.pie-chart {
  width: 130px; height: 130px;
  border-radius: 50%;
}
.pie-hole {
  position: absolute;
  top: 50%; left: 50%;
  width: 76px; height: 76px;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.pie-hole-label { font-size: 7pt; color: #8B8B7E; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
.pie-hole-value { font-size: 10pt; color: #1A1A18; font-weight: 800; margin-top: 2px; }
.pie-legend { flex: 1; }
.pie-legend-row {
  display: flex; align-items: center;
  padding: 4px 0;
  font-size: 9pt;
}
.pie-legend-dot { width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; }
.pie-legend-name { color: #3C3C43; font-weight: 600; flex: 1; }
.pie-legend-val { color: #1A1A18; font-weight: 700; margin-right: 8px; }
.pie-legend-pct { color: #8B8B7E; width: 28px; text-align: right; }

.summary-grid  { display: flex; gap: 14px; }
.summary-section {
  flex: 1;
  background: rgba(255,255,255,0.7);
  border: 1px solid rgba(60,60,67,0.10);
  border-radius: 14px;
  padding: 16px;
}
.summary-section h3 { font-size: 9pt; font-weight: 700; color: #8B8B7E; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; }
.stat-row      { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(60,60,67,0.06); }
.stat-row:last-child { border-bottom: none; }
.stat-cur      { font-size: 10pt; font-weight: 700; color: #2D4A3D; background: rgba(45,74,61,0.10); padding: 2px 8px; border-radius: 6px; }
.stat-amt      { font-size: 10pt; font-weight: 700; color: #1A1A18; }
.cat-badge     { font-size: 9pt; font-weight: 700; padding: 2px 9px; border-radius: 20px; }

.cover-footer {
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid rgba(60,60,67,0.08);
  color: #8B8B7E;
  font-size: 9pt;
  display: flex;
  justify-content: space-between;
}

/* ── Cards page ────────────────────────────────────────────────────── */
.cards-page  { padding: 26px 30px; }
.page-header {
  font-size: 9pt; color: #8B8B7E; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.8px;
  padding-bottom: 12px; border-bottom: 2px solid #2D4A3D; margin-bottom: 18px;
}

/* ── Receipt card ────────────────────────────────────────────────────── */
.receipt-card {
  display: flex;
  flex-direction: row;
  border: 1px solid rgba(60,60,67,0.10);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 14px;
  page-break-inside: avoid;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
  min-height: 200px;
}

.img-single {
  width: 190px;
  min-width: 190px;
  background: #FAFAFC;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(60,60,67,0.08);
}
.img-single-label {
  font-size: 8pt; font-weight: 700; color: #5A5A52;
  text-align: center; padding: 6px 0 5px;
  background: #fff; border-bottom: 1px solid rgba(60,60,67,0.06);
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
  color: #C7C0AE; font-size: 28px;
}
.img-no-photo span { font-size: 9pt; color: #8B8B7E; margin-top: 6px; }

.img-pair {
  display: flex;
  flex-direction: row;
  width: 340px;
  min-width: 340px;
  border-right: 1px solid rgba(60,60,67,0.08);
}

.img-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #FAFAFC;
}
.img-col + .img-col { border-left: 1px solid rgba(60,60,67,0.08); }

.img-col-label {
  font-size: 8pt; font-weight: 700; color: #5A5A52;
  text-align: center; padding: 6px 0 5px;
  background: #fff; border-bottom: 1px solid rgba(60,60,67,0.06);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.img-col img {
  width: 100%;
  flex: 1;
  min-height: 240px;
  object-fit: contain;
  object-position: center top;
  display: block;
  background: #F2F2F7;
}
.img-col-empty {
  flex: 1; min-height: 240px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: #C7C0AE; font-size: 24px;
}
.img-col-empty span { font-size: 9pt; color: #8B8B7E; margin-top: 6px; }

.card-body {
  flex: 1;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.card-amount   { font-size: 22pt; font-weight: 800; color: #1A1A18; letter-spacing: -0.8px; line-height: 1; }
.card-currency { font-size: 11pt; font-weight: 600; color: #5A5A52; margin-left: 4px; }
.card-conv     { font-size: 10pt; color: #8B8B7E; margin-top: 2px; }
.card-divider  { border: none; border-top: 1px solid rgba(60,60,67,0.06); }
.card-field    { display: flex; flex-direction: column; gap: 2px; }
.field-label   { font-size: 8pt; font-weight: 700; color: #8B8B7E; text-transform: uppercase; letter-spacing: 0.8px; }
.field-value   { font-size: 10pt; font-weight: 500; color: #1A1A18; }
.card-category { display: inline-block; font-size: 9pt; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
.card-seq      { font-size: 8pt; font-weight: 700; color: #8B8B7E; margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(60,60,67,0.06); }

/* ── Match status ───────────────────────────────────────────────────── */
.match-section { border-radius: 8px; padding: 10px 12px; margin-top: 2px; }
.match-ok      { background: rgba(52,199,89,0.10); border: 1px solid rgba(52,199,89,0.35); }
.match-warn    { background: rgba(255,69,58,0.10); border: 1px solid rgba(255,69,58,0.35); }
.match-pending { background: rgba(255,159,10,0.10); border: 1px solid rgba(255,159,10,0.35); }
.match-title   { font-size: 10pt; font-weight: 700; margin-bottom: 4px; }
.match-ok   .match-title { color: #066B36; }
.match-warn .match-title { color: #B91C1C; }
.match-pending .match-title { color: #92400E; }
.match-detail  { font-size: 9pt; color: #3C3C43; line-height: 1.4; }
.match-notes-label { font-size: 8pt; font-weight: 700; color: #5A5A52; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 6px; margin-bottom: 2px; }
.match-notes-value { font-size: 9pt; color: #3C3C43; font-style: italic; }
</style>
</head>
<body>

<!-- ══════════════ COVER ══════════════ -->
<div class="cover">
  <div class="cover-brand-row">
    <div class="cover-mark">R</div>
    <div>
      <div class="cover-brand-name">ReceiptSnap</div>
      <div class="cover-brand-sub">报销凭证一站管理</div>
    </div>
  </div>

  <div class="cover-title">报销明细汇总</div>
  <div class="cover-subtitle">${startStr} 至 ${endStr}</div>

  ${(totalCny ?? 0) > 0 ? `
  <div class="total-strip">
    <div class="total-strip-left">
      合计（等值人民币）
      <div class="total-strip-amt">¥${(totalCny as number).toFixed(2)}</div>
    </div>
    <div class="total-strip-right">
      <div class="total-strip-count">收据张数</div>
      <div class="total-strip-count-val">${receipts.length}</div>
    </div>
  </div>` : ''}

  <div class="meta-row">
    <div class="meta-card">
      <div class="meta-card-label">导出日期</div>
      <div class="meta-card-value">${format(new Date(), 'yyyy年M月d日')}</div>
    </div>
    <div class="meta-card">
      <div class="meta-card-label">收据张数</div>
      <div class="meta-card-value">${receipts.length} 张</div>
    </div>
    <div class="meta-card">
      <div class="meta-card-label">币种数量</div>
      <div class="meta-card-value">${Object.keys(byCurrency).length}</div>
    </div>
  </div>

  ${pieSegments && totalCny > 0 ? `
  <div class="summary-row">
    <div class="pie-card">
      <div class="pie-chart-wrap">
        <div class="pie-chart" style="background: ${pieSegments};"></div>
        <div class="pie-hole">
          <div class="pie-hole-label">CNY</div>
          <div class="pie-hole-value">¥${(totalCny as number).toFixed(0)}</div>
        </div>
      </div>
      <div class="pie-legend">
        ${pieLegend}
      </div>
    </div>
  </div>` : ''}

  <div class="summary-grid">
    <div class="summary-section">
      <h3>货币合计</h3>
      ${currencyRows || '<div style="color:#8B8B7E;font-size:10pt">无数据</div>'}
    </div>
    <div class="summary-section">
      <h3>分类合计 (本位币)</h3>
      ${categoryRows || '<div style="color:#8B8B7E;font-size:10pt">无数据</div>'}
    </div>
  </div>

  <div class="cover-footer">
    <span>由 ReceiptSnap 自动生成 · ${providerName} 识别</span>
    <span>共 ${receipts.length} 张收据</span>
  </div>
</div>

<!-- ══════════════ RECEIPTS ══════════════ -->
<div class="cards-page">
  <div class="page-header">收据明细 · ${startStr} 至 ${endStr}</div>
  ${receiptCards}
</div>

</body>
</html>`;
}

/**
 * Build a CSS conic-gradient string for a donut/pie chart over the
 * non-zero category amounts. Returns empty string if no data.
 */
function buildPieGradient(byCategoryCny: Record<string, number>, total: number): string {
  if (total <= 0) return '';
  const segments = Object.entries(byCategoryCny)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  if (segments.length === 0) return '';

  let cursor = 0;
  const stops: string[] = [];
  for (const [cat, value] of segments) {
    const color = CATEGORY_COLOR[cat] ?? '#A0AEC0';
    const pct = (value / total) * 100;
    const start = cursor;
    const end = cursor + pct;
    stops.push(`${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    cursor = end;
  }
  // close out any rounding gap to exactly 100%
  if (cursor < 100) {
    stops[stops.length - 1] = stops[stops.length - 1].replace(/[\d.]+%$/, '100%');
  }
  return `conic-gradient(${stops.join(', ')})`;
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

  let imageSection: string;
  if (hasProof) {
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
    const receiptBlock = imgSrc
      ? `<img src="${imgSrc}" alt="收据" />`
      : `<div class="img-no-photo">🖼<span>无图片</span></div>`;
    imageSection = `
<div class="img-single">
  <div class="img-single-label">📄 收据</div>
  ${receiptBlock}
</div>`;
  }

  const convLines = cnyVal != null ? `≈ ¥${cnyVal.toFixed(2)} CNY` : '';

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
      matchSection = `
<div class="match-section match-pending">
  <div class="match-title">? 待财务核实</div>
  <div class="match-detail">系统未能自动完成金额比对</div>
</div>`;
    }
  }

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
      <div><span class="card-category" style="background:${catColor}22;color:${catColor}">${catLabel}</span></div>
    </div>
    ${notesLine}
    <div class="card-seq">编号 #${r.id.slice(-6).toUpperCase()}</div>
  </div>
</div>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
