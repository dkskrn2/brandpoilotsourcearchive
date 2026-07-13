export const CONTENT_CATEGORIES = [
  "Brand Strategy",
  "Growth Strategy",
  "Lifecycle Marketing",
  "Marketing Measurement",
  "Brand Case Study",
  "Product Case Study",
  "Digital Transformation",
  "Growth Operations",
  "UX Research",
  "Data Analytics",
  "Content Operations"
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export function isContentCategory(value: string): value is ContentCategory {
  return (CONTENT_CATEGORIES as readonly string[]).includes(value);
}
