import { useLocation, useNavigate, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import TechJobList from "./TechJobList";
import TechJobDetail from "./TechJobDetail";
import TechChatTab from "./TechChatTab";
import TechEstimateList from "./TechEstimateList";
import TechEstimateBuilder from "./TechEstimateBuilder";
import TechEstimatePresent from "./TechEstimatePresent";
import { Wrench, List, Bot, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "jobs" | "estimates" | "help";

const TABS: { id: Tab; icon: React.ReactNode; label: string; path: string }[] = [
  { id: "jobs",      icon: <List className="h-5 w-5" />,       label: "Jobs",      path: "/tech" },
  { id: "estimates", icon: <Calculator className="h-5 w-5" />, label: "Estimates", path: "/tech/estimates" },
  { id: "help",      icon: <Bot className="h-5 w-5" />,        label: "Help",      path: "/tech/help" },
];

export default function TechApp() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (user?.role !== "technician" && user?.role !== "owner") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Tech app is only accessible to technicians.</p>
        </div>
      </div>
    );
  }

  const activeTab: Tab = location.pathname.startsWith("/tech/estimates")
    ? "estimates"
    : location.pathname.startsWith("/tech/help")
    ? "help"
    : "jobs";

  return (
    <div className="min-h-screen bg-bone flex flex-col max-w-lg mx-auto">
      {/* Mobile header */}
      <header className="bg-ink text-paper px-4 py-3 flex items-center gap-2 sticky top-0 z-20">
        <Wrench className="h-4 w-4 text-ai" />
        <span className="font-bold text-sm">Airbase Tech</span>
        {user && (
          <span className="ml-auto text-xs text-faint">{user.name}</span>
        )}
      </header>

      {/* Content area — overflow-hidden for chat (manages its own scroll), overflow-y-auto for all other tabs */}
      <div className={cn(
        "flex-1 flex flex-col",
        activeTab === "help" ? "overflow-hidden" : "overflow-y-auto",
      )}>
        <Routes>
          <Route index element={<TechJobList />} />
          <Route path="jobs/:jobId" element={<TechJobDetail />} />
          <Route path="estimates" element={<TechEstimateList />} />
          <Route path="estimates/new" element={<TechEstimateBuilder />} />
          <Route path="estimates/:estimateId" element={<TechEstimateBuilder />} />
          <Route path="estimates/:estimateId/present" element={<TechEstimatePresent />} />
          <Route path="help" element={<TechChatTab />} />
          <Route path="*" element={<Navigate to="/tech" replace />} />
        </Routes>
      </div>

      {/* Bottom tab bar */}
      <nav className="border-t border-line bg-paper flex sticky bottom-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(t.path)}
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors",
              activeTab === t.id ? "text-ai" : "text-ink-muted hover:text-ink",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
