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

export function getProjects(): Project[] {
  const csv = fs.readFileSync(path.join(process.cwd(), "data/seed/projects.csv"), "utf8");
  const [headers, ...rows] = parseCsv(csv);

  return rows.map((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    const domainKey = record.domain_key.trim();
    if (!domainKey || domainKey.includes(";")) {
      throw new Error(`Project ${record.id || "unknown"} must have exactly one domain category.`);
    }

    return {
      id: record.id,
      slug: record.slug,
      title: record.title,
      summary: record.summary,
      sortOrder: Number(record.sort_order),
      year: record.published_at.slice(0, 4),
      primaryLinkUrl: record.primary_link_url,
      primaryLinkType: record.primary_link_type,
      domainKey,
      detailEnabled: record.detail_enabled === "Y"
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}
