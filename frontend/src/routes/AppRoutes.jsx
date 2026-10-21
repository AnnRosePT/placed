import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AppLayout from "../layouts/AppLayout.jsx";
import LoginPage from "../pages/LoginPage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";
import { Skeleton } from "../components/ui/index.jsx";
import ProtectedRoute from "./ProtectedRoute.jsx";

// Route-level code splitting keeps the first load small.
const DashboardPage = lazy(() => import("../pages/DashboardPage.jsx"));
const StudentsPage = lazy(() => import("../pages/StudentsPage.jsx"));
const PredictionPage = lazy(() => import("../pages/PredictionPage.jsx"));
const AnalyticsPage = lazy(() => import("../pages/AnalyticsPage.jsx"));
const SkillsPage = lazy(() => import("../pages/SkillsPage.jsx"));
const AdminPage = lazy(() => import("../pages/AdminPage.jsx"));

function PageFallback() {
  return <div className="flex flex-col gap-4"><Skeleton className="h-28 rounded-xl" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div><Skeleton className="h-72 rounded-xl" /></div>;
}

function RootRedirect() {
  const { session, profile, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={session && profile ? "/" : "/login"} replace />;
}

function LegacySkillsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/skill-gap${search}`} replace />;
}

const page = (Component) => <Suspense fallback={<PageFallback />}><Component /></Suspense>;

export default function AppRoutes() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppLayout />}>
        <Route index element={page(DashboardPage)} />
        <Route path="students" element={page(StudentsPage)} />
        <Route path="prediction" element={page(PredictionPage)} />
        <Route path="analytics" element={page(AnalyticsPage)} />
        <Route path="skill-gap" element={page(SkillsPage)} />
        <Route path="skills" element={<LegacySkillsRedirect />} />
        <Route element={<ProtectedRoute allowedRoles={["super_admin", "auditor"]} />}>
          <Route path="admin" element={page(AdminPage)} />
        </Route>
        <Route path="404" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
    <Route path="*" element={<RootRedirect />} />
  </Routes>;
}
