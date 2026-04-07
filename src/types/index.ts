export interface Receipt {
  id: string;
  user_id: string;
  image_url: string;
  thumbnail_url?: string;
  date: string; // ISO 8601 date string
  description: string;
  amount: number;         // Receipt amount (always used for statistics)
  currency: string;       // Receipt currency
  amount_usd?: number;    // Receipt amount converted to USD (deprecated — kept for compatibility)
  amount_cny?: number;    // Receipt amount converted to CNY (used for all stats & totals)
  category?: ReceiptCategory;
  notes?: string;
  ocr_raw?: string;
  ocr_confidence?: number;
  // Payment proof fields
  payment_image_url?: string;
  payment_match_status?: 'matched' | 'mismatch';
  payment_amount?: number;      // Payment proof OCR'd amount
  payment_currency?: string;    // Payment proof OCR'd currency
  payment_amount_cny?: number;  // Payment proof amount converted to CNY (export only — NOT used for stats)
  is_draft?: boolean;           // True = saved as draft, incomplete; false/absent = complete
  created_at: string;
  updated_at: string;
}

export type ReceiptCategory =
  | 'meals'
  | 'transport'
  | 'accommodation'
  | 'entertainment'
  | 'office'
  | 'other';

export interface OcrResult {
  date?: string;
  description?: string;
  amount?: number;
  currency?: string;
  rawText: string;
  confidence: number;
}

export interface MonthlySummary {
  year: number;
  month: number; // 1-12
  totalUsd: number;
  totalCny: number;  // Always based on receipt amount (never payment amount)
  receiptCount: number;
  /** Native amounts per category (may mix currencies — use *Usd/*Cny for charts) */
  byCategory: Record<ReceiptCategory, number>;
  /** USD-equivalent total per category (based on receipt amount) */
  byCategoryUsd: Record<ReceiptCategory, number>;
  /** CNY-equivalent total per category (based on receipt amount) */
  byCategoryCny: Record<ReceiptCategory, number>;
  /** Native total per currency code */
  byCurrency: Record<string, number>;
  /** USD equivalent of each currency's total (based on receipt amount) */
  byCurrencyUsd: Record<string, number>;
  /** CNY equivalent of each currency's total (based on receipt amount) */
  byCurrencyCny: Record<string, number>;
}

export interface ExportOptions {
  startDate: Date;
  endDate: Date;
  includeImages: boolean;
  currencies: string[];
}

export interface User {
  id: string;
  email: string;
  full_name?: string;
  default_currency?: string;
}
