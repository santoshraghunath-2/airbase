import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import TechJobList from "./TechJobList";
import TechJobDetail from "./TechJobDetail";
import { Wrench } from "lucide-react";

export default function TechApp() {
  const { user } = useAuth();

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

      <div className="flex-1">
        <Routes>
          <Route index element={<TechJobList />} />
          <Route path="jobs/:jobId" element={<TechJobDetail />} />
          <Route path="*" element={<Navigate to="/tech" replace />} />
        </Routes>
      </div>
    </div>
  );
}
