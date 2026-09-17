import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProgressProvider } from "@/hooks/useProgress";
import { useProfile } from "@/hooks/useData";
import AppLayout from "./components/AppLayout";
import { AppLoader } from "./components/AppLoader";
import Index from "./pages/Index";
import Standards from "./pages/Standards";
import Tools, { hasSetoutTrade } from "./pages/Tools";
import Chat from "./pages/Chat";
import Learn from "./pages/Learn";
import Profile from "./pages/Profile";
import Team from "./pages/Team";
import Auth from "./pages/Auth";
import AuthConfirm from "./pages/AuthConfirm";
import StandardsUpload from "./pages/StandardsUpload";
import Audits from "./pages/Audits";
import AuditDetail from "./pages/AuditDetail";
import Onboarding from "./pages/Onboarding";
import Legal from "./pages/Legal";
import NotFound from "./pages/NotFound";
import React, { Suspense } from "react";

// Setout is a paid add-on only a slice of tradies (electrical/HVAC with the
// add-on) ever open, and its page pulls in the canvas/PDF-export machinery —
// lazy-loaded so that weight isn't in every other tradie's main bundle.
const Setout = React.lazy(() => import("./pages/Setout"));
const SetoutPlan = React.lazy(() => import("./pages/SetoutPlan"));

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
  if (loading) return <AppLoader />;
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
  if (loading) return <AppLoader />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Rough-In Setout Assistant is electrical/HVAC-only and a paid add-on on top
// of the base subscription — both conditions must hold, independently of
// each other, so an electrician or HVAC tech can see the upsell before
// buying and any other trade never sees the module at all. The trade check
// itself is shared with Tools.tsx's own upsell card via hasSetoutTrade, so
// the two can't drift apart.
function SetoutRoute({ children }: { children: React.ReactNode }) {
  const { data: profile, isLoading } = useProfile();
  if (isLoading) return <AppLoader />;
  // has_setout_addon isn't in the generated Supabase types yet (new column,
  // types not regenerated) — same `as any` escape hatch used elsewhere in
  // this repo for newer columns (e.g. AuditDetail.tsx).
  const hasAddon = (profile as { has_setout_addon?: boolean } | null)?.has_setout_addon;
  if (!hasSetoutTrade(profile?.trade_type) || !hasAddon) return <Navigate to="/tools" replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/onboarding" element={<Onboarding />} />
    {/* Public legal pages — must be readable before signing up */}
    <Route path="/terms" element={<Legal kind="terms" />} />
    <Route path="/privacy" element={<Legal kind="privacy" />} />
    {/* Public — reached from the confirmation email before the user is signed in */}
    <Route path="/auth/confirm" element={<AuthConfirm />} />
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
      <Route path="/team" element={<Team />} />
      <Route path="/standards/upload" element={<StandardsUpload />} />
      <Route path="/audits" element={<Audits />} />
      <Route path="/audits/:id" element={<AuditDetail />} />
      <Route
        path="/setout"
        element={
          <SetoutRoute>
            <Suspense fallback={<AppLoader />}>
              <Setout />
            </Suspense>
          </SetoutRoute>
        }
      />
      <Route
        path="/setout/:planId"
        element={
          <SetoutRoute>
            <Suspense fallback={<AppLoader />}>
              <SetoutPlan />
            </Suspense>
          </SetoutRoute>
        }
      />
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
          <ProgressProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ProgressProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
