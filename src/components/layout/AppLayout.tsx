import { Outlet, useParams, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Sidebar from "./Sidebar";
import OperatorChatPanel from "@/features/operator-chat/OperatorChatPanel";

export default function AppLayout() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { tenant, user } = useAuth();

  // Ensure the URL slug matches the user's tenant
  if (tenant && tenantSlug !== tenant.slug) {
    return <Navigate to={`/${tenant.slug}/dashboard`} replace />;
  }

  const showOperatorChat = user?.role === "owner" || user?.role === "dispatcher";

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {showOperatorChat && <OperatorChatPanel />}
    </div>
  );
}
