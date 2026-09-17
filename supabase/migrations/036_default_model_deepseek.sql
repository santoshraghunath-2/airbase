-- Migration 015: Switch platform default to deepseek-flash (DeepSeek V4.1 Flash)
-- 1M context window, tool calls, vision — confirmed at api-docs.deepseek.com/quick_start/pricing
-- $0.15/1M input tokens (off-peak). ~30x cheaper than Claude Sonnet.

ALTER TABLE tenants
  ALTER COLUMN default_model_id SET DEFAULT 'deepseek-flash';

-- Update existing tenants still on the old Claude default
UPDATE tenants
  SET default_model_id = 'deepseek-flash'
  WHERE default_model_id IN ('claude-sonnet-4-6', 'deepseek-chat');

-- Clear explicit model overrides that pointed to old defaults so they inherit correctly
UPDATE agent_config
  SET model_id = NULL
  WHERE model_id IN ('claude-sonnet-4-6', 'deepseek-chat');

-- Tech assistant: deepseek-chat has 128K context, covers any equipment manual.
-- Kimi/Moonshot is no longer needed and can be dropped from the stack.
UPDATE agent_config
  SET model_id = NULL  -- inherit tenant default (deepseek-chat)
  WHERE agent_type = 'tech' AND model_id LIKE 'moonshot%';
