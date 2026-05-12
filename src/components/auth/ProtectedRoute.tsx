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

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  if (requiredRole && profile && profile.role !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
