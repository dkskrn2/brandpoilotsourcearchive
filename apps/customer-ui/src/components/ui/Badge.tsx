import type { BadgeVariant } from "../../types";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  const className = variant === "neutral" ? "badge" : `badge ${variant}`;
  return <span className={className}>{children}</span>;
}
