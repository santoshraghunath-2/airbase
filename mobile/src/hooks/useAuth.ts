import { useState, useEffect } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export interface AppUser {
  id: string;
  auth_id: string;
  tenant_id: string;
  role: "admin" | "dispatcher" | "technician" | "platform_admin";
  full_name: string | null;
  email: string | null;
}

export function useAuth() {
  const [session, setSession]   = useState<Session | null>(null);
  const [appUser, setAppUser]   = useState<AppUser | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) void loadAppUser(session.user);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) void loadAppUser(session.user);
      else { setAppUser(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadAppUser(user: User) {
    const { data } = await supabase
      .from("users")
      .select("id, auth_id, tenant_id, role, full_name, email")
      .eq("auth_id", user.id)
      .single();

    setAppUser(data as AppUser | null);
    setLoading(false);
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { session, appUser, loading, signIn, signOut };
}
