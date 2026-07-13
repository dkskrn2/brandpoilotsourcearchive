import { ProjectsBrowser } from "@/components/projects-browser";
import { getProjects } from "@/lib/projects";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Work",
  description: "GROWTHLINE이 수행한 기업 웹, 앱, 챗봇, 운영 프로젝트와 해결 과정을 확인하세요.",
  path: "/work",
  localized: true
});

export default function WorkPage() {
  const projects = getProjects();
  const years = projects.map((project) => Number(project.year)).filter(Boolean);
  const yearRange = `${Math.min(...years)}-${Math.max(...years)}`;
  const domainCount = new Set(projects.map((project) => project.domainKey)).size;

  return (
    <main className="work-page">
      <section className="work-hero">
        <div className="work-hero__copy">
          <p>Work</p>
          <h1>어떤 문제를 맡았고,<br /><em>무엇을 만들었는지</em> 확인하세요.</h1>
          <span>기업 웹부터 앱, 챗봇, 운영까지 실제 수행한 프로젝트를 정리했습니다.</span>
        </div>
        <dl className="work-hero__facts" aria-label="프로젝트 아카이브 요약">
          <div><dt>프로젝트</dt><dd>{projects.length}</dd></div>
          <div><dt>기록 기간</dt><dd>{yearRange}</dd></div>
          <div><dt>분야</dt><dd>{domainCount}</dd></div>
        </dl>
      </section>
      <ProjectsBrowser projects={projects} />
    </main>
  );
}
