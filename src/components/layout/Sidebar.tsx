import { NavLink, useParams } from "react-router-dom";
import {
  Command,
  Users,
  CalendarPlus,
  Columns3,
  MessageSquare,
  BookOpen,
  FileText,
  ClipboardList,
  Settings,
  Bot,
  LogOut,
  BadgeCheck,
  Calculator,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { initials } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Command Center", icon: Command, path: "dashboard",  roles: null },
  { label: "Customers",  icon: Users,           path: "customers",  roles: null },
  { label: "Jobs",       icon: ClipboardList,   path: "jobs",       roles: null },
  { label: "Book Job",   icon: CalendarPlus,    path: "jobs/new",   roles: null },
  { label: "Dispatch",   icon: Columns3,        path: "dispatch",   roles: null },
  { label: "Booking",    icon: MessageSquare,   path: "booking",    roles: null },
  { label: "Pricebook",  icon: BookOpen,        path: "pricebook",  roles: null },
  { label: "Invoices",     icon: FileText,      path: "invoices",     roles: null },
  { label: "Memberships",  icon: BadgeCheck,    path: "memberships",  roles: null },
  { label: "Estimates",      icon: Calculator,   path: "estimates",      roles: null },
  { label: "Opportunities",  icon: TrendingUp,  path: "opportunities",  roles: null },
  { label: "AI Settings",  icon: Bot,           path: "ai-settings",  roles: ["owner"] },
  { label: "Settings",   icon: Settings,        path: "settings",   roles: ["owner"] },
] as const;

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { user, tenant, signOut } = useAuth();

  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col" style={{ background: "#292420" }}>
      {/* Wordmark */}
      <div className="h-14 flex items-center px-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2">
          {/* "A" logo mark */}
          <span
            className="h-6 w-6 rounded flex items-center justify-center text-xs font-bold"
            style={{ background: "#F1EBE1", color: "#292420" }}
          >
            A
          </span>
          <span className="font-semibold text-sm tracking-tight" style={{ color: "#F1EBE1" }}>
            Airbase
          </span>
        </div>
      </div>

      {/* Company name */}
      {tenant && (
        <div className="px-5 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: "#6F6658" }}>
            Company
          </p>
          <p className="text-sm font-medium truncate" style={{ color: "#C9BFAD" }}>
            {tenant.name}
          </p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS
          .filter((item) => !item.roles || (item.roles as readonly string[]).includes(user?.role ?? ""))
          .map((item) => (
            <NavLink
              key={item.path}
              to={`/${tenantSlug}/${item.path}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
                  isActive
                    ? "text-[#F1EBE1] bg-white/10"
                    : "text-[#9A9082] hover:text-[#C9BFAD] hover:bg-white/6",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className="h-4 w-4 flex-shrink-0"
                    style={{ color: isActive ? "#F1EBE1" : "#6F6658" }}
                  />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
      </nav>

      {/* User footer */}
      <div className="border-t p-4" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-3">
          <div
            className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
            style={{ background: "#3a342d", color: "#C9BFAD" }}
          >
            {user ? initials(user.name) : "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate" style={{ color: "#C9BFAD" }}>
              {user?.name}
            </p>
            <p className="text-[11px] capitalize" style={{ color: "#6F6658" }}>
              {user?.role?.replace("_", " ")}
            </p>
          </div>
          <button
            onClick={() => void signOut()}
            className="transition-colors"
            style={{ color: "#6F6658" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#C9BFAD")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6F6658")}
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
