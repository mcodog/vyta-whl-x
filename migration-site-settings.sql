-- Site Settings Table
-- Stores global site configuration including checkout type and admin emails

CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_type TEXT NOT NULL DEFAULT 'crypto' CHECK (checkout_type IN ('email', 'crypto')),
  admin_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only allow one row in the table
CREATE UNIQUE INDEX site_settings_singleton ON site_settings ((true));

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_site_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER site_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION update_site_settings_updated_at();

-- RLS policies
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON site_settings FOR ALL USING (true) WITH CHECK (true);

-- Insert default settings (will use email checkout and migrate existing admin email)
INSERT INTO site_settings (checkout_type, admin_emails)
VALUES ('email', '["codogmjo@gmail.com"]'::jsonb)
ON CONFLICT DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE site_settings IS 'Global site configuration - singleton table (only one row allowed)';
COMMENT ON COLUMN site_settings.checkout_type IS 'Checkout type: "email" for invoice-based or "crypto" for blockchain payments';
COMMENT ON COLUMN site_settings.admin_emails IS 'Array of admin email addresses for order notifications (JSONB)';
