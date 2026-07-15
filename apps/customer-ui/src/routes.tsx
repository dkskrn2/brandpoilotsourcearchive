import { createBrowserRouter, Navigate } from "react-router-dom";
import { App } from "./App";
import { AdminChannelsPage } from "./pages/AdminChannelsPage";
import { BrandSettingsPage } from "./pages/BrandSettingsPage";
import { BillingPage } from "./pages/BillingPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { ContentPage } from "./pages/ContentPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { PublishQueuePage } from "./pages/PublishQueuePage";
import { SourcesPage } from "./pages/SourcesPage";
import { LoginPage } from "./pages/LoginPage";
import { SupportPage } from "./pages/SupportPage";
import { DmAutomationPage } from "./pages/DmAutomationPage";
import { InstagramTrendsPage } from "./pages/InstagramTrendsPage";

export const router = createBrowserRouter(
  [
    { path: "/login", element: <LoginPage /> },
    {
      path: "/",
      element: <App />,
      children: [
        { index: true, element: <Navigate to="/onboarding" replace /> },
        { path: "onboarding", element: <OnboardingPage /> },
        { path: "content", element: <ContentPage /> },
        { path: "publish-queue", element: <PublishQueuePage /> },
        { path: "sources", element: <SourcesPage /> },
        { path: "instagram-trends", element: <InstagramTrendsPage /> },
        { path: "channels", element: <ChannelsPage /> },
        { path: "dm-automation", element: <DmAutomationPage /> },
        { path: "billing", element: <BillingPage /> },
        { path: "admin/channels", element: <AdminChannelsPage /> },
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
