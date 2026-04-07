# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start dev server (shows QR code for Expo Go)
npx expo start

# TypeScript type-check (zero output = no errors)
bunx tsc --noEmit

# Install dependencies
bun install
```

The project uses **bun** as the package manager (lock file is `bun.lockb`). Use `/Users/williamchaw/.bun/bin/bun` or `/Users/williamchaw/.bun/bin/bunx` if `bun`/`bunx` is not on PATH.

There is no lint script or test suite — TypeScript compilation (`tsc --noEmit`) is the primary correctness check.

## Tech Stack

- **Expo SDK 54** / React Native 0.81.5 / React 19.1.0 / TypeScript 5.9
- **Hermes** JavaScript engine (`newArchEnabled: true` in app.json)
- **Supabase** (Postgres + Auth + Storage) via `@supabase/supabase-js`
- **Claude Vision** (`claude-opus-4-5`) for OCR — not Google Vision API
- **date-fns** for date formatting; **expo-print** for PDF generation

## Environment Variables

All prefixed `EXPO_PUBLIC_` (loaded from `.env`):

```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_ANTHROPIC_API_KEY   # Claude Vision OCR
EXPO_PUBLIC_GOOGLE_VISION_API_KEY  # Defined but unused
```

## Architecture Overview

### Navigation (`src/navigation/index.tsx`)

Four-tab bottom navigator with Chinese labels:
- **拍照** → `CameraScreen` (landing page → camera → OCR → form)
- **收据** → Stack: `ReceiptsListScreen` → `ReceiptDetailScreen` / `EditReceiptScreen`
- **统计** → `MonthlyStatsScreen`
- **导出** → `ExportScreen`

`AuthScreen` exists (`src/screens/AuthScreen.tsx`) but is **not wired into navigation** — unused file.

### Receipt Lifecycle

**Camera / OCR path:**
```
CameraScreen (stage: idle → camera → ocr → form → saving)
  ↓ preprocessReceiptImage()   [resize to 800px, JPEG 0.88]
  ↓ extractReceiptData()        [Claude Vision → JSON]
  ↓ classifyReceiptCategory()   [keyword matching, en+zh]
  ↓ createReceipt()             [local file copy + async cloud sync]
```

**Manual entry path:**
```
CameraScreen (stage: idle → form → saving)
  handleManualEntry() clears all fields, sets stage = 'form' directly (no camera/OCR).
```

`handleSave(asDraft: boolean)` — when `asDraft=true`, skips required-field validation and defaults date to today if empty.

Draft receipts (`is_draft: true`) appear first in `ReceiptsListScreen` with amber styling, and open `EditReceiptScreen` instead of `ReceiptDetailScreen`.

### EditReceiptScreen (`src/screens/EditReceiptScreen.tsx`)

Pre-fills all form fields by querying Supabase directly (`select('*').eq('id', receiptId)`). Three save actions:
- **保存并完成** — validates date + amount, sets `is_draft: false`, recomputes `amount_cny` / `amount_usd`
- **保存草稿** — skips validation, keeps `is_draft: true`
- **删除收据** — calls `deleteReceipt()`, pops navigation

### CameraScreen Landing Page Logo

The logo badge is pure code — **no image file dependency**. Uses `Ionicons` (`@expo/vector-icons`) inside a `View`:
- Outer wrapper `logoViewfinder` (110×110): holds 4 absolutely-positioned L-shaped corner brackets (`Colors.primary` blue, 3px border, protruding 6px outside the badge)
- Inner `logoBadge` (110×110, `borderRadius: 28`, black background): contains `<Ionicons name="receipt-outline" size={52} color="#fff" />`

Do **not** replace this with `<Image source={require('../../assets/icon.png')}>` — the asset file may not exist on a fresh clone.

### Image Storage (Hermes-critical pattern)

```
uploadReceiptImage():
  1. Copy → FileSystem.documentDirectory/receipts/  ← permanent, used as image_url
  2. fetch(file://) → Blob → Supabase Storage        ← fire-and-forget, never blocks save
```

**Never** use `cacheDirectory` (cleared on restart). **Never** use base64 `atob()` / `charCodeAt()` loops — they cause stack overflow on Hermes with large images.

### Currency Conversion (`src/services/currency.ts`)

Three-tier cache: in-memory → AsyncStorage (1 h TTL) → `open.er-api.com` → `FALLBACK_RATES_USD` (73 currencies hardcoded, ensures KZT and other uncommon currencies always convert).

`getRates()` **never returns null** — the fallback constant guarantees this.

**Critical invariant**: All statistics use `amount_cny` (receipt amount). `payment_amount_cny` is export-only and must never appear in `computeSummary()` or any totals.

### Database Schema

Five cumulative migrations in `supabase/migrations/`:

| Migration | Adds |
|---|---|
| 001 | `receipts` table, RLS, index on `(user_id, date DESC)` |
| 002 | `amount_cny`, `payment_image_url` |
| 003 | `payment_match_status` (`'matched'` \| `'mismatch'`) |
| 004 | `payment_amount`, `payment_currency`, `payment_amount_cny` |
| 005 | `is_draft boolean DEFAULT false` |

**Schema compatibility**: `receipts.ts` detects PostgREST `PGRST204` and Postgres `42703` errors and retries `INSERT`/`UPDATE` with migration-004 and migration-005 columns stripped. This means the app works even if migrations 004/005 haven't been run yet.

### Export

- **CSV** (`src/services/export.ts`): UTF-8 BOM, 11-column detail + summary. Receipt CNY and payment CNY shown side-by-side.
- **PDF** (`src/services/exportPdf.ts`): expo-print HTML→PDF. Self-contained base64-embedded images. Left-right layout: receipt image | payment proof | details. Match badge uses ±8% tolerance.

## Key Patterns

### Error messages
Use `errMsg(err: unknown)` helper (defined in each screen that needs it) — `String(err)` and template literals produce `[object Object]` for Supabase error objects.

```typescript
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err)
    return String((err as any).message);
  return JSON.stringify(err);
}
```

### Abort/timeout (Hermes-safe)
Use `AbortController` + `setTimeout` pattern. Do **not** use `AbortSignal.timeout()` — unreliable on Hermes.

### Design system (`src/constants/theme.ts`)
PayPal 2024–2025 brand: `Colors.black (#000000)` for primary actions, `Colors.primary (#0070BA)` for accent/links only, white cards, no gradients. All screens use this token set — do not hardcode hex values.

### OCR stage cancellation
`cancelOcrRef.current = true` before calling `handleReset()` prevents the OCR callback from updating state after the user has navigated away.

## Supabase Setup Checklist

1. Run migrations 001–005 in SQL Editor
2. Create storage buckets: `receipts`, `thumbnails` (both private)
3. Enable **Anonymous sign-ins** (Auth → Sign In Methods)

The app uses anonymous auth exclusively — no email/password flow.
