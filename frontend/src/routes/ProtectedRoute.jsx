import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Skeleton } from "../components/ui/index.jsx";

export default function ProtectedRoute({ allowedRoles }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center bg-surface p-6"><div className="w-full max-w-sm space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-24" /></div></div>;
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: location }} />;
  if (allowedRoles && !allowedRoles.includes(profile.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
