"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ChartLineUp, Lightbulb, PhoneCall } from "@phosphor-icons/react";

export function ContactForm({ locale = "ko" }: { locale?: "ko" | "en" }) {
  const english = locale === "en";
  const [status, setStatus] = useState<{ message: string; error: boolean }>({ message: "", error: false });
  const [submitting, setSubmitting] = useState(false);

  const sanitize = (value: string, type: "text" | "phone" | "url" | "email" = "text") => {
    let next = type === "email" ? value.replace(/\s/g, "") : value.replace(/[?&=]/g, "");
    if (type === "phone") next = next.replace(/\D/g, "");
    if (type === "url") next = next.replace(/[ㄱ-ㅎㅏ-ㅣ가-힣]/g, "");
    return next;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSubmitting(true);
    setStatus({ message: "", error: false });

    const payload = {
      name: String(formData.get("name_company") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      site: String(formData.get("site_url") ?? "").trim(),
      message: String(formData.get("message") ?? "").trim(),
      agree: formData.get("agree_privacy") ? "Y" : "N",
      websiteTrap: String(formData.get("website") ?? "")
    };

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Submit failed");
      if (typeof window.gtag === "function") {
        window.gtag("event", "generate_lead", { form_name: "contact_consultation", locale });
      }
      setStatus({ message: english ? "Your enquiry has been submitted. We will review it and get back to you shortly." : "제출이 완료되었습니다. 빠르게 확인 후 연락드리겠습니다.", error: false });
      form.reset();
    } catch {
      setStatus({ message: english ? "We could not submit the form. Please try again in a moment." : "제출에 실패했습니다. 잠시 후 다시 시도해 주세요.", error: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="contact-page">
      <section className="contact-intro">
        <div>
          <p className="contact-availability">15-MINUTE INITIAL DIAGNOSIS</p>
          <h1>{english ? <>You have a website.<br /><strong>Where is revenue</strong><br />getting stuck?</> : <>사이트는 있는데,<br /><strong>매출은 어디서</strong><br />막힐까요?</>}</h1>
          <p>{english ? "We review your current site and operating model before the conversation. Together, we identify the first stage to change and a practical order of execution." : "현재 사이트와 운영 방식을 먼저 살펴봅니다. 상담에서는 가장 먼저 바꿔야 할 한 구간과 실행 순서를 함께 정리합니다."}</p>
        </div>
        <div className="contact-points">
          <article><ChartLineUp aria-hidden size={28} /><div><strong>{english ? "Evidence-led initial review" : "데이터 기반 사전 분석"}</strong><span>{english ? "We inspect the site and identify likely points of customer drop-off before the call." : "신청 즉시 현재 사이트의 이탈 지점을 추적하여 진단합니다."}</span></div></article>
          <article><Lightbulb aria-hidden size={28} /><div><strong>{english ? "A recommendation shaped to the business" : "맞춤형 매출 설계 제안"}</strong><span>{english ? "The suggested conversion and automation logic reflects how your business actually operates." : "사업 모델에 맞는 상담 및 자동화 로직을 제안합니다."}</span></div></article>
          <article><PhoneCall aria-hidden size={28} /><div><strong>{english ? "A response within 24 hours" : "24시간 이내 전문 상담"}</strong><span>{english ? "We respond with the most realistic next step for the situation you describe." : "남겨주신 고민에 대해 가장 현실적인 대안을 제시합니다."}</span></div></article>
        </div>
      </section>

      <section className="contact-form-section">
        <form onSubmit={handleSubmit}>
          <label className="form-honeypot" aria-hidden="true">{english ? "Website" : "웹사이트"}<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <p className="contact-form__lead">{english ? "We use the information below to review the current flow before the conversation." : "작성해주신 내용을 바탕으로 상담 전에 현재 흐름을 먼저 확인합니다."}</p>
          <div className="form-field">
            <label htmlFor="contact_name_company">{english ? "Name / Company" : "성함 / 업체명"}</label>
            <input id="contact_name_company" name="name_company" type="text" placeholder={english ? "Alex Kim / Company" : "홍길동 / 그로스라인"} autoComplete="organization" required onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value); }} />
          </div>
          <div className="form-field">
            <label htmlFor="contact_phone">{english ? "Phone number" : "연락처"}</label>
            <input id="contact_phone" name="phone" type="tel" placeholder={english ? "821000000000" : "01000000000"} autoComplete="tel" inputMode="numeric" required onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value, "phone"); }} />
          </div>
          <div className="form-field">
            <label htmlFor="contact_email">{english ? "Email" : "이메일"}</label>
            <input id="contact_email" name="email" type="email" placeholder="name@company.com" autoComplete="email" required onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value, "email"); }} />
          </div>
          <div className="form-field">
            <label htmlFor="contact_site_url">{english ? "Current website URL (optional)" : "운영 중인 사이트 URL (선택)"}</label>
            <input id="contact_site_url" name="site_url" type="url" placeholder="https://example.com" autoComplete="url" onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value, "url"); }} />
            <small>{english ? "Used only for the initial review." : "사전 분석에 활용됩니다."}</small>
          </div>
          <div className="form-field">
            <label htmlFor="contact_message">{english ? "What is the main challenge right now? (optional)" : "현재 가장 고민되는 지점 (선택)"}</label>
            <textarea id="contact_message" name="message" rows={5} placeholder={english ? "For example: the website gets traffic but no enquiries / we need to design the revenue flow for a new business" : "예: 홈페이지는 있는데 문의가 0건입니다 / 신규 사업 매출 구조 설계가 필요합니다"} onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value); }} />
          </div>
          <label className="form-consent" htmlFor="contact_agree">
            <input id="contact_agree" name="agree_privacy" type="checkbox" required />
            <span>{english ? <>I consent to the collection and use of my information. <Link href="/brand-pilot-privacy" lang="ko">View policy (Korean)</Link></> : <>개인정보 수집 및 이용에 동의합니다. <Link href="/brand-pilot-privacy">자세히 보기</Link></>}</span>
          </label>
          <button className="button contact-submit" type="submit" disabled={submitting}>{submitting ? (english ? "Submitting" : "제출 중") : (english ? "Request a free initial review" : "무료 사전 분석 및 상담 신청하기")}</button>
          <p className={status.error ? "form-status is-error" : "form-status"} aria-live="polite">{status.message}</p>
          <p className="form-disclaimer">{english ? "Your information is used only to respond to this enquiry. We do not make unsolicited sales calls." : "남겨주신 정보는 상담 목적으로만 사용되며, 불필요한 광고 전화를 드리지 않습니다."}</p>
        </form>
      </section>
    </main>
  );
}

declare global {
  interface Window {
    gtag?: (command: "event", eventName: string, parameters?: Record<string, string>) => void;
  }
}
