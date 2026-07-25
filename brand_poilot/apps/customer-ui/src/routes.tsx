import { createBrowserRouter, Navigate } from "react-router-dom";
import { App } from "./App";
import { BrandSettingsPage } from "./pages/BrandSettingsPage";
import { BillingPage } from "./pages/BillingPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { PublishQueuePage } from "./pages/PublishQueuePage";
import { SourcesPage } from "./pages/SourcesPage";
import { LoginPage } from "./pages/LoginPage";
import { SupportPage } from "./pages/SupportPage";
import { DmAutomationPage } from "./pages/DmAutomationPage";
import { InstagramTrendsPage } from "./pages/InstagramTrendsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AiContentHomePage } from "./pages/AiContentHomePage";
import { AiContentWizardPage } from "./pages/AiContentWizardPage";
import { AiContentGenerationPage } from "./pages/AiContentGenerationPage";
import { BrandIntelligenceOnboardingPage } from "./pages/BrandIntelligenceOnboardingPage";
import { ArchivePage } from "./pages/ArchivePage";

export const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    {
      path: "/",
      element: <App />,
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: <DashboardPage /> },
        { path: "ai-content", element: <AiContentHomePage /> },
        { path: "ai-content/new", element: <AiContentWizardPage /> },
        { path: "ai-content/:generationId", element: <AiContentGenerationPage /> },
        { path: "onboarding", element: <Navigate to="/onboarding/brand-intelligence" replace /> },
        { path: "onboarding/brand-intelligence", element: <BrandIntelligenceOnboardingPage /> },
        { path: "content", element: <Navigate to="/publish-queue?status=needs_review" replace /> },
        { path: "publish-queue", element: <PublishQueuePage /> },
        { path: "sources", element: <SourcesPage /> },
        { path: "archive", element: <ArchivePage /> },
        { path: "instagram-trends", element: <InstagramTrendsPage /> },
        { path: "channels", element: <ChannelsPage /> },
        { path: "dm-automation", element: <DmAutomationPage /> },
        { path: "billing", element: <BillingPage /> },
        { path: "support", element: <SupportPage /> },
        { path: "brand-settings", element: <BrandSettingsPage /> }
      ]
    }
  ],
  {
    future: {
      v7_relativeSplatPath: true
    }
  }
);
