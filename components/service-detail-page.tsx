import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "@phosphor-icons/react/dist/ssr";
import type { ServiceDetail } from "@/lib/service-details";

export function ServiceDetailPage({ service, locale = "ko" }: { service: ServiceDetail; locale?: "ko" | "en" }) {
  const english = locale === "en";
  const contactPath = english ? "/en/contact" : "/contact";
  return (
    <main className="service-native">
      <section className="service-native__hero">
        <div>
          <p>{service.eyebrow}</p>
          <h1>{service.headline}</h1>
          <span>{service.description}</span>
          <Link className="button" href={contactPath}>{english ? "Discuss a project" : "프로젝트 상담하기"} <ArrowRight aria-hidden size={18} /></Link>
        </div>
        <Image src={service.image} alt={service.imageAlt} width={1600} height={1024} priority sizes="(max-width: 900px) 100vw, 52vw" />
      </section>

      <section className="service-native__process" aria-label={english ? `${service.title} process` : `${service.title} 진행 흐름`}>
        <p>{service.title}</p>
        <ol>{service.process.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></li>)}</ol>
      </section>

      <section className="service-native__sections">
        {service.sections.map((section, index) => (
          <article key={section.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div><h2>{section.title}</h2><p>{section.body}</p></div>
            <ul>{section.points.map((point) => <li key={point}><Check aria-hidden size={18} weight="bold" />{point}</li>)}</ul>
          </article>
        ))}
      </section>

      <section className="service-native__cta">
        <p>START WITH THE FLOW</p>
        <h2>{english ? <>Make the first change clear,<br />before building everything.</> : <>무엇부터 바꿔야 할지<br />함께 정리해보세요.</>}</h2>
        <Link className="button" href={contactPath}>{english ? "Request a free initial diagnosis" : "무료 사전 진단 신청하기"} <ArrowRight aria-hidden size={18} /></Link>
      </section>
    </main>
  );
}
