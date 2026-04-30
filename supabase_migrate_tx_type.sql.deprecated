-- Migration: add tx_type column to transactions table
-- Run this in Supabase SQL Editor

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS tx_type text DEFAULT 'out';
