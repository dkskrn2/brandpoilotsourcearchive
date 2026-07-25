import type { BadgeVariant } from "../../types";

interface AlertProps {
  title: string;
  children: React.ReactNode;
  variant?: Extract<BadgeVariant, "info" | "ok" | "warn" | "bad">;
}

export function Alert({ title, children, variant = "info" }: AlertProps) {
  return (
    <div className={`alert ${variant}`}>
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}
