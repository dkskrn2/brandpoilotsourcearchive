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
import {
  channelConnectionAction,
  parseChannelConnectionCallback,
  type ChannelConnectionCallback
} from "../features/channels/channelConnectionUrls";
import { channelCapabilityViewModel } from "../features/channels/channelCapabilityViewModel";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type {
  ChannelCapability,
  ChannelConnection,
  ChannelStatus,
  InstagramDmSettings,
} from "../types";

function alertVariantFor(status: ChannelStatus) {
  if (status === "connected") return "ok";
  if (status === "not_connected" || status === "publish_failed") return "bad";
  return "warn";
}

function channelAction(
  channel: ChannelConnection | null,
  capability: ChannelCapability,
  repairAction: { kind: "oauth" | "guide"; label: string },
  openGuide: () => void,
) {
  if (capability.channel === "instagram" && repairAction.kind === "guide") {
    return <button className="button primary" type="button" onClick={openGuide}>{repairAction.label}</button>;
  }
  const action = channelConnectionAction(capability.channel, channel?.oauthState === "connected");
  if (action.kind === "guide") {
    return <button className="button is-disabled" type="button" disabled>{action.label}</button>;
  }
  return (
    <a className="button primary" href={action.href} data-guide="meta-oauth">
      {action.label}
    </a>
  );
}

function connectionCallbackNotice(callback: ChannelConnectionCallback) {
  if (callback.outcome === "success") {
    return {
      title: "Instagram 연결 완료",
      message: "Instagram 계정 연결이 완료되었습니다.",
      role: "status" as const,
      variant: "ok" as const
    };
  }
  if (callback.outcome === "cancelled") {
    return {
      title: "Instagram 연결 취소",
      message: "Instagram 계정 연결이 취소되었습니다. 다시 시도할 수 있습니다.",
      role: "status" as const,
      variant: "warn" as const
    };
  }
  const messages = {
    account_mapping_failed: "Instagram 전문 계정을 확인하지 못했습니다.",
    authentication_required: "로그인 세션을 확인한 뒤 Instagram 연결을 다시 시도해 주세요.",
    connection_failed: "Instagram 연결을 완료하지 못했습니다.",
    insufficient_permissions: "Instagram 게시 권한을 모두 승인한 뒤 다시 시도해 주세요.",
    invalid_callback: "Instagram 연결 요청이 만료되었거나 유효하지 않습니다.",
    token_exchange_failed: "Instagram 인증 정보를 확인하지 못했습니다."
  };
  return {
    title: "Instagram 연결 실패",
    message: messages[callback.reason ?? "connection_failed"],
    role: "alert" as const,
    variant: "bad" as const
  };
}

export function ChannelsPage() {
  const [connectionCards, setConnectionCards] = useState<ChannelConnection[]>([]);
  const [capabilities, setCapabilities] = useState<ChannelCapability[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsLoadError, setChannelsLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [dmSettings, setDmSettings] = useState<InstagramDmSettings | null>(null);
  const [updatingChannel, setUpdatingChannel] = useState<ChannelConnection["type"] | null>(null);
  const [guideChannel, setGuideChannel] = useState<ChannelConnection["type"] | null>(null);
  const [connectionCallback] = useState(() => parseChannelConnectionCallback(window.location.search));
  const callbackNotice = connectionCallback ? connectionCallbackNotice(connectionCallback) : null;

  const attentionCount = capabilities.filter(
    (capability) => capability.catalogStatus === "planned"
      || capability.connectionStatus !== "connected",
  ).length;
  const connectionStatusBadge = capabilities.length === 0
    ? { label: "상태 없음", variant: "neutral" as const }
    : {
      label: attentionCount === 0 ? "모두 연결됨" : `${attentionCount}개 미연결`,
      variant: attentionCount === 0 ? "ok" as const : "warn" as const
    };
  const availableCapabilityChannels = new Set(
    capabilities
      .filter((capability) => capability.catalogStatus === "available")
      .map((capability) => capability.channel),
  );

  useEffect(() => {
    let ignore = false;
    setChannelsLoading(true);
    setChannelsLoadError(false);
    Promise.all([
      api.listChannels(DEMO_BRAND_ID),
      api.getChannelCapabilities(DEMO_BRAND_ID),
    ])
      .then(([apiChannels, apiCapabilities]) => {
        if (ignore) return;
        setConnectionCards(apiChannels);
        setCapabilities(apiCapabilities);
        setChannelsLoadError(false);
        setApiNotice(null);
      })
      .catch(() => {
        if (ignore) return;
        setConnectionCards([]);
        setCapabilities([]);
        setChannelsLoadError(true);
      })
      .finally(() => {
        if (!ignore) setChannelsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!connectionCallback) return;
    const url = new URL(window.location.href);
    for (const key of connectionCallback.consumedKeys) {
      url.searchParams.delete(key);
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }, [connectionCallback]);

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

      {callbackNotice ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body">
            <div role={callbackNotice.role} aria-label={callbackNotice.title}>
              <Alert title={callbackNotice.title} variant={callbackNotice.variant}>
                {callbackNotice.message}
              </Alert>
            </div>
          </div>
        </section>
      ) : null}

      {channelsLoading ? <PageSkeleton label="채널 연결 상태를 불러오는 중입니다." /> : null}

      {!channelsLoading && apiNotice ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body">
            <Alert title="API 상태" variant="warn">{apiNotice}</Alert>
          </div>
        </section>
      ) : null}

      {!channelsLoading && channelsLoadError ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body grid" role="alert" aria-label="채널 지원 범위를 불러오지 못했습니다">
            <Alert title="채널 지원 범위를 불러오지 못했습니다" variant="bad">
              API에서 현재 연결·생성·내보내기·게시 가능 범위를 확인하지 못했습니다. 지원 상태를 임의로 표시하지 않습니다.
            </Alert>
            <EmptyState
              title="연결 상태를 불러올 수 없습니다"
              description="API 서버가 응답하지 않아 현재 지원 상태를 표시할 수 없습니다."
            />
            <div className="actions">
              <button className="button primary" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>다시 시도</button>
            </div>
          </div>
        </section>
      ) : null}

      {!channelsLoading && !channelsLoadError ? <><div className="grid three channel-capability-grid" data-guide="channel-list">
        {capabilities.map((capability) => {
          const channel = connectionCards.find((item) => item.type === capability.channel) ?? null;
          const view = channelCapabilityViewModel(capability, channel);
          const canActivate = capability.catalogStatus === "available"
            && capability.connectionStatus === "connected"
            && channel?.oauthState === "connected";
          return (
          <article className="panel channel-capability-card" key={capability.channel}>
            <div className="panel-head">
              <h2 className="channel-identity"><ChannelLogo channel={capability.channel} decorative size={22} /><span>{view.label}</span></h2>
              <div className="actions">
                <Badge variant={view.rows[0].tone}>{view.rows[0].state}</Badge>
                <Switch
                  label={`${view.label} 채널 활성화`}
                  checked={Boolean(channel?.enabled && canActivate)}
                  disabled={!channel || updatingChannel === capability.channel || !canActivate}
                  onChange={(enabled) => { if (channel) void toggleChannel(channel, enabled); }}
                />
              </div>
            </div>
            <div className="panel-body grid">
              <dl className="channel-capability-list">
                {view.rows.map((row) => (
                  <div className="channel-capability-row" key={row.key}>
                    <dt>{row.label}</dt>
                    <dd>
                      <Badge variant={row.tone}>{row.state}</Badge>
                      <span className="muted small">{row.detail}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {capability.catalogStatus === "available" && channel?.alertTitle ? (
                <Alert title={channel.alertTitle} variant={alertVariantFor(channel.status)}>
                  {channel.alertBody}
                </Alert>
              ) : null}
              {!canActivate ? <p className="muted small">인증 후 활성화할 수 있습니다.</p> : null}
              <div className="actions channel-card-actions">
                <button className="button" type="button" aria-label={`${view.label} 연결 가이드`} onClick={() => setGuideChannel(capability.channel)}>
                  연결 가이드
                </button>
                {channelAction(channel, capability, view.repairAction, () => setGuideChannel(capability.channel))}
              </div>
            </div>
          </article>
          );
        })}
      </div>

      <section id="check-result" className="panel" style={{ marginTop: 16 }} data-guide="channel-status">
        <div className="panel-head">
          <h2>연결 상태 요약</h2>
          <Badge variant={connectionStatusBadge.variant}>{connectionStatusBadge.label}</Badge>
        </div>
        <div className="panel-body grid">
          {connectionCards
            .filter((channel) => (
              availableCapabilityChannels.has(channel.type) && channel.alertTitle
            ))
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
