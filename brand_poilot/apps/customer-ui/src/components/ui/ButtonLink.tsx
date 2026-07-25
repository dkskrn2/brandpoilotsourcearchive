import { Link } from "react-router-dom";

interface ButtonLinkProps {
  to: string;
  children: React.ReactNode;
  variant?: "primary" | "danger";
  disabled?: boolean;
}

export function ButtonLink({ to, children, variant, disabled = false }: ButtonLinkProps) {
  const className = ["button", variant, disabled ? "is-disabled" : undefined].filter(Boolean).join(" ");

  if (disabled) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }

  return (
    <Link className={className} to={to}>
      {children}
    </Link>
  );
}
