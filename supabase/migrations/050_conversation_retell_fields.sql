-- Migration 050: Retell session IDs on booking_conversations
-- Allows the UI to correlate conversations with Retell call/chat sessions,
-- and allows webhooks to find the matching conversation by Retell ID.

ALTER TABLE booking_conversations
  ADD COLUMN IF NOT EXISTS retell_call_id TEXT,
  ADD COLUMN IF NOT EXISTS retell_chat_id TEXT;

-- One conversation per Retell session (call or chat), scoped to tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_conv_retell_call
  ON booking_conversations(tenant_id, retell_call_id)
  WHERE retell_call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_conv_retell_chat
  ON booking_conversations(tenant_id, retell_chat_id)
  WHERE retell_chat_id IS NOT NULL;
