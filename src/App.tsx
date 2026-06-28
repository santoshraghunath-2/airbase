import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/features/auth/LoginPage";
import AppLayout from "@/components/layout/AppLayout";
import DashboardPage from "@/features/dashboard/DashboardPage";
import CustomerListPage from "@/features/crm/CustomerListPage";
import CustomerDetailPage from "@/features/crm/CustomerDetailPage";
import NewJobPage from "@/features/booking/NewJobPage";
import DispatchBoardPage from "@/features/dispatch/DispatchBoardPage";
import PricebookPage from "@/features/pricebook/PricebookPage";
import InvoiceListPage from "@/features/invoicing/InvoiceListPage";
import InvoiceBuilderPage from "@/features/invoicing/InvoiceBuilderPage";
import TechApp from "@/features/tech-pwa/TechApp";
import BookingInboxPage from "@/features/booking/BookingInboxPage";
import SettingsPage from "@/features/settings/SettingsPage";

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function TenantRedirect() {
  const { tenant } = useAuth();
  if (!tenant) return <Navigate to="/login" replace />;
  return <Navigate to={`/${tenant.slug}/dashboard`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster richColors position="top-right" />
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Technician PWA — separate mobile-optimized layout */}
          <Route
            path="/tech/*"
            element={
              <RouteGuard>
                <TechApp />
              </RouteGuard>
            }
          />

          {/* Operator / dispatcher routes */}
          <Route
            path="/:tenantSlug"
            element={
              <RouteGuard>
                <AppLayout />
              </RouteGuard>
            }
          >
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="customers" element={<CustomerListPage />} />
            <Route path="customers/:customerId" element={<CustomerDetailPage />} />
            <Route path="jobs/new" element={<NewJobPage />} />
            <Route path="dispatch" element={<DispatchBoardPage />} />
            <Route path="booking" element={<BookingInboxPage />} />
            <Route path="pricebook" element={<PricebookPage />} />
            <Route path="invoices" element={<InvoiceListPage />} />
            <Route path="invoices/new" element={<InvoiceBuilderPage />} />
            <Route path="invoices/:invoiceId" element={<InvoiceBuilderPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route
            path="/"
            element={
              <RouteGuard>
                <TenantRedirect />
              </RouteGuard>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
