import { Link } from "react-router-dom";
import type { AiContentGeneration } from "../../features/ai-content/types";
import type { OnboardingContentState } from "../../features/brand-intelligence/onboardingContentGateway";
import { channelConnectionUrl } from "../../features/channels/channelConnectionUrls";
import type { ChannelConnection } from "../../types";
import { AiContentArtifactPreview } from "../ai-content/AiContentArtifactPreview";
import { AiContentPhaseProgress } from "../ai-content/AiContentPhaseProgress";
import { Alert } from "../ui/Alert";

export function OnboardingContentResult({
  state,
  generation,
  channels,
  channelStatus,
}: {
  state: OnboardingContentState;
  generation: AiContentGeneration | null;
  channels: readonly ChannelConnection[];
  channelStatus: "loading" | "ready" | "failed";
}) {
  const instagram = channels.find((channel) => channel.type === "instagram") ?? null;
  const instagramConnected = instagram?.enabled === true
    && instagram.status === "connected"
    && instagram.oauthState === "connected";
  const output = generation?.outputs.find((item) => item.status === "completed") ?? null;

  return (
    <section className="brand-center-preview__card onboarding-content-result" aria-labelledby="onboarding-result-title">
      <div className="brand-center-preview__card-heading">
        <p className="brand-center-preview__eyebrow">완료</p>
        <h2 id="onboarding-result-title">브랜드 준비가 완료되었습니다</h2>
        <p>확정한 브랜드 정보가 콘텐츠 생성과 브랜드 운영 기준에 저장되었습니다.</p>
      </div>

      {state.state === "not_started" ? (
        <div className="onboarding-content-result__empty">
          <h3>첫 카드뉴스도 바로 만들어 보세요</h3>
          <p>온보딩 중 선택한 주제가 없어 운영 콘텐츠 생성 화면에서 시작할 수 있습니다.</p>
          <Link className="brand-center-preview__primary-action" to="/ai-content/new">카드뉴스 생성하기</Link>
        </div>
      ) : null}

      {state.state === "preparing" || state.state === "generating" ? (
        <div className="onboarding-content-result__progress" aria-busy="true" aria-live="polite">
          <span className="onboarding-content-result__spinner" aria-hidden="true" />
          <div>
            <h3>첫 카드뉴스를 만들고 있습니다</h3>
            <p>{state.title ?? "선택한 주제"} · 완료되면 이 화면에 자동으로 표시됩니다.</p>
          </div>
          <AiContentPhaseProgress current={state.state === "generating" ? "generating" : "proposal_selection"} />
        </div>
      ) : null}

      {state.state === "failed" ? (
        <div className="onboarding-content-result__failure">
          <Alert title="카드뉴스를 완성하지 못했습니다." variant="bad">
            {state.errorMessage ?? "운영 콘텐츠 생성 화면에서 다시 생성해 주세요."}
          </Alert>
          <Link className="brand-center-preview__primary-action" to="/ai-content/new">다시 생성하기</Link>
        </div>
      ) : null}

      {state.state === "completed" ? (
        <div className="onboarding-content-result__completed">
          <div>
            <h3>{generation?.title ?? state.title ?? "첫 카드뉴스"}</h3>
            <p>카드뉴스 생성이 완료되었습니다. 결과를 확인하고 Instagram 게시로 이어가세요.</p>
          </div>
          {output ? <AiContentArtifactPreview output={output} /> : (
            <p role="status">완성된 결과를 불러오고 있습니다...</p>
          )}
          <div className="onboarding-content-result__actions">
            {state.generationId ? (
              <Link className="button" to={`/ai-content/${state.generationId}`}>전체 결과 보기</Link>
            ) : null}
            {channelStatus === "loading" ? (
              <p role="status">Instagram 연결 상태를 확인하고 있습니다.</p>
            ) : channelStatus === "failed" ? (
              <Alert title="Instagram 연결 확인 오류" variant="bad">
                Instagram 연결 상태를 확인하지 못했습니다. 자동으로 다시 확인합니다.
              </Alert>
            ) : instagramConnected && state.generationId ? (
              <Link className="brand-center-preview__primary-action" to={`/ai-content/${state.generationId}`}>
                게시하러 가기
              </Link>
            ) : (
              <div className="onboarding-content-result__oauth">
                <p>게시하려면 먼저 Instagram 로그인이 필요합니다.</p>
                <a
                  className="brand-center-preview__primary-action"
                  href={channelConnectionUrl("instagram", "/onboarding/brand-intelligence") ?? "/channels"}
                >Instagram 로그인</a>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
