import type { BrandPrimaryCategoryDto, BrandSubcategoryDto } from "./types.js";

export function formatBrandCategoryContext(profile: {
  primaryCategory: BrandPrimaryCategoryDto | null;
  subcategories: BrandSubcategoryDto[];
}) {
  const primary = profile.primaryCategory?.name ?? "미설정";
  const details = profile.subcategories.map((item) => item.name);
  return details.length > 0 ? `${primary} / ${details.join(", ")}` : primary;
}

export function normalizeCustomSubcategory(value: string) {
  const name = value.normalize("NFKC").trim();
  return { name, key: name.toLocaleLowerCase("ko-KR") };
}
