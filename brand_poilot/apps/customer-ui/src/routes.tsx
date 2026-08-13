import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { App } from "./App";
import { BillingPage } from "./pages/BillingPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { PublishQueuePage } from "./pages/PublishQueuePage";
import { LoginPage } from "./pages/LoginPage";
import { SupportPage } from "./pages/SupportPage";
import { DmAutomationPage } from "./pages/DmAutomationPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PerformanceInsightsPage } from "./pages/PerformanceInsightsPage";
import { AiContentHomePage } from "./pages/AiContentHomePage";
import { AiContentWizardPage } from "./pages/AiContentWizardPage";
import { AiContentGenerationPage } from "./pages/AiContentGenerationPage";
import { BrandCenterPage } from "./pages/BrandCenterPage";
import { BrandCenterPreviewPage } from "./pages/BrandCenterPreviewPage";
import { ReferenceLibraryPage } from "./pages/ReferenceLibraryPage";

const OAuthConsentPage = lazy(async () => {
  const module = await import("./pages/OAuthConsentPage");
  return { default: module.OAuthConsentPage };
});

function OAuthConsentRoute() {
  return (
    <Suspense fallback={<main><p role="status">연결 화면을 준비하고 있습니다.</p></main>}>
      <OAuthConsentPage />
    </Suspense>
  );
}

export function LegacyBrandSettingsRedirect() {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  query.set("tab", "understanding");
  query.set("section", "core");
  return <Navigate to={`/brand-center?${query.toString()}`} replace />;
}

function redirectQuery(search: string, view: string) {
  const query = new URLSearchParams(search);
  query.set("view", view);
  return `/references?${query.toString()}`;
}

export function LegacyInstagramTrendsRedirect() {
  return <Navigate to={redirectQuery(useLocation().search, "trends")} replace />;
}

export function LegacyArchiveRedirect() {
  return <Navigate to={redirectQuery(useLocation().search, "saved-trends")} replace />;
}

export function LegacySourcesRedirect() {
  const query = new URLSearchParams(useLocation().search);
  const routingValues = ["tab", "section", "view", "sourceType", "type"]
    .map((key) => query.get(key)?.toLowerCase());
  const references = routingValues.includes("reference") || routingValues.includes("references");
  for (const key of ["tab", "section", "view", "sourceType", "type"]) query.delete(key);
  if (references) {
    query.set("view", "external-urls");
    return <Navigate to={`/references?${query.toString()}`} replace />;
  }
  query.set("tab", "understanding");
  query.set("section", "sources");
  return <Navigate to={`/brand-center?${query.toString()}`} replace />;
}

export const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    { path: "/oauth/consent", element: <OAuthConsentRoute /> },
    {
      path: "/",
      element: <App />,
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: <DashboardPage /> },
        { path: "performance", element: <PerformanceInsightsPage /> },
        { path: "ai-content", element: <AiContentHomePage /> },
        { path: "ai-content/new", element: <AiContentWizardPage /> },
        { path: "ai-content/:generationId", element: <AiContentGenerationPage /> },
        { path: "onboarding", element: <Navigate to="/onboarding/brand-intelligence" replace /> },
        { path: "onboarding/brand-intelligence", element: <BrandCenterPreviewPage mode="live" /> },
        { path: "content", element: <Navigate to="/publish-queue?status=needs_review" replace /> },
        { path: "publish-queue", element: <PublishQueuePage /> },
        { path: "references", element: <ReferenceLibraryPage /> },
        { path: "sources", element: <LegacySourcesRedirect /> },
        { path: "brand-center", element: <BrandCenterPage /> },
        { path: "brand-center-preview", element: <BrandCenterPreviewPage /> },
        { path: "archive", element: <LegacyArchiveRedirect /> },
        { path: "instagram-trends", element: <LegacyInstagramTrendsRedirect /> },
        { path: "channels", element: <ChannelsPage /> },
        { path: "dm-automation", element: <DmAutomationPage /> },
        { path: "billing", element: <BillingPage /> },
        { path: "support", element: <SupportPage /> },
        { path: "brand-settings", element: <LegacyBrandSettingsRedirect /> }
      ]
    }
  ],
  {
    future: {
      v7_relativeSplatPath: true
    }
  }
);
