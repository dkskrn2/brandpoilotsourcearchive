import type { Route } from "next";
import Link from "next/link";

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
  ordered?: boolean;
  table?: { headers: string[]; rows: string[][] };
};

type LegalDocumentProps = {
  title: string;
  lead: string;
  effectiveDate: string;
  sections: LegalSection[];
  links: Array<{ href: Route; label: string }>;
};

export function LegalDocument({ title, lead, effectiveDate, sections, links }: LegalDocumentProps) {
  return (
    <main className="legal-document">
      <header>
        <p>BRAND PILOT</p>
        <h1>{title}</h1>
        <span>{lead}</span>
        <small>시행일: {effectiveDate} · 운영자: GROWTHLINE</small>
      </header>
      <div className="legal-document__body">
        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && (section.ordered ? (
              <ol>{section.items.map((item) => <li key={item}>{item}</li>)}</ol>
            ) : (
              <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
            ))}
            {section.table && (
              <div className="legal-document__table" role="region" tabIndex={0} aria-label={`${section.title} 표`}>
                <table>
                  <thead><tr>{section.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                  <tbody>{section.table.rows.map((row) => <tr key={row.join("|")}>{row.map((cell, index) => <td key={`${index}-${cell}`}>{cell}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        ))}
        <nav aria-label="관련 법적 문서">{links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>
      </div>
    </main>
  );
}
