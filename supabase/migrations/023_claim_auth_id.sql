-- Auto-link a seeded users row to a Supabase Auth account on first login.
--
-- The seed file inserts users with auth_id = NULL and a comment to set it
-- manually after creating the Supabase Auth account. This function handles
-- that linking automatically: when loadUserProfile fails to find a row by
-- auth_id, the app calls this RPC which matches by the JWT email instead,
-- sets auth_id = auth.uid(), and returns the row.
--
-- Security: runs as DEFINER so it can bypass RLS, but only ever sets
-- auth_id to auth.uid() (from the verified JWT) and only on rows where
-- auth_id IS NULL and email matches the JWT email. A user cannot claim
-- someone else's account.

CREATE OR REPLACE FUNCTION public.claim_auth_id_by_email()
RETURNS SETOF users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  text;
  v_uid    uuid;
BEGIN
  v_uid   := auth.uid();
  v_email := auth.jwt() ->> 'email';

  IF v_uid IS NULL OR v_email IS NULL THEN
    RETURN;
  END IF;

  -- Only claim if there is an unclaimed row with a matching email.
  -- If auth_id is already set (even to a different uid), do nothing —
  -- that would indicate an account conflict that needs manual review.
  RETURN QUERY
    UPDATE users
    SET    auth_id = v_uid
    WHERE  email   = v_email
      AND  auth_id IS NULL
    RETURNING *;
END;
$$;

-- Allow authenticated users to call this function
GRANT EXECUTE ON FUNCTION public.claim_auth_id_by_email() TO authenticated;
