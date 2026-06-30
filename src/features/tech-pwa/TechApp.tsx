import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
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

export default function TechApp() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("jobs");

  if (user?.role !== "technician" && user?.role !== "owner") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Tech app is only accessible to technicians.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-lg mx-auto">
      {/* Mobile header */}
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center gap-2 sticky top-0 z-20">
        <Wrench className="h-4 w-4 text-blue-400" />
        <span className="font-bold text-sm">Airbase Tech</span>
        {user && (
          <span className="ml-auto text-xs text-slate-400">{user.name}</span>
        )}
      </header>

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "jobs" ? (
          <div className="flex-1 overflow-y-auto">
            <Routes>
              <Route index element={<TechJobList />} />
              <Route path="jobs/:jobId" element={<TechJobDetail />} />
              <Route path="*" element={<Navigate to="/tech" replace />} />
            </Routes>
          </div>
        ) : tab === "estimates" ? (
          <div className="flex-1 overflow-y-auto">
            <Routes>
              <Route index element={<TechEstimateList />} />
              <Route path="estimates/new" element={<TechEstimateBuilder />} />
              <Route path="estimates/:estimateId" element={<TechEstimateBuilder />} />
              <Route path="estimates/:estimateId/present" element={<TechEstimatePresent />} />
              <Route path="*" element={<TechEstimateList />} />
            </Routes>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            <TechChatTab />
          </div>
        )}
      </div>

      {/* Bottom tab bar */}
      <nav className="border-t bg-white flex sticky bottom-0">
        {([
          { id: "jobs",      icon: <List className="h-5 w-5" />,       label: "Jobs" },
          { id: "estimates", icon: <Calculator className="h-5 w-5" />, label: "Estimates" },
          { id: "help",      icon: <Bot className="h-5 w-5" />,        label: "Help" },
        ] as { id: Tab; icon: React.ReactNode; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors",
              tab === t.id ? "text-blue-600" : "text-slate-500 hover:text-slate-700",
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
