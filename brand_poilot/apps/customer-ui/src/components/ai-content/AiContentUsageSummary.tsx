import { Download, Sparkles } from "lucide-react";
import type { AiContentUsage } from "../../features/ai-content/types";

interface AiContentUsageSummaryProps {
  usage: AiContentUsage;
}

function remaining(used: number, limit: number) {
  return Math.max(limit - used, 0);
}

export function AiContentUsageSummary({ usage }: AiContentUsageSummaryProps) {
  return (
    <div className="ai-content-header-usage" aria-label="오늘 AI 콘텐츠 잔여 사용량">
      <span>
        <Sparkles size={15} aria-hidden="true" />
        생성 <strong>{remaining(usage.generationUsed, usage.generationLimit)}회</strong> 남음
      </span>
      <span>
        <Download size={15} aria-hidden="true" />
        다운로드 <strong>{remaining(usage.newDownloadUsed, usage.newDownloadLimit)}회</strong> 남음
      </span>
    </div>
  );
}
