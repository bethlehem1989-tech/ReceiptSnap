import * as FileSystem from 'expo-file-system/legacy';
import { SUPABASE_BUCKETS } from '../constants';
import { MonthlySummary, Receipt, ReceiptCategory } from '../types';
import { supabase } from './supabase';
import { convertToCny, convertToUsd } from './currency';

// ─── Local-first image storage ────────────────────────────────────────────
//
// Strategy:
//  1. Always copy the image to the app's document directory first.
//     This works offline, requires no Supabase Storage bucket, and
//     eliminates the base64 → atob() → charCodeAt() decode loop that
//     previously caused "RangeError: Maximum call stack size exceeded"
//     on Hermes when handling large camera photos.
//  2. Fire-and-forget cloud upload via fetch + Blob (no base64 at all).
//     Silently skips if bucket doesn't exist or network is unavailable.

const RECEIPTS_DIR = `${FileSystem.documentDirectory}receipts/`;

export async function uploadReceiptImage(
  localUri: string,
  _userId: string,
): Promise<string> {
  // Ensure receipts directory exists
  await FileSystem.makeDirectoryAsync(RECEIPTS_DIR, { intermediates: true });

  const filename = `receipt_${Date.now()}.jpg`;
  const localPath = `${RECEIPTS_DIR}${filename}`;

  // Copy to permanent location (cacheDirectory gets cleared; documentDirectory doesn't)
  await FileSystem.copyAsync({ from: localUri, to: localPath });

  // Best-effort cloud sync — never throws, never blocks the save flow
  syncToCloud(localPath, _userId).catch(() => {});

  return localPath; // ← stored as image_url in DB
}

/** Upload to Supabase Storage using fetch + Blob — zero base64 encoding */
async function syncToCloud(localPath: string, userId: string): Promise<void> {
  const filename = `${userId}/${Date.now()}.jpg`;
  // fetch() a file:// URI returns its bytes as a Blob — no base64 needed
  const response = await fetch(localPath);
  const blob = await response.blob();
  await supabase.storage
    .from(SUPABASE_BUCKETS.RECEIPTS)
    .upload(filename, blob, { contentType: 'image/jpeg', upsert: false });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

// Fields added in migration 004 — may not exist in older DB schemas.
// We detect schema errors from BOTH Postgres (code 42703) and PostgREST's
// schema-cache layer (code PGRST204 / message contains "schema cache").
const MIGRATION_004_FIELDS = ['payment_amount', 'payment_currency', 'payment_amount_cny'] as const;
// Fields added in migration 005 — stripped alongside 004 fields on any schema error.
const MIGRATION_005_FIELDS = ['is_draft'] as const;

function isMigration004Error(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  const msg = err.message ?? '';
  // PostgREST schema-cache message: "Could not find the 'payment_amount' column…"
  return msg.includes('schema cache') ||
    MIGRATION_004_FIELDS.some((f) => msg.includes(`'${f}'`)) ||
    MIGRATION_005_FIELDS.some((f) => msg.includes(`'${f}'`));
}

export async function createReceipt(
  receipt: Omit<Receipt, 'id' | 'created_at' | 'updated_at'>,
): Promise<Receipt> {
  const payload = stripNullish(receipt as Record<string, unknown>);

  let res = await supabase.from('receipts').insert(payload).select().single();

  // If migration 004/005 hasn't been applied, PostgREST rejects the new columns.
  // Retry with those columns stripped so the core save always succeeds.
  if (isMigration004Error(res.error)) {
    const fallback = { ...payload };
    for (const f of MIGRATION_004_FIELDS) delete fallback[f];
    for (const f of MIGRATION_005_FIELDS) delete fallback[f];
    res = await supabase.from('receipts').insert(fallback).select().single();
  }

  if (res.error) throw new Error(res.error.message ?? JSON.stringify(res.error));
  return res.data;
}

/** Remove keys whose value is undefined or null */
function stripNullish(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  );
}

export async function getReceipts(userId: string): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getReceiptsByDateRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function updateReceipt(
  id: string,
  updates: Partial<Receipt>,
): Promise<Receipt> {
  const payload = stripNullish({
    ...updates as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  });

  let res = await supabase.from('receipts').update(payload).eq('id', id).select().single();

  if (isMigration004Error(res.error)) {
    const fallback = { ...payload };
    for (const f of MIGRATION_004_FIELDS) delete fallback[f];
    for (const f of MIGRATION_005_FIELDS) delete fallback[f];
    res = await supabase.from('receipts').update(fallback).eq('id', id).select().single();
  }

  if (res.error) throw new Error(res.error.message ?? JSON.stringify(res.error));
  return res.data;
}

export async function deleteReceipt(id: string): Promise<void> {
  const { error } = await supabase.from('receipts').delete().eq('id', id);
  if (error) throw error;
}

// ─── Monthly Summary ──────────────────────────────────────────────────────

// ─── Shared summary computation ───────────────────────────────────────────

async function computeSummary(receipts: Receipt[]): Promise<Omit<MonthlySummary, 'year' | 'month'>> {
  const byCategory     = {} as Record<ReceiptCategory, number>;
  const byCategoryUsd  = {} as Record<ReceiptCategory, number>;
  const byCategoryCny  = {} as Record<ReceiptCategory, number>;
  const byCurrency     = {} as Record<string, number>;
  const byCurrencyUsd  = {} as Record<string, number>;
  const byCurrencyCny  = {} as Record<string, number>;
  let totalUsd = 0;
  let totalCny = 0;

  for (const r of receipts) {
    const cat = (r.category ?? 'other') as ReceiptCategory;

    // All amounts based on RECEIPT amount/currency.
    // payment_amount_cny is export-only and must never affect statistics.
    byCategory[cat]        = (byCategory[cat]        ?? 0) + r.amount;
    byCurrency[r.currency] = (byCurrency[r.currency] ?? 0) + r.amount;

    const usd = r.amount_usd != null
      ? r.amount_usd
      : (await convertToUsd(r.amount, r.currency)) ?? 0;
    totalUsd += usd;
    byCategoryUsd[cat]        = (byCategoryUsd[cat]        ?? 0) + usd;
    byCurrencyUsd[r.currency] = (byCurrencyUsd[r.currency] ?? 0) + usd;

    const cny = r.amount_cny != null
      ? r.amount_cny
      : (await convertToCny(r.amount, r.currency)) ?? 0;
    totalCny += cny;
    byCategoryCny[cat]        = (byCategoryCny[cat]        ?? 0) + cny;
    byCurrencyCny[r.currency] = (byCurrencyCny[r.currency] ?? 0) + cny;
  }

  return {
    totalUsd, totalCny,
    receiptCount: receipts.length,
    byCategory, byCategoryUsd, byCategoryCny,
    byCurrency, byCurrencyUsd, byCurrencyCny,
  };
}

export async function getMonthlySummary(
  userId: string,
  year: number,
  month: number,
): Promise<MonthlySummary> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const start   = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end     = `${year}-${pad(month)}-${pad(lastDay)}`;

  const receipts = await getReceiptsByDateRange(userId, start, end);
  const base     = await computeSummary(receipts);
  return { ...base, year, month };
}

/** Summarise receipts over any arbitrary date range (YYYY-MM-DD strings). */
export async function getDateRangeSummary(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<MonthlySummary> {
  const receipts = await getReceiptsByDateRange(userId, startDate, endDate);
  const base     = await computeSummary(receipts);
  return { ...base, year: 0, month: 0 }; // year/month unused for custom ranges
}

export async function addPaymentProof(
  id: string,
  paymentImageUrl: string,
  matchStatus: 'matched' | 'mismatch',
  notes?: string,
  paymentAmount?: number,
  paymentCurrency?: string,
  paymentAmountCny?: number,
): Promise<Receipt> {
  const updates: Partial<Receipt> = {
    payment_image_url: paymentImageUrl,
    payment_match_status: matchStatus,
  };
  if (notes !== undefined)            updates.notes = notes;
  if (paymentAmount !== undefined)    updates.payment_amount = paymentAmount;
  if (paymentCurrency !== undefined)  updates.payment_currency = paymentCurrency;
  if (paymentAmountCny !== undefined) updates.payment_amount_cny = paymentAmountCny;
  return updateReceipt(id, updates);
}
