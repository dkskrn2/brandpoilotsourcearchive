import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TV Voice UX Research",
  description: "A UX research case exploring customer journeys, utterance patterns, and feedback policies for voice interaction in the TV environment.",
  robots: { index: false },
  alternates: { canonical: "/en/detail" }
};

const researchFrames = [
  { number: "01", title: "The moment a person speaks", body: "Understand the context in which someone chooses voice and what they expect before the first utterance begins." },
  { number: "02", title: "While the system is listening", body: "Determine how visual and audio feedback should show that listening has started, what was recognized, and whether the person needs to wait." },
  { number: "03", title: "When the result is wrong", body: "Design a recovery path that helps people retry naturally after a recognition failure or an unexpected result." }
] as const;

export default function EnglishDetailPage() {
  return (
    <main className="case-study">
      <section className="case-study__hero">
        <div className="case-study__hero-copy">
          <p className="case-study__eyebrow">CASE STUDY · UX RESEARCH</p>
          <h1>TV Voice<br /><span>UX Research</span></h1>
          <p>A case study on customer journeys and needs around voice interaction in the TV environment, including utterance and feedback policy design.</p>
          <Link className="case-study__back" href="/en/work">← Back to work</Link>
        </div>
        <figure className="case-study__hero-image"><Image src="/images/generated/tv-voice-ux.webp" alt="A person using voice to interact with a television and receiving feedback on screen" width={1600} height={1024} priority sizes="(max-width: 900px) 100vw, 52vw" /></figure>
      </section>

      <section className="case-study__summary">
        <div><p className="case-study__eyebrow">RESEARCH QUESTION</p><h2>How can a person speak with confidence without watching the screen?</h2></div>
        <p>Voice UX requires more than accurate command recognition. People continually need to know whether the system is listening, whether it understood the request, and what they should do next. This case connects those moments of reassurance into one journey.</p>
      </section>

      <section className="case-study__frames" aria-label="Research perspectives">
        {researchFrames.map((frame) => <article key={frame.number}><span>{frame.number}</span><h2>{frame.title}</h2><p>{frame.body}</p></article>)}
      </section>

      <section className="case-study__flow">
        <div className="case-study__flow-copy"><p className="case-study__eyebrow">VOICE FEEDBACK LOOP</p><h2>Continuous feedback from the first utterance to recovery</h2><p>This summary covers the research perspectives that can be shared publicly. In the project, usage context, utterance patterns, and error conditions were compared to prioritize product policies.</p></div>
        <ol className="case-study__flow-steps"><li><span>01</span><strong>Invoke</strong><small>The trigger for voice use</small></li><li><span>02</span><strong>Speak</strong><small>How the request is expressed</small></li><li><span>03</span><strong>Respond</strong><small>Listening, processing, and result feedback</small></li><li><span>04</span><strong>Recover</strong><small>The route to a successful retry</small></li></ol>
      </section>

      <section className="case-study__cta"><p className="case-study__eyebrow">YOUR NEXT QUESTION</p><h2>Find the exact moment your customer hesitates.</h2><Link className="button" href="/en/contact">Discuss UX research</Link></section>
    </main>
  );
}
