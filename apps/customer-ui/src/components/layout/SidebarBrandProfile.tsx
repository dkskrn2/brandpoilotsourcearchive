import { ChevronRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { BrandLogo } from "../brand/BrandLogo";

interface SidebarBrandProfileProps {
  brandName: string;
  logoUrl: string | null;
}

export function SidebarBrandProfile({ brandName, logoUrl }: SidebarBrandProfileProps) {
  return (
    <NavLink
      className="sidebar-brand-profile"
      to="/brand-settings"
      aria-label={`${brandName} 브랜드 설정 열기`}
    >
      <BrandLogo brandName={brandName} logoUrl={logoUrl} className="sidebar-brand-logo" />
      <span className="sidebar-brand-copy">
        <strong>{brandName}</strong>
        <small>브랜드 설정</small>
      </span>
      <ChevronRight size={17} aria-hidden="true" />
    </NavLink>
  );
}

