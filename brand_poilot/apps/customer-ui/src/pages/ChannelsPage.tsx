import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { Switch } from "../components/ui/Switch";
import { PageSkeleton } from "../components/ui/LoadingState";
import { ChannelConnectionGuideDialog } from "../components/channels/ChannelConnectionGuideDialog";
import { ChannelLogo } from "../components/channels/ChannelLogo";
import { channelGuides } from "../features/channels/channelGuides";
import { channelConnectionUrl } from "../features/channels/channelConnectionUrls";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { ChannelConnection, ChannelStatus, InstagramDmSettings } from "../types";

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

function channelAction(channel: ChannelConnection) {
  const url = channelConnectionUrl(channel.type);
  if (!url) {
    return <button className="button is-disabled" type="button" disabled>연결 준비 중</button>;
  }
  return (
    <a className="button primary" href={url} data-guide="meta-oauth">
      {channel.oauthState === "connected" ? "Meta 다시 연결" : "Meta OAuth 연결"}
    </a>
  );
}

export function ChannelsPage() {
  const [connectionCards, setConnectionCards] = useState<ChannelConnection[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [dmSettings, setDmSettings] = useState<InstagramDmSettings | null>(null);
  const [updatingChannel, setUpdatingChannel] = useState<ChannelConnection["type"] | null>(null);
  const [guideChannel, setGuideChannel] = useState<ChannelConnection["type"] | null>(null);

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
      })
      .finally(() => {
        if (!ignore) setChannelsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    api.getInstagramDmSettings(DEMO_BRAND_ID).then(setDmSettings).catch(() => setDmSettings(null));
  }, []);

  async function toggleDm(enabled: boolean) {
    if (!dmSettings) return;
    try {
      setDmSettings(await api.updateInstagramDmSettings(DEMO_BRAND_ID, { enabled }));
      setApiNotice(null);
    } catch {
      setApiNotice("DM 자동답변을 켜지 못했습니다. Wiki, 메시지 권한, 워커 상태를 먼저 확인하세요.");
    }
  }

  async function toggleChannel(channel: ChannelConnection, enabled: boolean) {
    if (enabled && (channel.status !== "connected" || channel.oauthState !== "connected")) {
      setApiNotice(`${channel.label} 인증을 완료한 후 채널을 활성화하세요.`);
      return;
    }
    setUpdatingChannel(channel.type);
    try {
      const updated = await api.updateChannelEnabled(DEMO_BRAND_ID, channel.type, enabled);
      setConnectionCards((current) => current.map((item) => item.type === updated.type ? updated : item));
      setApiNotice(null);
    } catch {
      setApiNotice(`${channel.label} 채널 활성화 상태를 저장하지 못했습니다.`);
    } finally {
      setUpdatingChannel(null);
    }
  }

  return (
    <section className="content">
      <PageHeader
        title="채널 연결"
        description="자동 업로드에 사용할 외부 채널을 연결합니다. Meta 권한은 고객 계정으로 직접 승인합니다."
      />

      {channelsLoading ? <PageSkeleton label="채널 연결 상태를 불러오는 중입니다." /> : null}

      {!channelsLoading && apiNotice ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body">
            <Alert title="API 상태" variant="warn">{apiNotice}</Alert>
          </div>
        </section>
      ) : null}

      {!channelsLoading ? <><div className="grid three" data-guide="channel-list">
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
              <h2 className="channel-identity"><ChannelLogo channel={channel.type} decorative size={22} /><span>{channel.label}</span></h2>
              <div className="actions">
                <Badge variant={badgeFor(channel.status)}>{statusLabels[channel.status]}</Badge>
                <Switch
                  label={`${channel.label} 채널 활성화`}
                  checked={channel.enabled && channel.status === "connected" && channel.oauthState === "connected"}
                  disabled={updatingChannel === channel.type || channel.status !== "connected" || channel.oauthState !== "connected"}
                  onChange={(enabled) => void toggleChannel(channel, enabled)}
                />
              </div>
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
              {channel.status !== "connected" || channel.oauthState !== "connected" ? <p className="muted small">인증 후 활성화할 수 있습니다.</p> : null}
              <div className="actions channel-card-actions">
                <button className="button" type="button" aria-label={`${channel.label} 연결 가이드`} onClick={() => setGuideChannel(channel.type)}>
                  연결 가이드
                </button>
                {channelAction(channel)}
              </div>
            </div>
          </article>
        ))}
      </div>

      <section id="check-result" className="panel" style={{ marginTop: 16 }} data-guide="channel-status">
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

      <section className="panel" style={{ marginTop: 16 }} data-guide="dm-readiness">
        <div className="panel-head"><h2>Instagram DM 자동답변</h2>{dmSettings ? <Switch label="DM 자동답변" checked={dmSettings.enabled} onChange={toggleDm} /> : null}</div>
        <div className="panel-body grid">
          {!dmSettings ? <EmptyState title="DM 상태를 불러올 수 없습니다" description="API 연결 후 메시지 권한과 Wiki 상태를 확인할 수 있습니다." /> : <>
            <div className="actions">
              <Badge variant={dmSettings.wikiReady ? "ok" : "warn"}>Wiki {dmSettings.wikiReady ? "준비됨" : "필요"}</Badge>
              <Badge variant={dmSettings.messagePermissionReady ? "ok" : "warn"}>메시지 권한 {dmSettings.messagePermissionReady ? "확인됨" : "필요"}</Badge>
              <Badge variant={dmSettings.workerStatus === "online" ? "ok" : "warn"}>워커 {dmSettings.workerStatus === "online" ? "온라인" : "오프라인"}</Badge>
            </div>
            {!dmSettings.wikiReady || !dmSettings.messagePermissionReady || dmSettings.workerStatus !== "online" ? <Alert title="자동답변을 켤 수 없습니다" variant="warn">FAQ/Wiki, Instagram 메시지 권한, DM 워커 상태를 모두 준비한 후 활성화할 수 있습니다.</Alert> : null}
            <p className="muted">근거가 부족하거나 처리 오류가 나면 고정 안내문을 발송하고, 처리 이력에 남깁니다.</p>
          </>}
        </div>
      </section></> : null}
      {guideChannel ? <ChannelConnectionGuideDialog guide={channelGuides[guideChannel]} onClose={() => setGuideChannel(null)} /> : null}
    </section>
  );
}
