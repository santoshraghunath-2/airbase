-- Migration 015: Booking conversations (SMS/voice inbound sessions)

CREATE TABLE booking_conversations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  customer_id     UUID REFERENCES customers(id),
  phone           TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'voice')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'resolved', 'escalated', 'abandoned')),
  job_id          UUID REFERENCES jobs(id),
  messages        JSONB NOT NULL DEFAULT '[]',
  context         JSONB NOT NULL DEFAULT '{}',
  last_message_at TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE booking_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "booking_conversations_tenant_isolation" ON booking_conversations
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER booking_conversations_updated_at
  BEFORE UPDATE ON booking_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_booking_conversations_tenant        ON booking_conversations(tenant_id);
CREATE INDEX idx_booking_conversations_phone         ON booking_conversations(tenant_id, phone);
CREATE INDEX idx_booking_conversations_status        ON booking_conversations(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_booking_conversations_last_message  ON booking_conversations(tenant_id, last_message_at DESC);
