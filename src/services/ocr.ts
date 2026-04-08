import * as FileSystem from 'expo-file-system/legacy';
import { QIANWEN_API_KEY } from '../constants';
import { OcrResult } from '../types';
import { preprocessReceiptImage } from '../utils/imagePreprocessing';

const QIANWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

// ─── Prompt ───────────────────────────────────────────────────────────────

const RECEIPT_PROMPT = `You are an expert receipt data extractor specialised in international business travel receipts.

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

// ─── Main export ──────────────────────────────────────────────────────────

/**
 * Extract receipt data from an image URI.
 * Pass `alreadyPreprocessed: true` when the caller (e.g. CameraScreen) has
 * already run preprocessReceiptImage — avoids double-resizing.
 */
export async function extractReceiptData(
  imageUri: string,
  alreadyPreprocessed = false,
): Promise<OcrResult> {
  // Step 1 — preprocess only if not done upstream
  const processedUri = alreadyPreprocessed
    ? imageUri
    : await preprocessReceiptImage(imageUri);

  // Step 2 — read as base64
  const base64 = await FileSystem.readAsStringAsync(processedUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Step 3 — send to Qianwen Vision
  return await extractWithQianwen(base64);
}

// ─── Qianwen Vision ───────────────────────────────────────────────────────

async function extractWithQianwen(base64Image: string): Promise<OcrResult> {
  const response = await fetch(QIANWEN_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${QIANWEN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-vl-plus',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: RECEIPT_PROMPT,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Qianwen API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';

  return parseResponse(text);
}

// ─── Parser ───────────────────────────────────────────────────────────────

function parseResponse(text: string): OcrResult {
  try {
    // Strip markdown code fences if model adds them despite instructions
    const cleaned = text
      .replace(/^```(?:json)?\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      date: typeof parsed.date === 'string' && parsed.date !== 'null' ? parsed.date : undefined,
      description: typeof parsed.description === 'string' && parsed.description !== 'null' ? parsed.description : undefined,
      amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
      currency: typeof parsed.currency === 'string' && parsed.currency !== 'null' ? parsed.currency : undefined,
      rawText: typeof parsed.rawText === 'string' ? parsed.rawText : '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  } catch {
    // Couldn't parse JSON — return raw text at low confidence
    return {
      rawText: text,
      confidence: 0,
    };
  }
}
