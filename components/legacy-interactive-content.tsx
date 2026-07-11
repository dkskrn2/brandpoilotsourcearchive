"use client";

import { useEffect, useRef } from "react";

type LegacyInteractiveContentProps = {
  html: string;
  pageType?: string;
};

export function LegacyInteractiveContent({ html, pageType = "document" }: LegacyInteractiveContentProps) {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLButtonElement>(".rp-item"));
    if (!items.length) return;

    const company = root.querySelector<HTMLElement>("#rpCompany");
    const problem = root.querySelector<HTMLElement>("#rpProblem");
    const resultNum = root.querySelector<HTMLElement>("#rpResultNum");
    const resultLabel = root.querySelector<HTMLElement>("#rpResultLabel");
    const asis = root.querySelector<HTMLElement>("#rpAsis");
    const tobe = root.querySelector<HTMLElement>("#rpTobe");
    const review = root.querySelector<HTMLElement>("#rpReview");
    const reviewMeta = root.querySelector<HTMLElement>("#rpReviewMeta");

    const render = (button: HTMLButtonElement) => {
      if (company) company.textContent = button.dataset.company ?? "";
      if (problem) problem.textContent = button.dataset.problem ?? "";
      if (resultNum) {
        resultNum.textContent = button.dataset.resultNum ?? "";
        resultNum.classList.toggle("is-down", button.dataset.resultDir === "down");
        resultNum.classList.toggle("is-up", button.dataset.resultDir !== "down");
      }
      if (resultLabel) resultLabel.textContent = button.dataset.resultLabel ?? "";

      const fillList = (element: HTMLElement | null, value: string | undefined) => {
        if (!element) return;
        try {
          const entries = JSON.parse(value ?? "[]") as string[];
          element.replaceChildren(...entries.map((entry) => {
            const li = document.createElement("li");
            li.textContent = entry;
            return li;
          }));
        } catch {
          element.replaceChildren();
        }
      };

      fillList(asis, button.dataset.asis);
      fillList(tobe, button.dataset.tobe);
      if (review) review.textContent = button.dataset.review ?? "";
      if (reviewMeta) reviewMeta.textContent = button.dataset.reviewMeta ?? "";
    };

    const onClick = (event: Event) => {
      const selected = event.currentTarget as HTMLButtonElement;
      items.forEach((item) => {
        const active = item === selected;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
      });
      render(selected);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const current = event.currentTarget as HTMLButtonElement;
      const index = items.indexOf(current);
      if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
        (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
      items[nextIndex].focus();
      items[nextIndex].click();
    };

    items.forEach((item, index) => {
      const active = item.classList.contains("is-active") || index === 0;
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      item.addEventListener("click", onClick);
      item.addEventListener("keydown", onKeyDown);
    });

    render(items.find((item) => item.classList.contains("is-active")) ?? items[0]);
    return () => items.forEach((item) => {
      item.removeEventListener("click", onClick);
      item.removeEventListener("keydown", onKeyDown);
    });
  }, [html]);

  return (
    <article
      ref={rootRef}
      className={`legacy-content legacy-content--${pageType}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
