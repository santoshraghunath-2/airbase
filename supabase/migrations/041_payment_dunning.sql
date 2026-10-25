-- Migration 041: Payment dunning — automated reminder sequences for overdue invoices
--
-- Adds dunning tracking columns to invoices and a pg_cron job for the nightly sweep.
-- The payment-dunning Edge Function handles Day 7 / 14 / 30 SMS + email reminders.
--
-- SETUP REQUIRED (run once in Supabase SQL editor after applying this migration):
--   SELECT cron.schedule(
--     'payment-dunning-nightly',
--     '0 18 * * *',  -- 10:00 PT = 18:00 UTC
--     $$ SELECT net.http_post(
--          url     := current_setting('app.settings.supabase_url') || '/functions/v1/payment-dunning',
--          headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
--          body    := '{}'::jsonb
--        ) $$
--   );

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS dunning_sent_at_7  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dunning_sent_at_14 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dunning_sent_at_30 TIMESTAMPTZ;

COMMENT ON COLUMN invoices.dunning_sent_at_7  IS 'Timestamp of Day 7 overdue reminder. NULL = not yet sent.';
COMMENT ON COLUMN invoices.dunning_sent_at_14 IS 'Timestamp of Day 14 overdue reminder. NULL = not yet sent.';
COMMENT ON COLUMN invoices.dunning_sent_at_30 IS 'Timestamp of Day 30 final notice. NULL = not yet sent.';

CREATE INDEX IF NOT EXISTS idx_invoices_dunning ON invoices (tenant_id, status, due_date)
  WHERE status IN ('sent', 'viewed', 'overdue') AND due_date IS NOT NULL;
