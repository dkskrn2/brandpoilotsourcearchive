import "server-only";

import fs from "node:fs";
import path from "node:path";

export type Project = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  sortOrder: number;
  year: string;
  primaryLinkUrl: string;
  primaryLinkType: string;
  domainKey: string;
  detailEnabled: boolean;
};

const englishProjects: Record<string, Pick<Project, "title" | "summary">> = {
  "lg-llm-transition-2025": { title: "LG Electronics Chatbot LLM Transition", summary: "Assessed the existing chatbot architecture and its readiness for an LLM-based model, then defined a direction for better response quality and future expansion." },
  "lg-de-lineup-guide-2025": { title: "LG Electronics Germany Lineup Guide", summary: "Planned and built a guide page that makes the product lineup easier to understand for customers in the German market." },
  "lg-th-event-2025": { title: "LG Electronics Thailand Campaign Page", summary: "Planned a localized campaign page and designed the participation flow for marketing operations in Thailand." },
  "lg-story-ops-2025": { title: "LG Electronics Story Operations", summary: "Managed the story publishing operation to keep brand content reliable, timely, and consistent in quality." },
  "lg-story-a11y-2024-2025": { title: "LG Electronics Story Accessibility", summary: "Audited and improved story pages against web-accessibility requirements to make the experience usable by a wider range of visitors." },
  "lg-chatbot-ops-2024-2025": { title: "LG Electronics Chatbot Operations", summary: "Continuously managed chatbot scenarios and operating quality to keep customer support responses accurate and useful." },
  "lg-story-migration-2024": { title: "LG Electronics Story Migration", summary: "Migrated the existing story library into a new environment and stabilized the publishing operation after launch." },
  "lecroi-renewal-2024": { title: "Renault Korea Website Renewal", summary: "Reviewed the existing site structure, redesigned key screens, and validated implementation quality to improve usability and conversion paths." },
  "lg-chatbot-renewal-2023": { title: "LG Electronics Chatbot Renewal", summary: "Restructured the chatbot architecture and conversation scenarios to improve customer-support efficiency and real-world use." },
  "playd-homepage-2022": { title: "PlayD Corporate Website", summary: "Built and managed a corporate website that communicates the company's identity and service portfolio with greater clarity." },
  "25centride-up-2022": { title: "25Centrid App Enhancement", summary: "Reviewed existing app functionality and improved its core user flows to raise the overall completeness of the service." },
  "k2-survey-platform-2022": { title: "K2 Online User Evaluation Platform", summary: "Improved the survey interface and structure to increase the efficiency of collecting and interpreting user evaluations." },
  "cj-pressway-partial-renewal-2022": { title: "CJ Freshway Corporate Website Renewal", summary: "Renewed selected parts of the existing corporate website to improve information delivery and ease of use." },
  "sungsungs-app-2022": { title: "Songsong Mobile App", summary: "Designed the mobile interface and end-to-end user flow around the service's primary customer job." },
  "class-app-2022": { title: "Class Learning App", summary: "Planned the mobile product structure and screens around its central learning-management workflows." },
  "deokhu-app-2022": { title: "Deokking Content App", summary: "Planned the application structure and designed its screens around a clear content-consumption journey." },
  "realseller-app-2021": { title: "RealSeller App", summary: "Designed a mobile product structure and interface focused on accessible, efficient sales management." },
  "heungkuklife-event-2021": { title: "Heungkuk Life Campaign Page", summary: "Planned a campaign-page structure and participation journey designed to move visitors into the event." },
  "ivillage-app-2021": { title: "iVillage Child Development App", summary: "Planned a mobile service structure and interface around the needs of tracking and supporting child development." },
  "seoul-scholarship-ops-2021": { title: "Seoul Scholarship Foundation Website Operations", summary: "Managed the website and its content operation to keep scholarship information accurate and accessible." },
  "holandz-ops-2021": { title: "Home & Tones Website Operations", summary: "Managed the website operation to keep service information current and the customer experience stable." },
  "laonak-kevin-app-2021": { title: "LAONARK Kevin App", summary: "Designed a mobile application interface around a specialized operational workflow." }
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

export function getProjects(locale: "ko" | "en" = "ko"): Project[] {
  const csv = fs.readFileSync(path.join(process.cwd(), "data/seed/projects.csv"), "utf8");
  const [headers, ...rows] = parseCsv(csv);

  return rows.map((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    const domainKey = record.domain_key.trim();
    if (!domainKey || domainKey.includes(";")) {
      throw new Error(`Project ${record.id || "unknown"} must have exactly one domain category.`);
    }

    const english = locale === "en" ? englishProjects[record.slug] : undefined;
    return {
      id: record.id,
      slug: record.slug,
      title: english?.title ?? record.title,
      summary: english?.summary ?? record.summary,
      sortOrder: Number(record.sort_order),
      year: record.published_at.slice(0, 4),
      primaryLinkUrl: record.primary_link_url,
      primaryLinkType: record.primary_link_type,
      domainKey,
      detailEnabled: record.detail_enabled === "Y"
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}
