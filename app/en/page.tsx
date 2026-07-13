import Link from "next/link";
import { ConversionPathVisual, RevenueDiagnosticVisual } from "@/components/explainer-visuals";
import { PerformanceStories } from "@/components/performance-stories";
import { createPageMetadata, serializeJsonLd, webPageJsonLd } from "@/lib/seo";

const title = "GROWTHLINE | Reconnect the flow that drives revenue";
const description = "We find where acquisition, enquiries, revenue, and operations disconnect, then turn the bottleneck into a system your team can run.";

export const metadata = createPageMetadata({
  title,
  description,
  path: "/en",
  absoluteTitle: true,
  locale: "en",
  localized: true
});

const failureModes = [
  ["Starting from the wrong evidence", "When a project begins with internal assumptions alone, the real reason customers stop is easy to miss."],
  ["Confusing symptoms with causes", "A screen-level fix only moves the same problem to another stage of the journey."],
  ["Building a structure that cannot scale", "Without operating data, growth eventually forces the team to rebuild from the beginning."]
] as const;

const systemSteps = [
  ["Map the current operation", "Put enquiries, bookings, payments, and manual handoffs into one end-to-end flow."],
  ["Design the business flow", "Define the screens, rules, and automation boundary around how the team actually works."],
  ["Build the web service", "Connect the core experience to enquiries, payments, and the tools already in use."],
  ["Measure operating data", "Track acquisition, enquiries, conversion, and the exact points where people leave."],
  ["Improve and expand", "Add only the capabilities supported by real data and customer feedback."]
] as const;

const pageJsonLd = webPageJsonLd({ name: title, description, path: "/en", language: "en" });

export default function EnglishHomePage() {
  return (
    <main className="studio-home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
      <section className="studio-home__hero">
        <div className="studio-home__hero-copy">
          <p className="studio-kicker">ONLINE BUSINESS SYSTEMS</p>
          <h1>Find where revenue stalls.<br /><em>Turn it into a working system.</em></h1>
          <p className="studio-home__hero-lead">From acquisition to enquiries and operations, we repair the one disconnected stage keeping the rest of the business from moving.</p>
          <div className="studio-actions">
            <Link className="studio-button" href="/en/contact">Diagnose my bottleneck</Link>
            <Link className="studio-text-link" href="/en/work">See our work →</Link>
          </div>
        </div>
        <RevenueDiagnosticVisual locale="en" />
      </section>

      <section className="studio-proof" aria-label="Selected outcomes">
        <div className="studio-proof__intro">
          <h2>Not just a better-looking screen.<br />A number that actually moved.</h2>
          <p>We connect causes and outcomes so the same problem does not return in a different form.</p>
        </div>
        <dl className="studio-proof__numbers">
          <div><dt>Automated enquiry handling</dt><dd>2.4x<small>LG chatbot renewal</small></dd></div>
          <div><dt>Key-page drop-off</dt><dd>38% lower<small>Renault Korea website</small></dd></div>
          <div><dt>Survey response efficiency</dt><dd>3x<small>K2 survey platform</small></dd></div>
        </dl>
      </section>

      <section className="studio-cases">
        <div className="studio-section-heading">
          <h2>Different problems.<br />The same point to investigate.</h2>
          <p>See how we identify where customers stop and where operations repeat unnecessarily.</p>
        </div>
        <PerformanceStories locale="en" />
      </section>

      <section className="studio-problem">
        <ConversionPathVisual locale="en" />
        <div>
          <h2>When online conversion stalls,<br />assumptions usually arrive before evidence.</h2>
          <div className="studio-problem__list">
            {failureModes.map(([heading, body]) => <article key={heading}><h3>{heading}</h3><p>{body}</p></article>)}
          </div>
        </div>
      </section>

      <section className="studio-system">
        <div className="studio-system__heading">
          <p className="studio-kicker">ONE OPERATING FLOW</p>
          <h2>We do not stop at launch.<br />We connect operation and improvement.</h2>
          <Link className="studio-text-link" href="/en/service">Explore all services →</Link>
        </div>
        <div className="studio-system__steps">
          {systemSteps.map(([heading, body], index) => (
            <article key={heading}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{heading}</h3><p>{body}</p></div></article>
          ))}
        </div>
      </section>

      {/* Pricing varies by product. Keep these sections hidden until the pricing model is finalized.
      <section className="studio-commercial">
        <div className="studio-commercial__statement">
          <h2>Start with less upfront.<br />Grow the upside together.</h2>
          <p>Instead of front-loading a large build fee, we prefer a structure that lets the engagement expand with business results.</p>
        </div>
        <div className="studio-commercial__compare">
          <article><span>Typical development contract</span><strong>KRW 20M+</strong><p>A large initial build fee is followed by separate maintenance costs.</p></article>
          <article><span>GROWTHLINE</span><strong>From KRW 5M</strong><p>Start with the core, then connect performance-based operation and expansion.</p></article>
        </div>
      </section>

      <section className="studio-growth">
        <div>
          <h2>Start with what you need now.<br />Expand when the business is ready.</h2>
          <p>We define the smallest useful scope for today and the evidence that should trigger the next stage.</p>
        </div>
        <div className="studio-growth__paths">
          <article><strong>Validate an idea</strong><span>From KRW 5M</span><p>A working first version for core functionality, real customer response, and investor conversations</p></article>
          <article><strong>Scale and automate</strong><span>Scoped separately</span><p>Workflow automation, higher transaction volume, and integration with internal operations</p></article>
        </div>
      </section>
      */}

      <section className="studio-final-cta">
        <h2>Once the break is visible,<br />the first change becomes clear.</h2>
        <p>We identify the one stage in acquisition, enquiries, payment, or operations that should move first.</p>
        <Link className="studio-button" href="/en/contact">Diagnose my bottleneck</Link>
      </section>
    </main>
  );
}
