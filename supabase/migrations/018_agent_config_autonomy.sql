-- Add autonomy_level and model_tier to agent_config for UI-facing settings
-- autonomy_level: 0=Suggests only, 1=Acts when sure (95%), 2=Acts fairly sure (85%), 3=Acts always (70%)
-- model_tier: human-readable tier name — never expose real model IDs in the UI

ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS autonomy_level SMALLINT NOT NULL DEFAULT 1
    CHECK (autonomy_level BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS model_tier TEXT NOT NULL DEFAULT 'balanced'
    CHECK (model_tier IN ('balanced', 'capable', 'fast'));
