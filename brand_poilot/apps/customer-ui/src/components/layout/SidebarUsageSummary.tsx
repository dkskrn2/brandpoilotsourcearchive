import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";
import type { PublishCalendarWeeklyUsage } from "../../types";
import { PUBLISH_CALENDAR_USAGE_CHANGED_EVENT } from "../../features/publishing/publishCalendar";

export function SidebarUsageSummary() {
  const [publishUsage, setPublishUsage] = useState<PublishCalendarWeeklyUsage | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const latestRequestId = useRef(0);

  useEffect(() => {
    let ignore = false;
    const refresh = () => {
      const requestId = ++latestRequestId.current;
      api.getPublishCalendarUsage(DEMO_BRAND_ID)
        .then((nextUsage) => {
          if (!ignore && requestId === latestRequestId.current) {
            setPublishUsage(nextUsage);
            setLoadState("ready");
          }
        })
        .catch(() => {
          if (!ignore && requestId === latestRequestId.current) {
            setPublishUsage(null);
            setLoadState("error");
          }
        });
    };
    refresh();
    window.addEventListener(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT, refresh);
    return () => { ignore = true; latestRequestId.current += 1; window.removeEventListener(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT, refresh); };
  }, []);

  return (
    <div className="ai-content-header-usage sidebar-usage-summary" aria-label="게시 운영 잔여 사용량">
      {loadState === "loading" ? <small>사용량 확인 중</small> : null}
      {loadState === "error" ? <small>플랜 확인 필요</small> : null}
      {loadState === "ready" && publishUsage ? (
        <>
          <span><Sparkles size={15} aria-hidden="true" /> 생성 <strong>{publishUsage.generation.remaining}건</strong> 남음</span>
          <span><Send size={15} aria-hidden="true" /> 게시 <strong>{publishUsage.publishing.remaining}건</strong> 남음</span>
          <small>예약 {publishUsage.publishing.reserved}건은 게시 성공 차감이 아닙니다{publishUsage.publishing.additionalAvailable > 0 ? ` · 추가 ${publishUsage.publishing.additionalAvailable}건 가능` : ""}.</small>
        </>
      ) : null}
    </div>
  );
}
