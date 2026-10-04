import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.jsx";
import { Loading } from "./components/common.jsx";
import AppLayout from "./layouts/AppLayout.jsx";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "./pages/AuthPages.jsx";

const AuditPage = lazy(() => import("./pages/AuditPage.jsx"));
const AgentsPage = lazy(() => import("./pages/AgentsPage.jsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.jsx"));
const DiscoveryPage = lazy(() => import("./pages/DiscoveryPage.jsx"));
const ExperimentsPage = lazy(() => import("./pages/ExperimentsPage.jsx"));
const OpportunitiesPage = lazy(() => import("./pages/OpportunitiesPage.jsx"));
const OpportunityDetailsPage = lazy(() => import("./pages/OpportunityDetailsPage.jsx"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage.jsx"));
const PublicLandingPage = lazy(() => import("./pages/PublicLandingPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const UsersPage = lazy(() => import("./pages/UsersPage.jsx"));

function Protected({ children, capability }) {
  const { status, can } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "anon") return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (capability && !can(capability)) return <Navigate to="/" replace />;
  return children;
}

function Public({ children }) {
  const { status } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "authed") return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Public><LoginPage /></Public>} />
      <Route path="/register" element={<Public><RegisterPage /></Public>} />
      <Route path="/forgot-password" element={<Public><ForgotPasswordPage /></Public>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/privacy" element={<Suspense fallback={<Loading />}><PrivacyPage /></Suspense>} />
      <Route path="/p/:slug" element={<Suspense fallback={<Loading />}><PublicLandingPage /></Suspense>} />
      <Route element={<Protected><Suspense fallback={<Loading />}><AppLayout /></Suspense></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="opportunities" element={<OpportunitiesPage />} />
        <Route path="opportunities/:id" element={<OpportunityDetailsPage />} />
        <Route path="discovery" element={<DiscoveryPage />} />
        <Route path="experiments" element={<ExperimentsPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="users" element={<Protected capability="users:manage"><UsersPage /></Protected>} />
        <Route path="audit" element={<Protected capability="audit:read"><AuditPage /></Protected>} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
