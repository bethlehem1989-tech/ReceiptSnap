#!/usr/bin/env node
/**
 * Real end-to-end test of the receipt OCR + payment-match flow.
 *
 * Usage:
 *   node tools/test-ocr.mjs <receipt.jpg> <payment.png>
 *
 * It:
 *   1. Reads both images
 *   2. Calls Qwen VL-Plus with the *same* prompt as src/services/ocr.ts
 *   3. Prints both parsed JSON results
 *   4. Fetches live USD-based FX rates and converts both amounts to CNY
 *   5. Prints the match verdict (matched / mismatch / undetermined) using the
 *      same 8 % tolerance the App uses.
 *
 * Reads EXPO_PUBLIC_QIANWEN_API_KEY from .env.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

// Load .env
function loadEnv() {
  const envPath = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}
loadEnv();

const QIANWEN_KEY = process.env.EXPO_PUBLIC_QIANWEN_API_KEY;
if (!QIANWEN_KEY) {
  console.error('EXPO_PUBLIC_QIANWEN_API_KEY not set in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node tools/test-ocr.mjs <receipt.jpg> <payment.png>');
  process.exit(1);
}
const [receiptPath, paymentPath] = args.map((p) => path.resolve(p));
for (const p of [receiptPath, paymentPath]) {
  if (!fs.existsSync(p)) { console.error(`File not found: ${p}`); process.exit(1); }
}

const PROMPT = `You are an expert receipt data extractor specialised in international business travel receipts.

Analyse this receipt image carefully. It may be thermal-printed, faded, low-contrast, or in a non-English language. Do your best to extract all information.

Return ONLY a valid JSON object with exactly these fields:

{
  "date": "YYYY-MM-DD or null",
  "description": "merchant or store name, or null",
  "amount": total amount as a number (not a string), or null,
  "currency": "ISO 4217 code e.g. USD JPY CNY EUR GBP HKD SGD AUD CAD CHF KRW TWD THB MYR, or null",
  "rawText": "all visible text you can read from the receipt",
  "confidence": a number from 0.0 to 1.0 reflecting how confident you are in the extracted fields
}

Rules:
- amount: use the grand TOTAL line (合計 / 总计 / TOTAL / AMOUNT DUE), never subtotals
- currency: infer from country context, symbols (¥=JPY or CNY depending on country, $=USD, £=GBP, €=EUR, ₩=KRW, ฿=THB), or explicit ISO codes
- date: convert any format (DD/MM/YYYY, MM-DD-YYYY, 令和 etc.) to YYYY-MM-DD
- confidence: 1.0 = all four fields extracted with certainty, 0.5 = some fields uncertain, 0.0 = unreadable
- Return ONLY the JSON object — no markdown fences, no explanation, no extra text`;

async function callQwen(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const b64 = buf.toString('base64');

  const res = await fetch(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${QIANWEN_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-vl-plus',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    },
  );
  if (!res.ok) throw new Error(`Qwen ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try { return JSON.parse(cleaned); }
  catch { return { error: 'parse-failed', raw: text }; }
}

async function getRates() {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  const json = await res.json();
  return json.rates;
}

function toCny(amount, currency, rates) {
  if (currency === 'CNY') return amount;
  if (!rates[currency] || !rates['CNY']) return null;
  return (amount / rates[currency]) * rates['CNY'];
}

(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' ReceiptSnap · OCR + payment-match end-to-end test');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('▶ Calling Qwen VL-Plus on receipt...');
  const t0 = Date.now();
  const receipt = await callQwen(receiptPath);
  console.log(`  done in ${Date.now() - t0}ms\n`);
  console.log('  Receipt OCR result:');
  console.log('  ' + JSON.stringify(receipt, null, 2).split('\n').join('\n  '));
  console.log();

  console.log('▶ Calling Qwen VL-Plus on payment proof...');
  const t1 = Date.now();
  const payment = await callQwen(paymentPath);
  console.log(`  done in ${Date.now() - t1}ms\n`);
  console.log('  Payment OCR result:');
  console.log('  ' + JSON.stringify(payment, null, 2).split('\n').join('\n  '));
  console.log();

  if (!receipt.amount || !receipt.currency || !payment.amount || !payment.currency) {
    console.log('⚠ One of the OCR results is missing amount/currency. Cannot match.');
    return;
  }

  console.log('▶ Fetching live FX rates...');
  const rates = await getRates();
  const receiptCny = toCny(receipt.amount, receipt.currency, rates);
  const paymentCny = toCny(payment.amount, payment.currency, rates);
  console.log(`  Receipt: ${receipt.amount} ${receipt.currency} ≈ ¥${receiptCny?.toFixed(2)} CNY`);
  console.log(`  Payment: ${payment.amount} ${payment.currency} ≈ ¥${paymentCny?.toFixed(2)} CNY\n`);

  if (receiptCny == null || paymentCny == null || receiptCny <= 0) {
    console.log('⚠ Could not compute CNY values. Match undetermined.');
    return;
  }

  const diffPct = Math.abs(receiptCny - paymentCny) / receiptCny;
  const status = diffPct <= 0.08 ? 'matched' : 'mismatch';

  console.log('═══════════════════════════════════════════════════════════');
  console.log(` Verdict: ${status === 'matched' ? '✓ MATCHED' : '⚠ MISMATCH'}`);
  console.log(`  Receipt CNY:  ¥${receiptCny.toFixed(2)}`);
  console.log(`  Payment CNY:  ¥${paymentCny.toFixed(2)}`);
  console.log(`  Difference:   ${(diffPct * 100).toFixed(2)}%  (tolerance 8%)`);
  console.log('═══════════════════════════════════════════════════════════');
})();
