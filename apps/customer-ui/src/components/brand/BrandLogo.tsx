import { useEffect, useState } from "react";

interface BrandLogoProps {
  brandName: string;
  logoUrl: string | null;
  className?: string;
}

function brandInitials(brandName: string) {
  const normalized = brandName.trim();
  if (!normalized) return "모종";
  const words = normalized.split(/\s+/);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join("");
  return normalized.slice(0, 2);
}

export function BrandLogo({ brandName, logoUrl, className = "" }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  const classes = ["brand-logo", className].filter(Boolean).join(" ");
  if (logoUrl && !failed) {
    return <img className={classes} src={logoUrl} alt={`${brandName} 로고`} onError={() => setFailed(true)} />;
  }
  return (
    <span className={`${classes} brand-logo-fallback`} role="img" aria-label={`${brandName} 대체 로고`}>
      {brandInitials(brandName)}
    </span>
  );
}
