-- Migration 008: Invoices and line items

CREATE TYPE invoice_status AS ENUM (
  'draft', 'review_required', 'sent', 'viewed',
  'partial', 'paid', 'overdue', 'void'
);

CREATE TABLE invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_number TEXT,
  status invoice_status DEFAULT 'draft',
  subtotal NUMERIC(10,2),
  tax_amount NUMERIC(10,2) DEFAULT 0,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2),
  amount_paid NUMERIC(10,2) DEFAULT 0,
  balance_due NUMERIC(10,2),
  ai_generated BOOLEAN DEFAULT false,
  ai_flagged BOOLEAN DEFAULT false,
  ai_flag_reason TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  qbo_invoice_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_tenant_isolation" ON invoices
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX idx_invoices_job_id ON invoices(job_id);
CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(tenant_id, status);

-- Auto-generate invoice numbers: INV-YYYY-NNNNN
CREATE SEQUENCE invoice_number_seq;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number = 'INV-' || to_char(now(), 'YYYY') || '-' ||
                          LPAD(nextval('invoice_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_generate_number
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();


CREATE TABLE invoice_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  pricebook_item_id UUID REFERENCES pricebook_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  taxable BOOLEAN DEFAULT true,
  sort_order INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_line_items_tenant_isolation" ON invoice_line_items
  FOR ALL USING (
    invoice_id IN (
      SELECT id FROM invoices WHERE tenant_id = get_my_tenant_id()
    )
  );

CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
