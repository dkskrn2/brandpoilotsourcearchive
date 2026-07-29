import { useAiContentUsage } from "../../features/ai-content/AiContentUsageContext";
import { AiContentUsageSummary } from "../ai-content/AiContentUsageSummary";

export function SidebarUsageSummary() {
  const { usage, loading } = useAiContentUsage();

  if (loading || !usage) return null;

  return <AiContentUsageSummary usage={usage} />;
}
