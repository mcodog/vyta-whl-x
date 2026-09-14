-- Migration: Checkout configuration enhancements
-- Run this in the Supabase SQL editor

-- Add pickup_address and guest_checkout_enabled to site_settings
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS pickup_address TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_checkout_enabled BOOLEAN DEFAULT true;

-- Add per-customer fulfillment options to customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS allow_pickup BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_shipping BOOLEAN DEFAULT true;
