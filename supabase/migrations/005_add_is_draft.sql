-- Migration 005: Add is_draft flag for draft/incomplete receipts
-- Run in Supabase Dashboard → SQL Editor
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS is_draft boolean DEFAULT false;
