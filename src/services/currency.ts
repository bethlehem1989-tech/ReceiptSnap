/**
 * Currency conversion service.
 *
 * Strategy (three-tier):
 *  1. In-memory cache (fastest, same process lifetime)
 *  2. AsyncStorage cache (1-hour TTL, survives app restarts)
 *  3. Live fetch from open.er-api.com (free, no API key, covers 150+ currencies)
 *
 * If all three fail (offline with empty cache), fall back to FALLBACK_RATES
 * so that uncommon currencies like KZT still get a reasonable conversion
 * instead of being silently dropped.
 *
 * All rates are stored as "units of that currency per 1 USD".
 * To convert X of currency C to CNY:
 *   usd_amount = X / rates[C]
 *   cny_amount = usd_amount * rates['CNY']
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const RATES_CACHE_KEY = 'fx_rates_cache';
const RATES_TTL_MS    = 60 * 60 * 1000; // 1 hour

interface RatesCache {
  fetchedAt: number;
  rates: Record<string, number>; // keyed by currency code, value = units per 1 USD
}

let memCache: RatesCache | null = null;

// ─── Fallback rates (units per 1 USD) ────────────────────────────────────────
//
// Used ONLY when the live API is unavailable AND AsyncStorage has nothing.
// Approximate mid-market rates — good enough for expense reporting.
// Update periodically, or rely on the live API in normal conditions.
//
// KZT: 483 → 7.25 / 483 ≈ 0.01500 CNY/KZT → KZT 11,050 ≈ ¥165.75

const FALLBACK_RATES_USD: Record<string, number> = {
  USD: 1,
  CNY: 7.25,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 150.0,
  HKD: 7.78,
  KRW: 1350.0,
  SGD: 1.34,
  AUD: 1.55,
  CAD: 1.36,
  CHF: 0.90,
  TWD: 32.0,
  THB: 35.0,
  MYR: 4.70,
  INR: 83.0,
  KZT: 483.0,   // ≈ 0.015 CNY per KZT
  RUB: 90.0,
  MXN: 17.0,
  BRL: 5.0,
  ZAR: 18.5,
  SEK: 10.5,
  NOK: 10.7,
  DKK: 6.9,
  NZD: 1.65,
  AED: 3.67,
  SAR: 3.75,
  TRY: 32.0,
  IDR: 15600.0,
  PHP: 56.0,
  VND: 24500.0,
  PKR: 280.0,
  BDT: 110.0,
  UZS: 12600.0,
  MNT: 3400.0,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** Convert `amount` in `fromCurrency` to USD. Returns null if the currency is unknown. */
export async function convertToUsd(amount: number, fromCurrency: string): Promise<number | null> {
  if (fromCurrency === 'USD') return amount;
  const rates = await getRates();
  const rate = rates[fromCurrency];
  if (!rate) return null;
  return amount / rate;
}

/** Convert `amount` in `fromCurrency` to CNY. Returns null if the currency is unknown. */
export async function convertToCny(amount: number, fromCurrency: string): Promise<number | null> {
  if (fromCurrency === 'CNY') return amount;
  const rates = await getRates();
  const fromRate = rates[fromCurrency];
  const cnyRate  = rates['CNY'];
  if (!fromRate || !cnyRate) return null;
  return (amount / fromRate) * cnyRate;
}

/** Convert `amount` from any currency to another. Returns null if either currency is unknown. */
export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
): Promise<number | null> {
  if (fromCurrency === toCurrency) return amount;
  const rates = await getRates();
  const fromRate = fromCurrency === 'USD' ? 1 : rates[fromCurrency];
  const toRate   = toCurrency   === 'USD' ? 1 : rates[toCurrency];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

/**
 * Returns true if the live rate table (or fallback) contains this currency.
 * Useful to show a "rate unavailable" warning in the UI.
 */
export async function isCurrencySupported(currency: string): Promise<boolean> {
  if (currency === 'USD') return true;
  const rates = await getRates();
  return rates != null && currency in rates;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function getRates(): Promise<Record<string, number>> {
  // 1. Check in-memory cache
  if (memCache && Date.now() - memCache.fetchedAt < RATES_TTL_MS) {
    return memCache.rates;
  }

  // 2. Check AsyncStorage cache
  try {
    const raw = await AsyncStorage.getItem(RATES_CACHE_KEY);
    if (raw) {
      const parsed: RatesCache = JSON.parse(raw);
      if (Date.now() - parsed.fetchedAt < RATES_TTL_MS) {
        memCache = parsed;
        return parsed.rates;
      }
    }
  } catch { /* ignore */ }

  // 3. Fetch from network (manual timeout — AbortSignal.timeout not reliable on Hermes)
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
    } finally {
      clearTimeout(tid);
    }
    const json = await res.json();
    if (json.result !== 'success') throw new Error('bad result');

    const liveRates = json.rates as Record<string, number>;
    // Merge fallback so that any currency in FALLBACK but missing from live API
    // (extremely rare) still works
    const merged = { ...FALLBACK_RATES_USD, ...liveRates };

    const cache: RatesCache = { fetchedAt: Date.now(), rates: merged };
    memCache = cache;
    await AsyncStorage.setItem(RATES_CACHE_KEY, JSON.stringify(cache));
    return merged;
  } catch {
    // Network unavailable — use fallback rates so amounts are never silently 0
    return FALLBACK_RATES_USD;
  }
}
