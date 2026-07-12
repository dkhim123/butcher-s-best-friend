import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import type { Database } from "@/lib/database.types";

type Role = Database["public"]["Tables"]["profiles"]["Row"]["role"];

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
  requiredRole?: Role;
}

export function ProtectedRoute({ children, allowedRoles, requiredRole }: ProtectedRouteProps) {
  const { profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  if (profile?.role === "pending") {
    return <Navigate to="/awaiting-approval" replace />;
  }

  // The platform super_admin has no business app — keep them in the console.
  // (Except when the route explicitly requires super_admin, e.g. /admin.)
  if (profile.role === "super_admin" && requiredRole !== "super_admin") {
    return <Navigate to="/admin" replace />;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  if (requiredRole && profile && profile.role !== requiredRole) {
    // A non-super_admin hitting /admin lands back on their app.
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
