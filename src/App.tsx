import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Router, Route, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { CreditsProvider } from "@/contexts/CreditsContext";
import { ArchiveProvider } from "@/contexts/ArchiveContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CommunityProvider } from "@/contexts/CommunityContext";
import { ForumProvider } from "@/contexts/ForumContext";
import RequireAuth from "@/components/RequireAuth";
import RequireRoot from "@/components/RequireRoot";
import { sendHeartbeat, sendPageView } from "@/lib/telemetry-api";
import { lazy, Suspense, useEffect, useRef } from "react";
import { LocaleProvider, useLocale } from "@/contexts/LocaleContext";

const LandingPage = lazy(() => import("@/pages/Landing"));
const WorkspacePage = lazy(() => import("@/pages/Workspace"));
const GalleryPage = lazy(() => import("@/pages/Gallery"));
const ForumPage = lazy(() => import("@/pages/Forum"));
const ProfilePage = lazy(() => import("@/pages/Profile"));
const LoginPage = lazy(() => import("@/pages/Login"));
const RegisterPage = lazy(() => import("@/pages/Register"));
const TermsPage = lazy(() => import("@/pages/Terms"));
const PrivacyPage = lazy(() => import("@/pages/Privacy"));
const SuperAdminPage = lazy(() => import("@/pages/SuperAdmin"));
const NoAccessPage = lazy(() => import("@/pages/NoAccess"));
const NotFoundPage = lazy(() => import("@/pages/NotFound"));
const AiSageWidget = lazy(() => import("@/components/AiSage"));

function RouteLoading() {
  const { t } = useLocale();
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      {t("common.loading")}
    </div>
  );
}

function RouteSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

// Use hash-based routing (/#/) to support opening index.html directly via file:// protocol
// Tolerant routing: unmatched paths are treated as anchor sections (e.g., /#/services → scroll to #services)
// For in-page anchors, use <Link href="/section"> instead of <a href="#section">
function AppRouter() {
  useEffect(() => {
    // 优化：兼容直接访问 /login 等非 hash 路径，统一重写为 hash 路由，避免“页面打不开”。
    const hash = window.location.hash || "";
    if (hash.startsWith("#/")) return;
    const path = `${window.location.pathname}${window.location.search}`.trim();
    if (!path || path === "/" || path === "//") return;
    window.history.replaceState(null, "", `/#${path}`);
  }, []);

  const LandingRoute = () => (
    <RouteSuspense>
      <LandingPage />
    </RouteSuspense>
  );
  const LoginRoute = () => (
    <RouteSuspense>
      <LoginPage />
    </RouteSuspense>
  );
  const RegisterRoute = () => (
    <RouteSuspense>
      <RegisterPage />
    </RouteSuspense>
  );
  const TermsRoute = () => (
    <RouteSuspense>
      <TermsPage />
    </RouteSuspense>
  );
  const PrivacyRoute = () => (
    <RouteSuspense>
      <PrivacyPage />
    </RouteSuspense>
  );
  const WorkspaceRoute = () => (
    <RequireAuth>
      <RouteSuspense>
        <WorkspacePage />
      </RouteSuspense>
    </RequireAuth>
  );
  const GalleryRoute = () => (
    <RequireAuth>
      <RouteSuspense>
        <GalleryPage />
      </RouteSuspense>
    </RequireAuth>
  );
  const ForumRoute = () => (
    <RequireAuth>
      <RouteSuspense>
        <ForumPage />
      </RouteSuspense>
    </RequireAuth>
  );
  const ProfileRoute = () => (
    <RequireAuth>
      <RouteSuspense>
        <ProfilePage />
      </RouteSuspense>
    </RequireAuth>
  );
  const SuperAdminRoute = () => (
    <RequireRoot>
      <RouteSuspense>
        <SuperAdminPage />
      </RouteSuspense>
    </RequireRoot>
  );
  const NoAccessRoute = () => (
    <RouteSuspense>
      <NoAccessPage />
    </RouteSuspense>
  );
  const NotFoundRoute = () => (
    <RouteSuspense>
      <NotFoundPage />
    </RouteSuspense>
  );
  const LegacyAuthRoute = () => <RedirectTo to="/login" />;
  const LegacyPricingRoute = () => <RedirectTo to="/profile" />;
  const LegacyPaymentRoute = () => <RedirectTo to="/profile" />;
  const LegacyDashboardRoute = () => <RedirectTo to="/profile" />;

  return (
    <Router hook={useHashLocation}>
      <>
        <Switch>
          <Route path="/" component={LandingRoute} />
          <Route path="/login" component={LoginRoute} />
          <Route path="/register" component={RegisterRoute} />
          <Route path="/terms" component={TermsRoute} />
          <Route path="/privacy" component={PrivacyRoute} />
          <Route path="/auth" component={LegacyAuthRoute} />
          <Route path="/workspace" component={WorkspaceRoute} />
          <Route path="/gallery" component={GalleryRoute} />
          <Route path="/forum" component={ForumRoute} />
          <Route path="/dashboard" component={LegacyDashboardRoute} />
          <Route path="/payment" component={LegacyPaymentRoute} />
          <Route path="/pricing" component={LegacyPricingRoute} />
          <Route path="/profile" component={ProfileRoute} />
          <Route path="/super-admin" component={SuperAdminRoute} />
          <Route path="/super-admin/dashboard" component={SuperAdminRoute} />
          <Route path="/super-admin/moderation" component={SuperAdminRoute} />
          <Route path="/super-admin/export" component={SuperAdminRoute} />
          <Route path="/no-access" component={NoAccessRoute} />
          <Route component={NotFoundRoute} />
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
          <LocaleProvider>
            <SettingsProvider>
              <AuthProvider>
                <CreditsProvider>
                  <ArchiveProvider>
                    <CommunityProvider>
                      <ForumProvider>
                        <Toaster />
                        <AppRouter />
                        <GlobalAiSage />
                      </ForumProvider>
                    </CommunityProvider>
                  </ArchiveProvider>
                </CreditsProvider>
              </AuthProvider>
            </SettingsProvider>
          </LocaleProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function GlobalAiSage() {
  return (
    <Suspense fallback={null}>
      <AiSageWidget />
    </Suspense>
  );
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
