import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { ChannelConnection, ChannelStatus } from "../types";

const statusLabels: Record<ChannelStatus, string> = {
  connected: "연결됨",
  not_connected: "미연결",
  needs_attention: "확인 필요",
  expired: "만료",
  insufficient_permissions: "권한 부족",
  mapping_required: "매핑 필요",
  publish_failed: "게시 실패"
};

function badgeFor(status: ChannelStatus) {
  if (status === "connected") return "ok";
  if (status === "not_connected" || status === "publish_failed") return "bad";
  return "warn";
}

function alertVariantFor(status: ChannelStatus) {
  if (status === "connected") return "ok";
  if (status === "not_connected" || status === "publish_failed") return "bad";
  return "warn";
}

function metaOauthStartUrl() {
  const startUrl = new URL(import.meta.env.VITE_META_OAUTH_START_URL ?? "https://www.danbammsg.co.kr/api/auth/meta/start");
  startUrl.searchParams.set(
    "dev_redirect",
    import.meta.env.VITE_META_OAUTH_DEV_REDIRECT_URL ?? "http://localhost:4000/auth/meta/dev-complete"
  );
  return startUrl.toString();
}

function channelAction(channel: ChannelConnection) {
  if (channel.type !== "instagram") {
    return null;
  }
  return (
    <a className="button primary" href={metaOauthStartUrl()}>
      {channel.status === "connected" ? "Meta 다시 연결" : "Meta OAuth 연결"}
    </a>
  );
}

export function ChannelsPage() {
  const [connectionCards, setConnectionCards] = useState<ChannelConnection[]>([]);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const attentionCount = connectionCards.filter((channel) => channel.status !== "connected").length;
  const connectionStatusBadge = connectionCards.length === 0
    ? { label: "상태 없음", variant: "neutral" as const }
    : {
      label: attentionCount === 0 ? "모두 연결됨" : `${attentionCount}개 미연결`,
      variant: attentionCount === 0 ? "ok" as const : "warn" as const
    };

  useEffect(() => {
    let ignore = false;
    api.listChannels(DEMO_BRAND_ID)
      .then((apiChannels) => {
        if (ignore) return;
        setConnectionCards(apiChannels);
        setApiNotice(null);
      })
      .catch(() => {
        if (ignore) return;
        setConnectionCards([]);
        setApiNotice("API 서버가 응답하지 않아 채널 연결 상태를 불러오지 못했습니다.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section className="content">
      <PageHeader
        title="채널 연결"
        description="자동 업로드에 사용할 외부 채널을 연결합니다. Meta 권한은 고객 계정으로 직접 승인합니다."
      />

      {apiNotice ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body">
            <Alert title="API 상태" variant="warn">{apiNotice}</Alert>
          </div>
        </section>
      ) : null}

      <div className="grid three">
        {connectionCards.length === 0 ? (
          <section className="panel" style={{ gridColumn: "1 / -1" }}>
            <div className="panel-body">
              <EmptyState
                title="연결 상태를 불러올 수 없습니다"
                description="API 서버가 응답하면 Instagram, Threads, TikTok, YouTube, X 연결 상태가 여기에 표시됩니다."
              />
            </div>
          </section>
        ) : connectionCards.map((channel) => (
          <article className="panel" key={channel.type}>
            <div className="panel-head">
              <h2>{channel.label}</h2>
              <Badge variant={badgeFor(channel.status)}>{statusLabels[channel.status]}</Badge>
            </div>
            <div className="panel-body grid">
              <p>연결 계정: <strong>{channel.accountLabel}</strong></p>
              <p className="muted">마지막 정상 확인: {channel.lastHealthyAt ?? "-"}</p>
              <p className="muted">마지막 게시 성공: {channel.lastPublishedAt ?? "-"}</p>
              {channel.alertTitle ? (
                <Alert title={channel.alertTitle} variant={alertVariantFor(channel.status)}>
                  {channel.alertBody}
                </Alert>
              ) : null}
              {channelAction(channel) ? <div className="actions">{channelAction(channel)}</div> : null}
            </div>
          </article>
        ))}
      </div>

      <section id="check-result" className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>연결 상태 요약</h2>
          <Badge variant={connectionStatusBadge.variant}>{connectionStatusBadge.label}</Badge>
        </div>
        <div className="panel-body grid">
          {connectionCards
            .filter((channel) => channel.alertTitle)
            .map((channel) => (
              <Alert key={channel.type} title={channel.alertTitle ?? channel.label} variant={alertVariantFor(channel.status)}>
                {channel.alertBody}
              </Alert>
            ))}
        </div>
      </section>
    </section>
  );
}
