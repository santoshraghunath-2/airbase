import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/features/auth/LoginPage";
import AppLayout from "@/components/layout/AppLayout";
import DashboardPage from "@/features/dashboard/DashboardPage";
import CustomerListPage from "@/features/crm/CustomerListPage";
import CustomerDetailPage from "@/features/crm/CustomerDetailPage";
import NewJobPage from "@/features/booking/NewJobPage";
import JobListPage from "@/features/jobs/JobListPage";
import DispatchBoardPage from "@/features/dispatch/DispatchBoardPage";
import PricebookPage from "@/features/pricebook/PricebookPage";
import InvoiceListPage from "@/features/invoicing/InvoiceListPage";
import InvoiceBuilderPage from "@/features/invoicing/InvoiceBuilderPage";
import TechApp from "@/features/tech-pwa/TechApp";
import TechJobList from "@/features/tech-pwa/TechJobList";
import TechJobDetail from "@/features/tech-pwa/TechJobDetail";
import TechChatTab from "@/features/tech-pwa/TechChatTab";
import TechEstimateList from "@/features/tech-pwa/TechEstimateList";
import TechEstimateBuilder from "@/features/tech-pwa/TechEstimateBuilder";
import TechEstimatePresent from "@/features/tech-pwa/TechEstimatePresent";
import BookingInboxPage from "@/features/booking/BookingInboxPage";
import SettingsPage from "@/features/settings/SettingsPage";
import AISettingsPage from "@/features/settings/AISettingsPage";
import OnboardingPage from "@/features/onboarding/OnboardingPage";
import MembershipsPage from "@/features/membership/MembershipsPage";
import EstimatesPage from "@/features/estimates/EstimatesPage";
import EstimateBuilderPage from "@/features/estimates/EstimateBuilderPage";
import OpportunitiesPage from "@/features/opportunities/OpportunitiesPage";
import CustomerPortalPage from "@/features/portal/CustomerPortalPage";
import ProfitabilityPage from "@/features/analytics/ProfitabilityPage";
import CampaignsPage from "@/features/campaigns/CampaignsPage";
import InvoiceReviewQueuePage from "@/features/invoicing/InvoiceReviewQueuePage";
import BookingAgentDashboardPage from "@/features/booking/BookingAgentDashboardPage";
import SuperadminPage from "@/features/superadmin/SuperadminPage";
import ContractsPage from "@/features/contracts/ContractsPage";
import ContractDetailPage from "@/features/contracts/ContractDetailPage";

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bone">
        <div className="h-6 w-6 rounded-full border-2 border-ink border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!session) {
    const from = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?from=${from}`} replace />;
  }
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

          {/* Platform superadmin — own auth gate inside the page (role: platform_admin) */}
          <Route path="/superadmin" element={<RouteGuard><SuperadminPage /></RouteGuard>} />

          {/* Customer portal — public, token-authenticated */}
          <Route path="/portal/:token" element={<CustomerPortalPage />} />

          {/* Technician PWA — explicit child routes so /tech/estimates etc. score higher
              than /:tenantSlug/estimates (two static segs > one dynamic + one static) */}
          <Route
            path="/tech"
            element={
              <RouteGuard>
                <TechApp />
              </RouteGuard>
            }
          >
            <Route index element={<TechJobList />} />
            <Route path="jobs/:jobId" element={<TechJobDetail />} />
            <Route path="estimates" element={<TechEstimateList />} />
            <Route path="estimates/new" element={<TechEstimateBuilder />} />
            <Route path="estimates/:estimateId" element={<TechEstimateBuilder />} />
            <Route path="estimates/:estimateId/present" element={<TechEstimatePresent />} />
            <Route path="help" element={<TechChatTab />} />
          </Route>

          {/* Onboarding — standalone (no AppLayout sidebar) */}
          <Route
            path="/:tenantSlug/onboarding"
            element={
              <RouteGuard>
                <OnboardingPage />
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
            <Route path="dashboard"    element={<DashboardPage />} />
            <Route path="customers"    element={<CustomerListPage />} />
            <Route path="customers/:customerId" element={<CustomerDetailPage />} />
            <Route path="jobs"         element={<JobListPage />} />
            <Route path="jobs/new"     element={<NewJobPage />} />
            <Route path="dispatch"     element={<DispatchBoardPage />} />
            <Route path="booking"      element={<BookingInboxPage />} />
            <Route path="pricebook"    element={<PricebookPage />} />
            <Route path="invoices"     element={<InvoiceListPage />} />
            <Route path="invoices/new" element={<InvoiceBuilderPage />} />
            <Route path="invoices/:invoiceId" element={<InvoiceBuilderPage />} />
            <Route path="invoices/review" element={<InvoiceReviewQueuePage />} />
            <Route path="booking-agent" element={<BookingAgentDashboardPage />} />
            <Route path="memberships"  element={<MembershipsPage />} />
            <Route path="estimates"    element={<EstimatesPage />} />
            <Route path="estimates/new" element={<EstimateBuilderPage />} />
            <Route path="estimates/:estimateId" element={<EstimateBuilderPage />} />
            <Route path="contracts"      element={<ContractsPage />} />
            <Route path="contracts/:contractId" element={<ContractDetailPage />} />
            <Route path="opportunities" element={<OpportunitiesPage />} />
            <Route path="campaigns"     element={<CampaignsPage />} />
            <Route path="analytics"     element={<ProfitabilityPage />} />
            <Route path="settings"     element={<SettingsPage />} />
            <Route path="ai-settings"  element={<AISettingsPage />} />
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
