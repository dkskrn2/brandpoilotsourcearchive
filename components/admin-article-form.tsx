import type { StoredArticle } from "@/lib/content-db";
import { DEFAULT_ARTICLE_HTML } from "@/lib/content-html";
import { CONTENT_CATEGORIES, isContentCategory } from "@/lib/content-categories";
import { NaverSmartEditor } from "@/components/naver-smart-editor";
import { AdminImageUpload, AdminImageUploadProvider } from "@/components/admin-image-upload";
import { AdminPendingSubmitButton } from "@/components/admin-pending-submit-button";

type AdminArticleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  article?: StoredArticle;
  submitLabel: string;
};

export function AdminArticleForm({ action, article, submitLabel }: AdminArticleFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const selectedCategory = article && isContentCategory(article.category)
    ? article.category
    : CONTENT_CATEGORIES[0];

  return (
    <AdminImageUploadProvider>
      <form className="admin-editor-form" action={action}>
        <div className="admin-editor-form__main">
          <section>
            <h2>기본 정보</h2>
            <label><span>제목</span><input name="title" required defaultValue={article?.title} placeholder="콘텐츠 제목" /></label>
            <label><span>슬러그</span><input name="slug" required defaultValue={article?.slug} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="content-url-slug" /><small>영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.</small></label>
            <label><span>요약</span><textarea name="summary" required rows={3} defaultValue={article?.summary} placeholder="목록과 검색 결과에 표시할 짧은 설명" /></label>
            <label><span>도입 문장</span><textarea name="introduction" required rows={4} defaultValue={article?.introduction} placeholder="상세 페이지 본문 첫 문장" /></label>
          </section>

          <section>
            <h2>본문</h2>
            <div className="admin-editor-field"><span>글 내용</span><NaverSmartEditor defaultValue={article?.bodyHtml ?? DEFAULT_ARTICLE_HTML} /></div>
          </section>

          <section>
            <h2>대표 이미지</h2>
            <AdminImageUpload initialImage={article?.image} initialImageAlt={article?.imageAlt} />
          </section>
        </div>

        <aside className="admin-editor-form__side">
          <section>
            <h2>발행 설정</h2>
            <label><span>상태</span><select name="status" defaultValue={article?.status ?? "draft"}><option value="draft">임시 저장</option><option value="published">게시</option></select></label>
            <label>
              <span>카테고리</span>
              <select name="category" required defaultValue={selectedCategory}>
                {CONTENT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <small>등록된 카테고리 중 하나를 선택합니다.</small>
            </label>
            <label><span>게시일</span><input type="date" name="publishedAt" required defaultValue={article?.publishedAt ?? today} /></label>
            <label><span>읽기 시간</span><input name="readingTime" required defaultValue={article?.readingTime ?? "5분"} placeholder="5분" /></label>
            <AdminPendingSubmitButton label={submitLabel} />
          </section>
        </aside>
      </form>
    </AdminImageUploadProvider>
  );
}
