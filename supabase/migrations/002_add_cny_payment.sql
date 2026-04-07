-- Add CNY equivalent amount column
alter table public.receipts
  add column if not exists amount_cny numeric(12, 2);

-- Add payment screenshot URL column
alter table public.receipts
  add column if not exists payment_image_url text;
