-- Migration 044: Device push notification tokens
--
-- Stores Expo push tokens per user device. Multiple devices per user are
-- supported (tech with work phone + personal phone, operator on iPad + iPhone).
-- Tokens are upserted on each app launch so stale tokens self-heal.

CREATE TABLE device_tokens (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  token      TEXT        NOT NULL,                        -- ExponentPushToken[...]
  platform   TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
  device_id  TEXT        NOT NULL,                        -- Expo Constants.deviceId
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One token per device — upsert on device_id so stale tokens auto-replace
CREATE UNIQUE INDEX idx_device_tokens_device ON device_tokens (user_id, device_id);
CREATE INDEX idx_device_tokens_user   ON device_tokens (user_id);
CREATE INDEX idx_device_tokens_tenant ON device_tokens (tenant_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read and manage their own tokens only
CREATE POLICY "own_tokens" ON device_tokens
  FOR ALL USING (
    user_id = (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1)
  );

CREATE TRIGGER device_tokens_updated_at
  BEFORE UPDATE ON device_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
