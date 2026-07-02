import { useState } from "react";
import { Outlet, useParams, Navigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import Sidebar from "./Sidebar";
import OperatorChatPanel from "@/features/operator-chat/OperatorChatPanel";

export default function AppLayout() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { tenant, user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (tenant && tenantSlug !== tenant.slug) {
    return <Navigate to={`/${tenant.slug}/dashboard`} replace />;
  }

  const showOperatorChat = user?.role === "owner" || user?.role === "dispatcher";

  return (
    <div className="flex h-screen bg-bone overflow-hidden">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:block flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 md:hidden transition-transform duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </div>

      {/* Content column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex-shrink-0 flex items-center gap-3 px-4 h-14 border-b border-line bg-paper">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-sm text-ink">Airbase</span>
          {user && (
            <span className="ml-auto text-xs text-ink-muted truncate max-w-[120px]">{user.name}</span>
          )}
        </header>

        <main className="flex-1 overflow-y-auto bg-bone">
          <Outlet />
        </main>
      </div>

      {showOperatorChat && <OperatorChatPanel />}
    </div>
  );
}
