import { NavLink, useParams } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  CalendarPlus,
  Columns3,
  MessageSquare,
  BookOpen,
  FileText,
  Settings,
  LogOut,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "dashboard", roles: null },
  { label: "Customers",  icon: Users,           path: "customers", roles: null },
  { label: "Book Job",   icon: CalendarPlus,    path: "jobs/new",  roles: null },
  { label: "Dispatch",   icon: Columns3,        path: "dispatch",  roles: null },
  { label: "Booking",    icon: MessageSquare,   path: "booking",   roles: null },
  { label: "Pricebook",  icon: BookOpen,        path: "pricebook", roles: null },
  { label: "Invoices",   icon: FileText,        path: "invoices",  roles: null },
  { label: "Settings",   icon: Settings,        path: "settings",  roles: ["owner"] },
] as const;

export default function Sidebar() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { user, tenant, signOut } = useAuth();

  return (
    <aside className="w-60 flex-shrink-0 border-r bg-slate-950 text-slate-100 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-blue-400" />
          <span className="font-bold text-lg tracking-tight">Airbase</span>
        </div>
      </div>

      {/* Tenant name */}
      {tenant && (
        <div className="px-6 py-3 border-b border-slate-800">
          <p className="text-xs text-slate-400 uppercase tracking-wider">Company</p>
          <p className="text-sm font-medium text-slate-200 truncate">{tenant.name}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems
          .filter((item) => !item.roles || item.roles.includes(user?.role as string))
          .map((item) => (
            <NavLink
              key={item.path}
              to={`/${tenantSlug}/${item.path}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                )
              }
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-blue-600 text-white text-xs">
              {user ? initials(user.name) : "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
            <p className="text-xs text-slate-400 capitalize">{user?.role}</p>
          </div>
          <button
            onClick={() => void signOut()}
            className="text-slate-400 hover:text-slate-100 transition-colors"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
