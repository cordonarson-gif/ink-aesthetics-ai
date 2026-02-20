import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Router, Route, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Landing from "@/pages/Landing";
import Workspace from "@/pages/Workspace";
import Gallery from "@/pages/Gallery";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/NotFound";
import { CreditsProvider } from "@/contexts/CreditsContext";
import { ArchiveProvider } from "@/contexts/ArchiveContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import AiSage from "@/components/AiSage";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CommunityProvider } from "@/contexts/CommunityContext";
import RequireAuth from "@/components/RequireAuth";
import RequireRoot from "@/components/RequireRoot";
import Profile from "@/pages/Profile";
import LoginPage from "@/pages/Login";
import RegisterPage from "@/pages/Register";
import PaymentPage from "@/pages/Payment";
import SuperAdminPage from "@/pages/SuperAdmin";
import NoAccessPage from "@/pages/NoAccess";
import { sendHeartbeat, sendPageView } from "@/lib/telemetry-api";
import { useEffect, useRef } from "react";

// Use hash-based routing (/#/) to support opening index.html directly via file:// protocol
// Tolerant routing: unmatched paths are treated as anchor sections (e.g., /#/services → scroll to #services)
// For in-page anchors, use <Link href="/section"> instead of <a href="#section">
function AppRouter() {
  const WorkspaceRoute = () => (
    <RequireAuth>
      <Workspace />
    </RequireAuth>
  );
  const GalleryRoute = () => (
    <RequireAuth>
      <Gallery />
    </RequireAuth>
  );
  const DashboardRoute = () => (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
  const PaymentRoute = () => (
    <RequireAuth>
      <PaymentPage />
    </RequireAuth>
  );
  const ProfileRoute = () => (
    <RequireAuth>
      <Profile />
    </RequireAuth>
  );
  const SuperAdminRoute = () => (
    <RequireRoot>
      <SuperAdminPage />
    </RequireRoot>
  );
  const LegacyAuthRoute = () => <RedirectTo to="/login" />;
  const LegacyPricingRoute = () => <RedirectTo to="/payment" />;

  return (
    <Router hook={useHashLocation}>
      <>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/login" component={LoginPage} />
          <Route path="/register" component={RegisterPage} />
          <Route path="/auth" component={LegacyAuthRoute} />
          <Route path="/workspace" component={WorkspaceRoute} />
          <Route path="/gallery" component={GalleryRoute} />
          <Route path="/dashboard" component={DashboardRoute} />
          <Route path="/payment" component={PaymentRoute} />
          <Route path="/pricing" component={LegacyPricingRoute} />
          <Route path="/profile" component={ProfileRoute} />
          <Route path="/super-admin" component={SuperAdminRoute} />
          <Route path="/no-access" component={NoAccessPage} />
          <Route component={NotFound} />
        </Switch>
        <TelemetryBridge />
      </>
    </Router>
  );
}

// Note on theming:
// - Choose defaultTheme based on your design (light or dark background)
// - Update the color palette in index.css to match
// - If you want switchable themes, add `switchable` prop and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <SettingsProvider>
            <AuthProvider>
              <CreditsProvider>
                <ArchiveProvider>
                  <CommunityProvider>
                    <Toaster />
                    <AppRouter />
                    <AuthAwareAiSage />
                  </CommunityProvider>
                </ArchiveProvider>
              </CreditsProvider>
            </AuthProvider>
          </SettingsProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function AuthAwareAiSage() {
  const { user } = useAuth();
  if (!user) return null;
  return <AiSage />;
}

function TelemetryBridge() {
  const [loc] = useLocation();
  const { user } = useAuth();
  const lastPathRef = useRef<string>("");

  useEffect(() => {
    if (!loc) return;
    if (lastPathRef.current === loc) return;
    lastPathRef.current = loc;
    void sendPageView(loc);
  }, [loc]);

  useEffect(() => {
    if (!user) return;
    void sendHeartbeat(loc);
    const timer = window.setInterval(() => {
      void sendHeartbeat(loc);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loc, user]);

  return null;
}

function RedirectTo({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);
  return null;
}

export default App;
