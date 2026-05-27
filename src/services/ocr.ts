/**
 * OCR service — provider-agnostic.
 *
 * Picks whichever provider the user configured in Settings (Qwen / OpenAI /
 * Anthropic / Gemini) and dispatches to the right HTTP shape. The user's
 * API key (or env-var fallback) comes from `aiProvider.ts`.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { OcrResult } from '../types';
import { preprocessReceiptImage } from '../utils/imagePreprocessing';
import { AI_PROVIDERS, AiProviderId, getActiveProvider } from './aiProvider';

// ─── Prompt ───────────────────────────────────────────────────────────────

const RECEIPT_PROMPT = `You are an expert receipt data extractor specialised in international business travel receipts.

Analyse this receipt image carefully. It may be thermal-printed, faded, low-contrast, blurry, tilted, photographed at an angle, partially shadowed, or printed on full-size A4 paper (Chinese 增值税专用发票 / 普通发票, hotel folio, airline itinerary, etc.). Mentally de-skew and de-blur as needed before reading. Do your best to extract all information.

CRITICAL — image orientation: the receipt content may appear rotated by 0°, 90°, 180°, or 270° relative to the image frame (this happens when the photographer holds the phone landscape vs. portrait for an A4 landscape invoice). Before extracting anything, identify which edge of the receipt is the top (look for headers like 发票, INVOICE, RECEIPT, the merchant logo, or the date line) and mentally rotate the page so reading direction is normal. Do NOT refuse to extract because content is sideways — re-orient and read.

Return ONLY a valid JSON object with exactly these fields:

{
  "date": "YYYY-MM-DD or null",
  "description": "merchant or store name in Simplified Chinese, or null",
  "amount": total amount as a number (not a string), or null,
  "currency": "ISO 4217 code e.g. USD JPY CNY EUR GBP HKD SGD AUD CAD CHF KRW TWD THB MYR, or null",
  "rawText": "all visible text you can read from the receipt",
  "confidence": a number from 0.0 to 1.0 reflecting how confident you are in the extracted fields
}

Rules:
- amount: use the grand TOTAL line (合計 / 总计 / 价税合计 / TOTAL / AMOUNT DUE / GRAND TOTAL), never subtotals or pre-tax amounts.
- currency: infer from country context, symbols (¥=JPY or CNY depending on country, $=USD, £=GBP, €=EUR, ₩=KRW, ฿=THB), or explicit ISO codes.
- date: convert any format (DD/MM/YYYY, MM-DD-YYYY, 令和 etc.) to YYYY-MM-DD.
- description: PREFER Simplified Chinese (简体中文). If the printed merchant name is in English or another language, translate or use the well-known Chinese name (e.g. "Starbucks" → "星巴克", "McDonald's" → "麦当劳", "Hilton" → "希尔顿酒店"). Only fall back to the original text when no Chinese rendering is possible. Never mix Chinese and English in the same name.
- A4 invoices (增值税发票 / 普通发票): the merchant is the "销售方" or "购销单位" block, NOT the "购买方". The total is the "价税合计" line in 大写 + 小写 form.
- If the image is tilted or partially cropped, still attempt extraction — partial reads are OK; reflect uncertainty via the confidence score.
- confidence: 1.0 = all four fields extracted with certainty, 0.5 = some fields uncertain, 0.0 = unreadable.
- Return ONLY the JSON object — no markdown fences, no explanation, no extra text.`;

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
  const processedUri = alreadyPreprocessed
    ? imageUri
    : await preprocessReceiptImage(imageUri);

  const base64 = await FileSystem.readAsStringAsync(processedUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const provider = await getActiveProvider();
  if (!provider.apiKey) {
    throw new Error(`未配置 ${provider.info.shortName} 的 API Key，请到「设置」里填写。`);
  }

  switch (provider.id) {
    case 'qwen':      return extractWithOpenAICompat(base64, provider.info.endpoint, provider.apiKey, provider.info.defaultModel);
    case 'openai':    return extractWithOpenAICompat(base64, provider.info.endpoint, provider.apiKey, provider.info.defaultModel);
    case 'anthropic': return extractWithAnthropic(base64, provider.apiKey, provider.info.defaultModel);
    case 'gemini':    return extractWithGemini(base64, provider.apiKey, provider.info.defaultModel);
  }
}

/**
 * Verify that a provider key works by sending a tiny vision request.
 * Used by the Settings screen's "Test key" button. Throws on failure.
 */
export async function testProviderKey(
  providerId: AiProviderId,
  apiKey: string,
): Promise<void> {
  if (!apiKey.trim()) throw new Error('请填写 API Key');
  const info = AI_PROVIDERS[providerId];

  // Minimal 1×1 white pixel
  const tinyPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEA4DvLrwAAAABJRU5ErkJggg==';

  switch (providerId) {
    case 'qwen':
    case 'openai':
      await extractWithOpenAICompat(tinyPng, info.endpoint, apiKey, info.defaultModel);
      return;
    case 'anthropic':
      await extractWithAnthropic(tinyPng, apiKey, info.defaultModel);
      return;
    case 'gemini':
      await extractWithGemini(tinyPng, apiKey, info.defaultModel);
      return;
  }
}

// ─── OpenAI-compatible (Qwen DashScope + OpenAI) ──────────────────────────

async function extractWithOpenAICompat(
  base64Image: string,
  endpoint: string,
  apiKey: string,
  model: string,
): Promise<OcrResult> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            { type: 'text', text: RECEIPT_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw await httpError(res, model);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  return parseResponse(text);
}

// ─── Anthropic (Claude messages API) ──────────────────────────────────────

async function extractWithAnthropic(
  base64Image: string,
  apiKey: string,
  model: string,
): Promise<OcrResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image,
              },
            },
            { type: 'text', text: RECEIPT_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw await httpError(res, model);
  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '';
  return parseResponse(text);
}

// ─── Google Gemini ────────────────────────────────────────────────────────

async function extractWithGemini(
  base64Image: string,
  apiKey: string,
  model: string,
): Promise<OcrResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: base64Image } },
            { text: RECEIPT_PROMPT },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) throw await httpError(res, model);
  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return parseResponse(text);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function httpError(res: Response, model: string): Promise<Error> {
  let body = '';
  try { body = await res.text(); } catch { /* ignore */ }

  // v1.2 #23 #24: translate common AI provider failures to friendly Chinese.
  // We avoid surfacing raw "请登录" or 503 stack traces to end-users.
  if (res.status === 503 || /unavailable|overloaded|temporar/i.test(body)) {
    return new Error(`AI 服务暂时繁忙，请稍后再试或在「设置」里换一个识别服务。`);
  }
  if (res.status === 429 || /rate.?limit|quota|exceed/i.test(body)) {
    return new Error(`AI 调用频率超限，请稍等几分钟再试，或在「设置」里更换 API Key。`);
  }
  if (res.status === 401 || res.status === 403 ||
      /unauthor|forbidden|invalid.*key|api.?key|sign.?in|请登录/i.test(body)) {
    return new Error(`AI 服务的 API Key 无效或已过期，请到「设置 → AI 服务」里重新填写。`);
  }
  if (res.status >= 500) {
    return new Error(`AI 服务异常 (${res.status})，请稍后再试。`);
  }
  // Generic fallback — keep status + first ~120 chars of body for diagnostics
  const tail = body.slice(0, 120).replace(/\s+/g, ' ').trim();
  return new Error(`识别失败 ${res.status} (${model})${tail ? ` — ${tail}` : ''}`);
}

function parseResponse(text: string): OcrResult {
  try {
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
    return { rawText: text, confidence: 0 };
  }
}
