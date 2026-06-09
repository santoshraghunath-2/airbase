-- Migration 009: Payments (Stripe)

CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  stripe_payment_intent_id TEXT UNIQUE,
  amount NUMERIC(10,2) NOT NULL,
  method TEXT, -- 'card' | 'ach' | 'cash' | 'check' | 'financing'
  status TEXT DEFAULT 'pending', -- 'pending' | 'succeeded' | 'failed' | 'refunded'
  last_four TEXT,
  card_brand TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_tenant_isolation" ON payments
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_stripe_id ON payments(stripe_payment_intent_id);
