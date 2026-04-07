-- Migration 004: Store payment proof OCR amounts for export transparency
--
-- These columns capture the amount read from the payment proof image so that
-- exported CSV files can show BOTH the receipt CNY equivalent and the payment
-- CNY equivalent side-by-side.
--
-- IMPORTANT: Statistics (monthly totals, category breakdowns) always use the
-- receipt amount (the `amount` / `amount_cny` columns). These payment columns
-- are export-only and must NOT be used to compute any aggregate totals.

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS payment_amount    numeric(12,2),   -- OCR'd payment amount (native currency)
  ADD COLUMN IF NOT EXISTS payment_currency  text,            -- OCR'd payment currency code
  ADD COLUMN IF NOT EXISTS payment_amount_cny numeric(12,2);  -- payment amount converted to CNY
