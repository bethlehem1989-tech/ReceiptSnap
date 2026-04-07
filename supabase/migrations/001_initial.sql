-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Receipts table
create table public.receipts (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  image_url     text not null,
  thumbnail_url text,
  date          date not null,
  description   text not null default '',
  amount        numeric(12, 2) not null,
  currency      char(3) not null default 'USD',
  amount_usd    numeric(12, 2),
  category      text check (category in ('meals','transport','accommodation','entertainment','office','other')),
  notes         text,
  ocr_raw       text,
  ocr_confidence real,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Row-level security: users can only see their own receipts
alter table public.receipts enable row level security;

create policy "Users can manage own receipts"
  on public.receipts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast date-range queries
create index receipts_user_date_idx on public.receipts (user_id, date desc);

-- Storage buckets (run via Supabase dashboard or CLI)
-- insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);
-- insert into storage.buckets (id, name, public) values ('thumbnails', 'thumbnails', false);
