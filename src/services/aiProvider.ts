/**
 * Multi-provider AI configuration store.
 *
 * The OCR layer (`ocr.ts`) used to be hard-coded to Qwen VL-Plus. This
 * module decouples that — the user can pick which provider runs OCR and
 * supply their own API key from the Settings screen. The provider's key
 * lives in AsyncStorage so it persists across sessions.
 *
 * If the user hasn't configured anything, we fall back to the built-in
 * EXPO_PUBLIC_QIANWEN_API_KEY env var (existing behavior, so the app
 * works out of the box).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, QIANWEN_API_KEY } from '../constants';

export type AiProviderId = 'qwen' | 'openai' | 'anthropic' | 'gemini';

export type AiProviderInfo = {
  id: AiProviderId;
  name: string;
  shortName: string;
  description: string;
  endpoint: string;
  defaultModel: string;
  /** URL where users can sign up to get a key. */
  keyUrl: string;
  /** Tip shown above the API key input. */
  keyHint: string;
};

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  qwen: {
    id: 'qwen',
    name: '通义千问 Qwen VL',
    shortName: 'Qwen',
    description: '阿里云大模型，对中文收据、票据识别效果好。默认推荐。',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-vl-plus',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    keyHint: '到 DashScope 控制台 → API-KEY 管理 → 创建新 KEY',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI GPT-4o',
    shortName: 'OpenAI',
    description: 'GPT-4o 视觉理解能力强，多语言收据识别稳定。',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Format: sk-... · 需要绑定信用卡',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    shortName: 'Claude',
    description: 'Claude 4 系列，对手写、模糊、热敏小票识别表现优秀。',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5-20251001',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Format: sk-ant-... · 需要 Console 充值',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    description: 'Google Gemini 2.5 多语言识别，免费额度较高。',
    endpoint:
      'https://generativelanguage.googleapis.com/v1beta/models',
    defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Format: AIza... · 在 Google AI Studio 创建',
  },
};

const STORAGE_KEY_PROVIDER = 'ai_provider_id';
const STORAGE_KEY_PREFIX_KEY = 'ai_provider_key_';

export type AiProviderConfig = {
  id: AiProviderId;
  apiKey: string; // empty string when relying on env-var fallback
  /** Resolved info bundled together for callers. */
  info: AiProviderInfo;
};

/**
 * v1.2.0 (23): smart-default the provider by user location.
 *
 * The target user is a Chinese business traveler abroad. From overseas the
 * DashScope (Qwen) endpoint is slow because it has no global CDN — a single
 * OCR can take 12-15s on a hotel WiFi. Gemini Flash, served from Google's
 * global edge, finishes in 2-4s anywhere outside mainland China.
 *
 * So: if the user has NOT explicitly chosen a provider, sniff the device
 * timezone. CN timezones → Qwen (fast in China). Anything else → Gemini.
 * The user can always override in Settings.
 */
const CHINA_TIMEZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Harbin',
  'Asia/Urumqi',
  'Asia/Kashgar',
  'PRC',
]);

function detectDefaultProvider(): AiProviderId {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && CHINA_TIMEZONES.has(tz)) return 'qwen';
    // Everywhere else: prefer Gemini if we have a baked-in key, otherwise Qwen.
    if (GEMINI_API_KEY) return 'gemini';
    return 'qwen';
  } catch {
    return 'qwen';
  }
}

/**
 * Whether the device appears to be outside mainland China. Used to:
 *  - default to Gemini (see detectDefaultProvider)
 *  - shrink upload size on slow overseas WiFi
 */
export function isLikelyOverseas(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return false;
    return !CHINA_TIMEZONES.has(tz);
  } catch {
    return false;
  }
}

/** Read the active provider config (id + api key). */
export async function getActiveProvider(): Promise<AiProviderConfig> {
  let id: AiProviderId = detectDefaultProvider();
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_PROVIDER);
    if (stored && (stored in AI_PROVIDERS)) id = stored as AiProviderId;
  } catch { /* ignore */ }

  const apiKey = await getProviderKey(id);
  return { id, apiKey, info: AI_PROVIDERS[id] };
}

/** Read just the API key for a provider, with env-var fallback. */
export async function getProviderKey(id: AiProviderId): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_PREFIX_KEY + id);
    if (stored) return stored;
  } catch { /* ignore */ }
  // Fallback to env-var keys baked at build time
  if (id === 'qwen') return QIANWEN_API_KEY;
  if (id === 'anthropic') return ANTHROPIC_API_KEY;
  // v1.2.0 (23): bake-in Gemini key so overseas users get an instant default
  if (id === 'gemini') return GEMINI_API_KEY;
  return '';
}

/** Persist the user's provider choice. */
export async function setActiveProvider(id: AiProviderId): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_PROVIDER, id);
}

/** Persist the user's API key for a provider. Empty string clears it. */
export async function setProviderKey(id: AiProviderId, apiKey: string): Promise<void> {
  if (!apiKey.trim()) {
    await AsyncStorage.removeItem(STORAGE_KEY_PREFIX_KEY + id);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY_PREFIX_KEY + id, apiKey.trim());
  }
}

/** Quick check that the active provider has *some* key (env or stored). */
export async function isProviderKeyAvailable(id?: AiProviderId): Promise<boolean> {
  const target = id ?? (await getActiveProvider()).id;
  const key = await getProviderKey(target);
  return key.length > 0;
}
