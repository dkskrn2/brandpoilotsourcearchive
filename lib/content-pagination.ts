export const CONTENT_PAGE_SIZE = 5;

export type ContentListItem = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  publishedAt: string;
  readingTime: string;
  image: string;
  imageAlt: string;
};

export type PublishedArticlePage = {
  items: ContentListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function normalizeContentPage(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(candidate ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function contentPageHref(page: number): Route {
  return (page <= 1 ? "/content" : `/content?page=${page}`) as Route;
}
import type { Route } from "next";
