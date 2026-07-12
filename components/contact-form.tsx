"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ChartLineUp, Lightbulb, PhoneCall } from "@phosphor-icons/react";

const plans = new Set(["seed", "series-a", "series-b"]);

export function ContactForm({ initialPlan = "" }: { initialPlan?: string }) {
  const [status, setStatus] = useState<{ message: string; error: boolean }>({ message: "", error: false });
  const [submitting, setSubmitting] = useState(false);
  const selectedPlan = plans.has(initialPlan) ? initialPlan : "";

  const sanitize = (value: string, type: "text" | "phone" | "url" = "text") => {
    let next = value.replace(/[?&=]/g, "");
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
      site: String(formData.get("site_url") ?? "").trim(),
      plan: String(formData.get("plan") ?? "").trim(),
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
      setStatus({ message: "제출이 완료되었습니다. 빠르게 확인 후 연락드리겠습니다.", error: false });
      form.reset();
    } catch {
      setStatus({ message: "제출에 실패했습니다. 잠시 후 다시 시도해 주세요.", error: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="contact-page">
      <section className="contact-intro">
        <div>
          <p className="contact-availability">15분 사전 진단</p>
          <h1>사이트는 있는데,<br /><strong>매출은 어디서</strong><br />막힐까요?</h1>
          <p>현재 사이트와 운영 방식을 먼저 살펴봅니다. 상담에서는 가장 먼저 바꿔야 할 한 구간과 실행 순서를 함께 정리합니다.</p>
        </div>
        <div className="contact-points">
          <article><ChartLineUp aria-hidden size={28} /><div><strong>데이터 기반 사전 분석</strong><span>신청 즉시 현재 사이트의 이탈 지점을 추적하여 진단합니다.</span></div></article>
          <article><Lightbulb aria-hidden size={28} /><div><strong>맞춤형 매출 설계 제안</strong><span>사업 모델에 맞는 상담 및 자동화 로직을 제안합니다.</span></div></article>
          <article><PhoneCall aria-hidden size={28} /><div><strong>24시간 이내 전문 상담</strong><span>남겨주신 고민에 대해 가장 현실적인 대안을 제시합니다.</span></div></article>
        </div>
      </section>

      <section className="contact-form-section">
        <form onSubmit={handleSubmit}>
          <label className="form-honeypot" aria-hidden="true">웹사이트<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <p className="contact-form__lead">작성해주신 내용을 바탕으로 상담 전에 현재 흐름을 먼저 확인합니다.</p>
          <div className="form-field">
            <label htmlFor="contact_name_company">성함 / 업체명</label>
            <input id="contact_name_company" name="name_company" type="text" placeholder="홍길동 / 그로스라인" autoComplete="organization" required onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value); }} />
          </div>
          <div className="form-field">
            <label htmlFor="contact_phone">연락처</label>
            <input id="contact_phone" name="phone" type="tel" placeholder="01000000000" autoComplete="tel" inputMode="numeric" required onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value, "phone"); }} />
          </div>
          <div className="form-field">
            <label htmlFor="contact_site_url">운영 중인 사이트 URL (선택)</label>
            <input id="contact_site_url" name="site_url" type="url" placeholder="https://example.com" autoComplete="url" onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value, "url"); }} />
            <small>사전 분석에 활용됩니다.</small>
          </div>
          <div className="form-field">
            <label htmlFor="contact_plan">플랜</label>
            <select id="contact_plan" name="plan" defaultValue={selectedPlan} required>
              <option value="" disabled>선택해 주세요</option>
              <option value="seed">Seed</option>
              <option value="series-a">Series A</option>
              <option value="series-b">Series B</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="contact_message">현재 가장 고민되는 지점 (선택)</label>
            <textarea id="contact_message" name="message" rows={5} placeholder="예: 홈페이지는 있는데 문의가 0건입니다 / 신규 사업 매출 구조 설계가 필요합니다" onInput={(event) => { event.currentTarget.value = sanitize(event.currentTarget.value); }} />
          </div>
          <label className="form-consent" htmlFor="contact_agree">
            <input id="contact_agree" name="agree_privacy" type="checkbox" required />
            <span>개인정보 수집 및 이용에 동의합니다. <Link href="/brand-pilot-privacy">자세히 보기</Link></span>
          </label>
          <button className="button contact-submit" type="submit" disabled={submitting}>{submitting ? "제출 중" : "무료 사전 분석 및 상담 신청하기"}</button>
          <p className={status.error ? "form-status is-error" : "form-status"} aria-live="polite">{status.message}</p>
          <p className="form-disclaimer">남겨주신 정보는 상담 목적으로만 사용되며, 불필요한 광고 전화를 드리지 않습니다.</p>
        </form>
      </section>
    </main>
  );
}
