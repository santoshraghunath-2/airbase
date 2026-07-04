-- Migration 028: Customer Portal
-- Creates portal_invitations, extends booking_conversations with 'portal' channel,
-- adds payment_link_url to invoices, and wires the auto-send trigger.

-- ─── Portal invitations ───────────────────────────────────────────────────────

CREATE TABLE portal_invitations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  token       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  last_sent_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days'),
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE portal_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_tenant_isolation" ON portal_invitations
  FOR ALL USING (tenant_id = get_my_tenant_id());

-- One invitation per customer per tenant (upsert-safe)
CREATE UNIQUE INDEX idx_portal_invitations_customer
  ON portal_invitations(tenant_id, customer_id);

CREATE INDEX idx_portal_invitations_token ON portal_invitations(token);

-- ─── Extend booking_conversations channel ────────────────────────────────────

ALTER TABLE booking_conversations
  DROP CONSTRAINT IF EXISTS booking_conversations_channel_check;

ALTER TABLE booking_conversations
  ADD CONSTRAINT booking_conversations_channel_check
  CHECK (channel IN ('sms', 'voice', 'portal'));

-- ─── Payment link URL on invoices ────────────────────────────────────────────

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link_url TEXT;

-- ─── Auto-send portal link when invoice is sent ──────────────────────────────

CREATE OR REPLACE FUNCTION trg_invoices_portal_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'sent' AND (OLD.status IS DISTINCT FROM 'sent') THEN
    PERFORM _call_edge_function(
      'send-portal-link',
      jsonb_build_object(
        'type',       TG_OP,
        'table',      'invoices',
        'schema',     'public',
        'record',     row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_portal_link
  AFTER UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoices_portal_link();
