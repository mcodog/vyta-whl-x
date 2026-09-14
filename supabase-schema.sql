-- Northern Peptides Affiliate System Database Schema
-- Run this SQL in your Supabase SQL Editor

-- 1. Affiliates Table
-- Stores affiliate user information and wallet addresses for payouts
CREATE TABLE IF NOT EXISTS affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  wallet_address VARCHAR(42), -- Ethereum wallet address for crypto payouts
  password_hash TEXT NOT NULL, -- Store hashed passwords
  active BOOLEAN DEFAULT true,
  total_earnings DECIMAL(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Referral Codes Table
-- Stores unique referral codes for each affiliate
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  code VARCHAR(8) UNIQUE NOT NULL,
  active BOOLEAN DEFAULT true,
  uses_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate FOREIGN KEY (affiliate_id) REFERENCES affiliates(id)
);

-- 3. Commissions Table
-- Tracks commissions from orders
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  order_id VARCHAR(255) NOT NULL, -- Reference to order in your orders system
  referral_code_id UUID REFERENCES referral_codes(id),
  amount DECIMAL(10, 2) NOT NULL,
  order_total DECIMAL(10, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) DEFAULT 10.00, -- 10% commission rate
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_affiliate_commission FOREIGN KEY (affiliate_id) REFERENCES affiliates(id),
  CONSTRAINT fk_referral_code FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_affiliates_email ON affiliates(email);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_affiliate ON referral_codes(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_order ON commissions(order_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to affiliates table
CREATE TRIGGER update_affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to update affiliate total_earnings when commission is paid
CREATE OR REPLACE FUNCTION update_affiliate_earnings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    UPDATE affiliates
    SET total_earnings = total_earnings + NEW.amount
    WHERE id = NEW.affiliate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply earnings update trigger
CREATE TRIGGER update_earnings_on_commission_paid
  AFTER UPDATE ON commissions
  FOR EACH ROW
  EXECUTE FUNCTION update_affiliate_earnings();

-- Function to increment referral code usage count
CREATE OR REPLACE FUNCTION increment_code_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code_id IS NOT NULL THEN
    UPDATE referral_codes
    SET uses_count = uses_count + 1
    WHERE id = NEW.referral_code_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply usage count trigger
CREATE TRIGGER increment_code_on_commission_created
  AFTER INSERT ON commissions
  FOR EACH ROW
  EXECUTE FUNCTION increment_code_usage();

-- Enable Row Level Security (RLS)
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for affiliates (affiliates can only see their own data)
CREATE POLICY "Affiliates can view own data" ON affiliates
  FOR SELECT USING (true); -- Allow public read for login purposes

CREATE POLICY "Affiliates can update own data" ON affiliates
  FOR UPDATE USING (true); -- Will be restricted by application logic

CREATE POLICY "Anyone can insert affiliates" ON affiliates
  FOR INSERT WITH CHECK (true); -- Allow signup

-- RLS Policies for referral_codes
CREATE POLICY "Referral codes are viewable by everyone" ON referral_codes
  FOR SELECT USING (true); -- Public read for code validation

CREATE POLICY "Affiliates can insert own codes" ON referral_codes
  FOR INSERT WITH CHECK (true);

-- RLS Policies for commissions
CREATE POLICY "Commissions viewable by all" ON commissions
  FOR SELECT USING (true); -- Will be filtered by application logic

CREATE POLICY "Commissions can be inserted" ON commissions
  FOR INSERT WITH CHECK (true);

-- Sample data for testing (optional - remove in production)
-- INSERT INTO affiliates (email, first_name, last_name, wallet_address, password_hash)
-- VALUES ('test@example.com', 'John', 'Doe', '0x1234567890123456789012345678901234567890', 'hashed_password_here');
