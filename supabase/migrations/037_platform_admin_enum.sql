-- Migration 037: Add platform_admin to user_role enum.
--
-- Must be the ONLY statement in this migration so Supabase commits the new
-- enum value before the next migration references it.  Postgres does not allow
-- referencing a newly-added enum value in the same transaction that added it.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'platform_admin';
