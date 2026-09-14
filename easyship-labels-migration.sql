-- Easyship label fields on orders (printable shipping labels)
-- Run in the Supabase SQL editor.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS label_state TEXT,   -- not_created | pending | generated | failed
  ADD COLUMN IF NOT EXISTS label_url TEXT;     -- PDF URL once generated
