import Link from "next/link";
import { ContentOperationVisual, DecisionRulesVisual, ServiceArchitectureVisual } from "@/components/explainer-visuals";
import { absoluteUrl, breadcrumbJsonLd, createPageMetadata, serializeJsonLd, webPageJsonLd } from "@/lib/seo";

const description = "Find where customers stop, then connect the research, design, build, and operating work needed to move them forward.";

export const metadata = createPageMetadata({
  title: "Services",
  description,
  path: "/en/service",
  locale: "en",
  localized: true
});

const understandServices = [
  { title: "UX Research", headline: "Find why customers stop just before they act.", body: "Replace internal instinct with direct evidence from customer language and behavior.", scope: "In-depth interviews / Journey mapping / Competitor review", href: "/en/service/service-research" },
  { title: "Data Analytics", headline: "Track only the numbers that change a decision.", body: "Move beyond lists of page views and click rates by defining the metric and comparison each decision needs.", scope: "Metric design / Experiment analysis / ROAS comparison", href: "/en/service/service-analytics" }
] as const;

const structureServices = [
  { title: "Conversion Design", headline: "Connect a clear interface to a clear next action.", body: "Design the priority, evidence, and path customers need to decide and click.", scope: "Information architecture / CTA path / Page flow", href: "/en/service/service-design" },
  { title: "Business Logic", headline: "Lock the workflow and decision rules before development.", body: "Document target workflows, exceptions, permissions, and states before they become expensive code.", scope: "PRD / Operating rules / Admin tools", href: "/en/service/service-consulting" }
] as const;

const indexedServices = [
  ["UX Research", "/en/service/service-research"],
  ["Data Analytics", "/en/service/service-analytics"],
  ["Conversion Design", "/en/service/service-design"],
  ["Business Logic", "/en/service/service-consulting"],
  ["Persuasive Copywriting", "/en/service/service-writing"],
  ["Startup Build", "/en/service/service-startup"],
  ["Brand Pilot", "/en/product"]
] as const;

export default function EnglishServicePage() {
  const breadcrumb = breadcrumbJsonLd([{ name: "Home", path: "/en" }, { name: "Services", path: "/en/service" }]);
  const pageJsonLd = {
    ...webPageJsonLd({ name: "GROWTHLINE Services", description, path: "/en/service", type: "CollectionPage", hasBreadcrumb: true, language: "en" }),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: indexedServices.map(([name, path], index) => ({ "@type": "ListItem", position: index + 1, name, url: absoluteUrl(path) }))
    }
  };

  return (
    <main className="studio-service">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
      <section className="studio-service__hero">
        <div>
          <p className="studio-kicker">ONLY THE WORK THE PROBLEM NEEDS</p>
          <h1>Before deciding what to build,<br /><em>find why it is not selling.</em></h1>
          <p>We locate the point where customers stop, then connect the right specialties into one operating flow.</p>
          <Link className="studio-button" href="/en/contact">Find the service I need</Link>
        </div>
        <ServiceArchitectureVisual locale="en" />
      </section>

      <section className="studio-service__understand">
        <div className="studio-service__section-title">
          <span>UNDERSTAND THE CUSTOMER</span>
          <h2>First, verify why they stopped.</h2>
          <p>Customer language, observed behavior, and quantitative data must be read together to define the right problem.</p>
        </div>
        <div className="studio-service__duo">
          {understandServices.map((service) => (
            <article key={service.title}><p>{service.title}</p><h3>{service.headline}</h3><span>{service.body}</span><small>{service.scope}</small><Link href={service.href}>View service →</Link></article>
          ))}
        </div>
      </section>

      <section className="studio-service__structure">
        <DecisionRulesVisual locale="en" />
        <div className="studio-service__structure-copy">
          <h2>Then, make the decision and operating rules explicit.</h2>
          {structureServices.map((service) => (
            <article key={service.title}><p>{service.title}</p><h3>{service.headline}</h3><span>{service.body}</span><small>{service.scope}</small><Link href={service.href}>View service →</Link></article>
          ))}
        </div>
      </section>

      <section className="studio-service__ship">
        <div className="studio-service__ship-heading"><h2>Ship something real.<br />Make it operable after launch.</h2><p>Copy, product delivery, and content operations all follow the same decision rules.</p></div>
        <div className="studio-service__ship-grid">
          <article className="studio-service__writing"><p>Copywriting</p><h3>Resolve customer hesitation in the words they read.</h3><span>Answer questions about price, trust, risk, and alternatives before asking for the next action.</span><small>Core message / FAQ / CTA copy</small><Link href="/en/service/service-writing">View copywriting →</Link></article>
          <article className="studio-service__build"><p>Build</p><h3>Put a working product in front of real customers.</h3><span>Connect the MVP to operating data and a clear basis for the next improvement.</span><small>MVP / Core modules / Improvement cycle</small><Link href="/en/service/service-startup">View build service →</Link></article>
          <article className="studio-service__brandpilot">
            <div><p>Brand Pilot</p><h3>Publish consistently without losing the brand voice.</h3><span>Collect sources, prepare copy and images, review with a person, and connect approved work to publishing.</span><small>Sources / Drafts / Images / Publishing</small><Link href="/en/product">Explore Brand Pilot →</Link></div>
            <ContentOperationVisual locale="en" />
          </article>
        </div>
      </section>

      <section className="studio-service__closing">
        <h2>Not sure which service fits?<br />Start by defining the problem.</h2>
        <p>We review the current site and operating flow, then identify the first stage worth changing.</p>
        <Link className="studio-button" href="/en/contact">Request a 15-minute diagnosis</Link>
      </section>
    </main>
  );
}
