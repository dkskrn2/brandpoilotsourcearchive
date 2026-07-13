"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Buildings, ChartLineUp, ChatCircleDots, DeviceMobile, Megaphone, SquaresFour, Wrench } from "@phosphor-icons/react";
import type { Project } from "@/lib/projects";

const domains = [
  { key: "all", label: "전체", icon: SquaresFour },
  { key: "enterprise_web", label: "기업 웹", icon: Buildings },
  { key: "app_mobile", label: "앱·모바일", icon: DeviceMobile },
  { key: "ai_conversational", label: "AI·챗봇", icon: ChatCircleDots },
  { key: "marketing_campaign", label: "마케팅", icon: Megaphone },
  { key: "operation_maintenance", label: "운영", icon: Wrench },
  { key: "finance_insurance", label: "금융", icon: ChartLineUp }
] as const;

const domainLabels: Record<string, string> = {
  enterprise_web: "기업 웹",
  app_mobile: "앱·모바일",
  ai_conversational: "AI·챗봇",
  marketing_campaign: "마케팅 캠페인",
  operation_maintenance: "운영·유지보수",
  finance_insurance: "금융·보험"
};

export function ProjectsBrowser({ projects }: { projects: Project[] }) {
  const [domain, setDomain] = useState("all");
  const filtered = useMemo(() => domain === "all" ? projects : projects.filter((project) => project.domainKey === domain), [domain, projects]);
  const counts = useMemo(() => Object.fromEntries(domains.map(({ key }) => [key, key === "all" ? projects.length : projects.filter((project) => project.domainKey === key).length])), [projects]);

  return (
    <div className="projects-browser">
      <div className="project-controls">
        <div>
          <strong>프로젝트 아카이브</strong>
          <p className="project-count" aria-live="polite">현재 {filtered.length}개 프로젝트</p>
        </div>
        <div className="project-filters" aria-label="프로젝트 분야 필터">
          {domains.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" className={domain === key ? "is-active" : ""} aria-pressed={domain === key} onClick={() => setDomain(key)}>
              <Icon aria-hidden size={18} />
              <span>{label}</span>
              <small>{counts[key]}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="project-grid">
        {filtered.map((project, index) => {
          const href = project.primaryLinkType === "detail" ? `/detail?slug=${project.slug}` : project.primaryLinkUrl;
          const external = project.primaryLinkType === "external";
          return (
            <article className={`project-card ${index === 0 ? "project-card--featured" : ""} ${project.detailEnabled ? "has-detail" : ""}`} key={project.id}>
              <div className="project-card__meta">
                <span className="project-card__number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <span>{project.year}</span>
                  <span>{domainLabels[project.domainKey] ?? project.domainKey}</span>
                </div>
              </div>
              <h2>{project.title}</h2>
              <p>{project.summary}</p>
              {project.detailEnabled ? (
                <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
                  프로젝트 보기 <ArrowRight aria-hidden size={19} />
                </a>
              ) : <span className="project-card__status">프로젝트 요약</span>}
            </article>
          );
        })}
      </div>
      {filtered.length === 0 ? <p className="project-empty">해당 분야의 프로젝트가 없습니다.</p> : null}
    </div>
  );
}
