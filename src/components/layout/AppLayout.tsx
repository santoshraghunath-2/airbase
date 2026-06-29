import { Outlet, useParams, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Sidebar from "./Sidebar";
import OperatorChatPanel from "@/features/operator-chat/OperatorChatPanel";

export default function AppLayout() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { tenant, user } = useAuth();

  if (tenant && tenantSlug !== tenant.slug) {
    return <Navigate to={`/${tenant.slug}/dashboard`} replace />;
  }

  const showOperatorChat = user?.role === "owner" || user?.role === "dispatcher";

  return (
    <div className="flex h-screen bg-bone overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-bone">
        <Outlet />
      </main>
      {showOperatorChat && <OperatorChatPanel />}
    </div>
  );
}
