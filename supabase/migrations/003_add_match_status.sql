-- Add payment match status column
alter table public.receipts
  add column if not exists payment_match_status text
    check (payment_match_status in ('matched', 'mismatch'));
