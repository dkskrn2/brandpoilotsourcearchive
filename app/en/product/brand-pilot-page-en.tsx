import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpenText, CheckCircle, InstagramLogo, LinkSimple, NotePencil, ShieldCheck, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { serializeJsonLd } from "@/lib/seo";

const workflow = [
  { icon: LinkSimple, title: "Register the evidence", body: "Bring your website, reference URLs, documents, and notes into a shared source library." },
  { icon: NotePencil, title: "Prepare an on-brand draft", body: "Apply the customer, service, voice, and prohibited expressions before the first sentence is written." },
  { icon: CheckCircle, title: "Review with a person", body: "A team member checks the copy and carousel, then records an explicit approval before publishing." },
  { icon: InstagramLogo, title: "Connect approved work to publishing", body: "Only approved content enters the currently supported Instagram publishing flow." }
] as const;

const changes = [
  { problem: "Ideas and evidence are scattered across chat and documents.", solution: "Bring source material into one evidence library.", body: "Every draft keeps a record of what informed it, so the next owner starts from the same facts." },
  { problem: "The brand voice changes whenever the writer changes.", solution: "Apply the brand context before drafting.", body: "Brand positioning, customers, services, tone, and prohibited expressions become shared drafting rules." },
  { problem: "Review and publishing break across separate tools.", solution: "Connect approval status to the publishing result.", body: "Keep human judgment in the flow while reducing repetitive handoffs, copying, and status checks." }
] as const;

const comparison = [
  ["Sources", "Bookmarks and files stored separately by each owner", "URLs, documents, and notes managed as reusable content sources"],
  ["Drafting", "Every post begins from an empty page", "Brand rules and evidence shape the first draft"],
  ["Review", "Feedback and file versions spread across chat", "Review status and approval recorded in one workflow"],
  ["Publishing", "Copy and images moved manually between tools", "Only approved results enter the Instagram publishing flow"]
] as const;

const faqs = [
  { question: "What can be registered as a content source?", answer: "You can register your website, reference URLs used to understand a market or customer, internal documents and notes, and publishing topics. Sources are separated by their role as factual evidence or contextual inspiration." },
  { question: "Does Brand Pilot copy sentences from reference URLs?", answer: "No. References are inputs for market context and perspective. Their wording is not reproduced. Brand Pilot prepares a new draft using the evidence and the rules registered for your brand." },
  { question: "Can a team member review content before it is published?", answer: "Yes. The approval workflow lets a person review the copy and carousel before publishing. Automatic approval can be limited to content types with a clearly agreed operating policy." },
  { question: "How many carousel images can it prepare?", answer: "The system chooses the number needed for the content flow. The current Instagram carousel format supports up to five images." },
  { question: "Which publishing channels are supported?", answer: "The publishing automation described here currently focuses on Instagram. Other channels require separate formats and operating policies and are scoped independently." }
] as const;

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  inLanguage: "en",
  mainEntity: faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } }))
};

export function EnglishBrandPilotPage() {
  return (
    <main className="brand-pilot-product">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }} />

      <section className="bp-hero">
        <div className="bp-shell bp-hero__grid">
          <div className="bp-hero__copy">
            <p className="bp-kicker">BRAND PILOT</p>
            <h1>Publish consistently,<br />from the same brand rules.</h1>
            <p className="bp-lead">Manage sources, drafts, carousel images, human review, and Instagram publishing in one connected workflow.</p>
            <div className="bp-actions">
              <Link className="button" href="/en/contact">Discuss adoption</Link>
              <a className="bp-text-link" href="#workflow">See the product flow <ArrowRight aria-hidden size={18} /></a>
            </div>
          </div>
          <figure className="bp-hero__visual">
            <Image src="/images/product/brand-pilot-workflow-v1.webp" alt="Brand Pilot interface connecting source collection, drafting, human approval, and Instagram publishing" width={1536} height={1024} priority sizes="(max-width: 980px) calc(100vw - 40px), 52vw" />
          </figure>
        </div>
      </section>

      <section className="bp-scope" aria-label="Brand Pilot product scope">
        <div className="bp-shell bp-scope__inner">
          <strong>One connected workspace</strong>
          <ul><li>Website</li><li>Reference URLs</li><li>Documents and notes</li><li>Content drafts</li><li>1-5 carousel images</li><li>Instagram publishing</li></ul>
        </div>
      </section>

      <section className="bp-section bp-changes">
        <div className="bp-shell bp-changes__grid">
          <header className="bp-section__head"><h2>Before producing more,<br />keep the standard connected.</h2><p>Brand Pilot is not a one-off writing shortcut. It is an operating product that helps the next post follow the same evidence and brand rules.</p></header>
          <div className="bp-changes__list">{changes.map((item) => <article key={item.problem}><span>{item.problem}</span><h3>{item.solution}</h3><p>{item.body}</p></article>)}</div>
        </div>
      </section>

      <section className="bp-section bp-workflow-section" id="workflow">
        <div className="bp-shell">
          <header className="bp-section__head"><p className="bp-kicker">PRODUCT FLOW</p><h2>Four decisions connect evidence to publishing.</h2><p>The workflow records what informed the draft and who approved it, rather than optimizing for draft speed alone.</p></header>
          <ol className="bp-workflow">{workflow.map(({ icon: Icon, title, body }) => <li key={title}><Icon aria-hidden size={28} weight="duotone" /><h3>{title}</h3><p>{body}</p></li>)}</ol>
        </div>
      </section>

      <section className="bp-section bp-evidence">
        <div className="bp-shell bp-evidence__grid">
          <figure className="bp-evidence__visual"><Image src="/images/generated/content-operations-loop.webp" alt="Content operations loop connecting evidence, drafting, review, publishing, and improvement" width={1536} height={1024} sizes="(max-width: 980px) calc(100vw - 40px), 54vw" /></figure>
          <div className="bp-evidence__copy">
            <h2>If it sounds like your brand,<br />the evidence should still be visible.</h2>
            <p>Not every source has the same authority. Brand Pilot separates their roles so unsupported claims do not quietly enter a draft.</p>
            <dl><div><dt>First-party facts</dt><dd>Product, service, and pricing details that must remain accurate</dd></div><div><dt>Reference material</dt><dd>Context used to understand the market and customer perspective</dd></div><div><dt>Brand rules</dt><dd>Guidance for who the brand addresses and how it should sound</dd></div></dl>
          </div>
        </div>
      </section>

      <section className="bp-section bp-principles">
        <div className="bp-shell">
          <header className="bp-section__head"><h2>Three operating principles come before automation.</h2></header>
          <div className="bp-principles__list">
            <article><BookOpenText aria-hidden size={30} weight="duotone" /><div><h3>Protect facts, create original expression</h3><p>Reference wording is not copied. New copy is written from verified evidence and the brand&apos;s own point of view.</p></div></article>
            <article><UsersThree aria-hidden size={30} weight="duotone" /><div><h3>Human approval is the default</h3><p>Automation does not make the final judgment. Content that requires review waits for an accountable team member.</p></div></article>
            <article><ShieldCheck aria-hidden size={30} weight="duotone" /><div><h3>State the supported scope clearly</h3><p>Publishing automation currently focuses on Instagram. Each additional channel needs its own format and operating policy.</p></div></article>
          </div>
        </div>
      </section>

      <section className="bp-section bp-comparison">
        <div className="bp-shell">
          <header className="bp-section__head"><h2>Connect the broken operation instead of adding another isolated tool.</h2></header>
          <div className="bp-comparison__table-wrap"><table><thead><tr><th scope="col">Operation</th><th scope="col">Typical workflow</th><th scope="col">Brand Pilot</th></tr></thead><tbody>{comparison.map(([label, before, after]) => <tr key={label}><th scope="row">{label}</th><td>{before}</td><td>{after}</td></tr>)}</tbody></table></div>
        </div>
      </section>

      <section className="bp-section bp-teams">
        <div className="bp-shell">
          <header className="bp-section__head"><h2>Teams that can see the value first</h2></header>
          <div className="bp-teams__grid">
            <article><span>Teams that must publish regularly</span><h3>Content demand is constant, but there is no dedicated editorial team.</h3><p>The more often the team repeats sourcing, drafting, and approval, the more useful a shared operating standard becomes.</p></article>
            <article><span>Teams that need a consistent voice</span><h3>The brand must sound the same even when the writer changes.</h3><p>Internal owners and external partners can begin from the same evidence and brand rules.</p></article>
          </div>
        </div>
      </section>

      <section className="bp-section bp-faq">
        <div className="bp-shell bp-faq__grid">
          <header className="bp-section__head"><h2>Frequently asked questions</h2><p>Source handling, review, and the current publishing scope before adoption.</p></header>
          <div className="bp-faq__list">{faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div>
        </div>
      </section>

      <section className="bp-closing"><div className="bp-shell"><h2>Run the next post<br />from the same standard.</h2><p>We review your current sources and approval process, then define a practical starting scope for Brand Pilot.</p><Link className="button" href="/en/contact">Discuss adoption</Link></div></section>
    </main>
  );
}
