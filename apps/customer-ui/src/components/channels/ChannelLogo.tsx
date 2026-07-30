import type { ChannelType } from "../../types";

const logoPaths: Record<ChannelType, string> = {
  instagram: "/assets/channels/instagram.svg",
  threads: "/assets/channels/threads.svg",
  x: "/assets/channels/x.svg",
  linkedin: "/assets/channels/linkedin.png",
  tiktok: "/assets/channels/tiktok.svg",
  youtube: "/assets/channels/youtube.svg",
};

export function ChannelLogo({
  channel,
  decorative = false,
  label,
  size = 20,
  className = "",
}: {
  channel: ChannelType;
  decorative?: boolean;
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={["channel-logo", `channel-logo--${channel}`, className].filter(Boolean).join(" ")}
      src={logoPaths[channel]}
      alt={decorative ? "" : (label ?? channel)}
      width={size}
      height={size}
      aria-hidden={decorative || undefined}
      draggable={false}
    />
  );
}
