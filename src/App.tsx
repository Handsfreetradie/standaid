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
import Onboarding from "./pages/Onboarding";
import NotFound from "./pages/NotFound";
import ChunkTest from "./pages/ChunkTest";

const queryClient = new QueryClient();

const ONBOARDING_DONE_KEY = "standaid_onboarding_complete";

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const done = localStorage.getItem(ONBOARDING_DONE_KEY) === "true";
  if (!done) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
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
    <Route
      path="/auth"
      element={
        <OnboardingGate>
          <AuthRoute>
            <Auth />
          </AuthRoute>
        </OnboardingGate>
      }
    />
    <Route
      element={
        <OnboardingGate>
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        </OnboardingGate>
      }
    >
      <Route path="/" element={<Index />} />
      <Route path="/tools" element={<Tools />} />
      <Route path="/standards" element={<Standards />} />
      <Route path="/learn" element={<Learn />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/chunk-test" element={<ChunkTest />} />
      <Route path="/standards/upload" element={<StandardsUpload />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
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
);

export default App;
