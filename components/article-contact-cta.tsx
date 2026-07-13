import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

export function ArticleContactCta() {
  return (
    <section className="article-contact-cta" aria-labelledby="article-contact-title">
      <div className="article-contact-cta__inner content-shell">
        <div className="article-contact-cta__copy">
          <p className="article-contact-cta__eyebrow">NEXT STEP · 15분 사전 진단</p>
          <h2 id="article-contact-title">다음 성장을 어디서 시작할지 막막한가요?</h2>
          <p>
            현재 사이트와 운영 흐름을 먼저 살펴보고, 매출을 막는 한 구간과
            가장 먼저 실행할 개선 순서를 함께 정리합니다.
          </p>
        </div>
        <Link className="article-contact-cta__button" href="/contact">
          무료 사전 진단 신청하기
          <span aria-hidden="true"><ArrowRight size={18} weight="bold" /></span>
        </Link>
      </div>
    </section>
  );
}
