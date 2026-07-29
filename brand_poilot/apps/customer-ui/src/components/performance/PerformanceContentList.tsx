import { ChannelLogo } from "../channels/ChannelLogo";
import type { ChannelType, PerformanceInsights } from "../../types";

type Content = PerformanceInsights["topContents"][number];

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
};

const formatLabels: Record<string, string> = {
  instagram_feed_carousel: "카드뉴스",
  instagram_story: "스토리",
  instagram_reel: "Reel",
  threads_text: "텍스트",
  tiktok_video: "영상",
  youtube_video: "영상",
  youtube_short: "Short",
  linkedin_post: "게시물",
  x_post: "텍스트",
};

function exposure(value: number | null) {
  return value === null ? "미수집" : `${value.toLocaleString("ko-KR")}회`;
}

export function PerformanceContentList({
  contents,
  onOpen,
}: {
  contents: Content[];
  onOpen: (content: Content, trigger: HTMLButtonElement) => void;
}) {
  return (
    <section className="performance-top" aria-labelledby="performance-top-title">
      <header className="performance-section-heading">
        <div>
          <p className="performance-eyebrow">TOP CONTENT</p>
          <h2 id="performance-top-title">성과 콘텐츠</h2>
        </div>
        <p>최근 수집값을 같은 기준으로 비교합니다.</p>
      </header>
      {contents.length ? (
        <ol className="performance-content-list" aria-label="성과 콘텐츠">
          {contents.map((content, index) => {
            const metadataId = `performance-content-${content.publishQueueId}-metadata`;
            const exposureId = `performance-content-${content.publishQueueId}-exposure`;
            return (
              <li key={content.publishQueueId}>
                <button
                  type="button"
                  onClick={(event) => onOpen(content, event.currentTarget)}
                  aria-label={`${content.title} 상세 보기`}
                  aria-describedby={`${metadataId} ${exposureId}`}
                >
                  <span className="performance-content-rank">{index + 1}</span>
                  <span className="performance-content-copy">
                    <strong>{content.title}</strong>
                    <small className="channel-identity" id={metadataId}>
                      <ChannelLogo channel={content.channel} decorative size={16} />
                      <span>
                        {channelLabels[content.channel]}
                        {content.deliveryFormat
                          ? ` · ${formatLabels[content.deliveryFormat] ?? content.deliveryFormat}`
                          : ""}
                      </span>
                    </small>
                  </span>
                  <strong className="performance-content-exposure" id={exposureId}>
                    {exposure(content.exposureCount)}
                  </strong>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="performance-state">성과가 수집된 콘텐츠가 없습니다.</p>
      )}
    </section>
  );
}
