"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createArticle,
  deleteArticle,
  getArticleById,
  updateArticle,
  updateArticleStatus,
  type ArticleInput,
  type ArticleStatus
} from "@/lib/content-db";
import { articleTextContent, sanitizeArticleHtml } from "@/lib/content-html";
import { requireAdminSession } from "@/lib/admin-auth";

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function parseArticleInput(formData: FormData): ArticleInput {
  const input: ArticleInput = {
    slug: value(formData, "slug"),
    category: value(formData, "category"),
    title: value(formData, "title"),
    summary: value(formData, "summary"),
    publishedAt: value(formData, "publishedAt"),
    readingTime: value(formData, "readingTime"),
    image: value(formData, "image"),
    imageAlt: value(formData, "imageAlt"),
    introduction: value(formData, "introduction"),
    body: sanitizeArticleHtml(value(formData, "body")),
    status: value(formData, "status") as ArticleStatus
  };

  const required = Object.entries(input).filter(([, fieldValue]) => !fieldValue).map(([key]) => key);
  if (required.length) throw new Error(`필수 항목을 입력해주세요: ${required.join(", ")}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw new Error("슬러그는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.");
  if (!/^\/images\/[a-zA-Z0-9._/-]+$/.test(input.image) || input.image.includes("..")) {
    throw new Error("대표 이미지는 /images/ 아래의 로컬 경로를 입력해주세요.");
  }
  if (!['draft', 'published'].includes(input.status)) throw new Error("올바른 게시 상태를 선택해주세요.");
  if (!articleTextContent(input.body)) throw new Error("본문 내용을 입력해주세요.");
  return input;
}

function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.includes("UNIQUE constraint failed") || (error as { code?: string })?.code === "23505"
    ? "이미 사용 중인 슬러그입니다."
    : message;
}

function refreshContent(slug?: string) {
  revalidatePath("/admin");
  revalidatePath("/content");
  revalidatePath("/sitemap.xml");
  if (slug) revalidatePath(`/content/${slug}`);
}

export async function createArticleAction(formData: FormData) {
  await requireAdminSession("/admin/content/new");
  let id: number;
  try {
    id = await createArticle(parseArticleInput(formData));
  } catch (error) {
    redirect(`/admin/content/new?error=${encodeURIComponent(errorMessage(error, "저장하지 못했습니다."))}`);
  }
  refreshContent();
  redirect(`/admin/content/${id}?notice=${encodeURIComponent("콘텐츠를 저장했습니다.")}`);
}

export async function updateArticleAction(id: number, formData: FormData) {
  await requireAdminSession(`/admin/content/${id}`);
  const previous = await getArticleById(id);
  if (!previous) redirect("/admin?error=not-found");
  let input: ArticleInput;
  try {
    input = parseArticleInput(formData);
    await updateArticle(id, input);
  } catch (error) {
    redirect(`/admin/content/${id}?error=${encodeURIComponent(errorMessage(error, "수정하지 못했습니다."))}`);
  }
  refreshContent(previous.slug);
  refreshContent(input.slug);
  redirect(`/admin/content/${id}?notice=${encodeURIComponent("수정 사항을 저장했습니다.")}`);
}

export async function toggleArticleStatusAction(id: number, formData: FormData) {
  await requireAdminSession("/admin");
  const article = await getArticleById(id);
  if (!article) return;
  const status = value(formData, "status") as ArticleStatus;
  if (!['draft', 'published'].includes(status)) return;
  await updateArticleStatus(id, status);
  refreshContent(article.slug);
}

export async function deleteArticleAction(id: number) {
  await requireAdminSession(`/admin/content/${id}`);
  const article = await getArticleById(id);
  if (!article) redirect("/admin");
  await deleteArticle(id);
  refreshContent(article.slug);
  redirect(`/admin?notice=${encodeURIComponent("콘텐츠를 삭제했습니다.")}`);
}
