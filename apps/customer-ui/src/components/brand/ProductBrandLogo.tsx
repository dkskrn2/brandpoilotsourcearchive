interface ProductBrandLogoProps {
  placement: "login" | "sidebar";
}

export function ProductBrandLogo({ placement }: ProductBrandLogoProps) {
  return (
    <img
      className={`product-brand-logo product-brand-logo--${placement}`}
      src="/assets/brand/mojong-ad-logo.png"
      alt="모종 AD"
    />
  );
}
