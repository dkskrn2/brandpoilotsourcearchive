import { ProjectsBrowser } from "@/components/projects-browser";
import { getProjects } from "@/lib/projects";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Work",
  description: "Explore GROWTHLINE projects across corporate websites, mobile products, chatbots, campaigns, and ongoing digital operations.",
  path: "/en/work",
  locale: "en",
  localized: true
});

export default function EnglishWorkPage() {
  const projects = getProjects("en");
  const years = projects.map((project) => Number(project.year)).filter(Boolean);
  const yearRange = `${Math.min(...years)}-${Math.max(...years)}`;
  const domainCount = new Set(projects.map((project) => project.domainKey)).size;

  return (
    <main className="work-page">
      <section className="work-hero">
        <div className="work-hero__copy">
          <p>Work</p>
          <h1>See the problem we took on<br />and <em>what we delivered.</em></h1>
          <span>A record of real projects spanning corporate websites, mobile products, chatbots, campaigns, and ongoing operations.</span>
        </div>
        <dl className="work-hero__facts" aria-label="Project archive summary">
          <div><dt>Projects</dt><dd>{projects.length}</dd></div>
          <div><dt>Period</dt><dd>{yearRange}</dd></div>
          <div><dt>Disciplines</dt><dd>{domainCount}</dd></div>
        </dl>
      </section>
      <ProjectsBrowser projects={projects} locale="en" />
    </main>
  );
}
