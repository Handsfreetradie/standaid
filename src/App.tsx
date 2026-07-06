import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "./components/AppLayout";
import Index from "./pages/Index";
import Standards from "./pages/Standards";
import Tools from "./pages/Tools";
import Chat from "./pages/Chat";
import Learn from "./pages/Learn";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import StandardsUpload from "./pages/StandardsUpload";
import Audits from "./pages/Audits";
import AuditDetail from "./pages/AuditDetail";
import Onboarding from "./pages/Onboarding";
import Legal from "./pages/Legal";
import NotFound from "./pages/NotFound";
import React from "react";

const queryClient = new QueryClient();

// Error boundary to catch crashes and show something instead of a blank screen
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-5 text-center">
          <h2 className="text-lg font-bold text-foreground mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-xs">{this.state.error}</p>
          <button
            className="mt-4 text-sm text-primary underline"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/auth" replace />;
  if (!user.email_confirmed_at) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 bg-background text-center">
        <h2 className="font-display text-xl font-bold text-foreground mb-2">Confirm your email</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          We sent a confirmation link to <strong>{user.email}</strong>. Check your inbox and click the link to activate your account.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/onboarding" element={<Onboarding />} />
    {/* Public legal pages — must be readable before signing up */}
    <Route path="/terms" element={<Legal kind="terms" />} />
    <Route path="/privacy" element={<Legal kind="privacy" />} />
    <Route
      path="/auth"
      element={
        <AuthRoute>
          <Auth />
        </AuthRoute>
      }
    />
    <Route
      element={
        <ProtectedRoute>
          <AppLayout />
        </ProtectedRoute>
      }
    >
      <Route path="/" element={<Index />} />
      <Route path="/tools" element={<Tools />} />
      <Route path="/standards" element={<Standards />} />
      <Route path="/learn" element={<Learn />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/standards/upload" element={<StandardsUpload />} />
      <Route path="/audits" element={<Audits />} />
      <Route path="/audits/:id" element={<AuditDetail />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
