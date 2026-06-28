import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { User, Tenant } from "@/types/database.types";

interface AuthContextValue {
  session: Session | null;
  supabaseUser: SupabaseUser | null;
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshTenant: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSupabaseUser(session?.user ?? null);
      if (session?.user) {
        loadUserProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setSupabaseUser(session?.user ?? null);
      if (session?.user) {
        loadUserProfile(session.user.id);
      } else {
        setUser(null);
        setTenant(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadUserProfile(authId: string) {
    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", authId)
        .single();

      if (userError || !userData) {
        setLoading(false);
        return;
      }

      setUser(userData);

      const { data: tenantData } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", userData.tenant_id)
        .single();

      setTenant(tenantData ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function refreshTenant() {
    if (!user) return;
    const { data } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", user.tenant_id)
      .single();
    if (data) setTenant(data);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, supabaseUser, user, tenant, loading, signOut, refreshTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
