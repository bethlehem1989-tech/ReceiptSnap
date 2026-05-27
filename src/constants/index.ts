export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const GOOGLE_VISION_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_VISION_API_KEY ?? '';
// Gemini API uses the same Google AI Studio key. v1.2.0 (23): smart routing
// abroad defaults to Gemini, so expose it under its proper name.
export const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_VISION_API_KEY ?? '';
export const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
export const QIANWEN_API_KEY = process.env.EXPO_PUBLIC_QIANWEN_API_KEY ?? '';

export const RECEIPT_CATEGORIES = [
  'meals',
  'transport',
  'accommodation',
  'entertainment',
  'office',
  'other',
] as const;

export const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HKD', 'SGD',
  'AUD', 'CAD', 'CHF', 'KRW', 'TWD', 'THB', 'MYR',
];

export const SUPABASE_BUCKETS = {
  RECEIPTS: 'receipts',
  THUMBNAILS: 'thumbnails',
} as const;

export const OCR_CONFIDENCE_THRESHOLD = 0.7;
