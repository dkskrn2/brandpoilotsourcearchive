import { LoaderCircle } from "lucide-react";

interface LoadingProps {
  label: string;
  className?: string;
}

function classes(base: string, className = "") {
  return className ? `${base} ${className}` : base;
}

export function PageSkeleton({ label, className }: LoadingProps) {
  return (
    <div className={classes("skeleton-page", className)} role="status" aria-label={label} aria-busy="true">
      <div className="skeleton-line is-title" aria-hidden="true" />
      <div className="skeleton-metric-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div className="skeleton-block" key={index} />)}
      </div>
      <div className="skeleton-block is-content" aria-hidden="true" />
    </div>
  );
}

export function ListSkeleton({
  rows = 5,
  columns = 4,
  label,
  className
}: LoadingProps & { rows?: number; columns?: number }) {
  return (
    <div className={classes("skeleton-list", className)} role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <div
          className="skeleton-list__row"
          data-testid="skeleton-row"
          key={row}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {Array.from({ length: columns }, (_, column) => <span className="skeleton-line" key={column} />)}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 6, label, className }: LoadingProps & { count?: number }) {
  return (
    <div className={classes("skeleton-card-grid", className)} role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" data-testid="skeleton-card" key={index} aria-hidden="true">
          <div className="skeleton-card__media" />
          <div className="skeleton-line" />
          <div className="skeleton-line is-short" />
        </div>
      ))}
    </div>
  );
}

export function LoadingOverlay({ label, className }: LoadingProps) {
  return (
    <div className={classes("loading-overlay", className)} role="status" aria-label={label} aria-busy="true">
      <LoaderCircle aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function InlineSpinner({ label, className }: LoadingProps) {
  return <LoaderCircle className={classes("inline-spinner", className)} aria-label={label} role="img" />;
}
