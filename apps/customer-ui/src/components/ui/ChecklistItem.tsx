import { ButtonLink } from "./ButtonLink";
import { Badge } from "./Badge";
import type { BadgeVariant } from "../../types";

interface ChecklistItemProps {
  marker: string;
  title: string;
  description: string;
  actionLabel: string;
  completed?: boolean;
  statusLabel?: string;
  statusVariant?: BadgeVariant;
  to?: string;
}

export function ChecklistItem({
  marker,
  title,
  description,
  actionLabel,
  completed = false,
  statusLabel,
  statusVariant = "neutral",
  to
}: ChecklistItemProps) {
  return (
    <li className="check-item">
      <span className={`check-dot${completed ? "" : " is-incomplete"}`}>{marker}</span>
      <div>
        <strong>{title}</strong>
        <div className="muted small">{description}</div>
      </div>
      <div className="check-actions">
        {statusLabel ? <Badge variant={statusVariant}>{statusLabel}</Badge> : null}
        {to ? <ButtonLink to={to}>{actionLabel}</ButtonLink> : <span className="button is-disabled" aria-disabled="true">{actionLabel}</span>}
      </div>
    </li>
  );
}
