import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { OfflineGuard } from "@/components/OfflineGuard";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import Settings from "./pages/Settings.tsx";
import Businesses from "./pages/admin/Businesses.tsx";
import AwaitingApproval from "./pages/AwaitingApproval.tsx";
import NotFound from "./pages/NotFound.tsx";

// React Query global defaults.
// Why these values:
//   refetchOnWindowFocus: true  — when the cashier/admin switches
//     back to the tab, every visible list refreshes. Cheap and
//     dramatically improves "feels live" without depending on
//     realtime working.
//   refetchOnReconnect: true    — same idea for laptop sleep/wake
//     and Wi-Fi flapping. We don't want a cashier showing yesterday's
//     numbers because their internet hiccuped at midnight.
//   retry: 1                    — one retry is enough; more just
//     slows down error reporting for real outages.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <OfflineGuard>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            {/* Public self-signup is gone — the super admin onboards businesses. */}
            <Route path="/signup" element={<Navigate to="/login" replace />} />
            <Route path="/awaiting-approval" element={<AwaitingApproval />} />

            {/* Platform super-admin console */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute requiredRole="super_admin">
                  <Businesses />
                </ProtectedRoute>
              }
            />

            {/* Protected app routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute requiredRole="admin">
                  <Settings />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      </OfflineGuard>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
