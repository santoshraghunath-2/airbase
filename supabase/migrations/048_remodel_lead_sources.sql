-- Migration 048: Lead sources for remodel tenant
-- Adds web form and Retell chat as inbound lead channels.

ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'web_form';
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'retell_chat';
