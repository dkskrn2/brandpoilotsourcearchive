function activateTab(group, target, shouldFocus = false) {
  group.querySelectorAll(".tab").forEach((item) => {
    const selected = item.dataset.tabTarget === target;
    item.setAttribute("aria-selected", String(selected));
    item.setAttribute("tabindex", selected ? "0" : "-1");
    if (selected && shouldFocus) item.focus();
  });

  group.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== target;
  });
}

function initializeTabs() {
  document.querySelectorAll("[data-tabs]").forEach((group, groupIndex) => {
    const tabList = group.querySelector(".tabs");
    if (tabList) tabList.setAttribute("role", "tablist");

    group.querySelectorAll(".tabs .tab[data-tab-target]").forEach((tab) => {
      const target = tab.dataset.tabTarget;
      const panel = group.querySelector(`[data-tab-panel="${target}"]`);
      if (!panel) return;

      const tabId = tab.id || `tab-${groupIndex}-${target}`;
      const panelId = panel.id || `panel-${groupIndex}-${target}`;
      tab.id = tabId;
      panel.id = panelId;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panelId);
      tab.setAttribute("tabindex", tab.getAttribute("aria-selected") === "true" ? "0" : "-1");
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
    });
  });
}

function associateFormLabels() {
  document.querySelectorAll(".field label").forEach((label, index) => {
    const control = label.parentElement?.querySelector("input, textarea, select");
    if (!control) return;

    const id = control.id || `field-${index}`;
    control.id = id;
    label.htmlFor = id;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initializeTabs();
  associateFormLabels();
});

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-tab-target]");
  if (trigger) {
    const group = trigger.closest("[data-tabs]");
    if (group) {
      event.preventDefault();
      activateTab(group, trigger.dataset.tabTarget);
      return;
    }
  }

  const detailLink = event.target.closest('a[href^="#"]');
  if (!detailLink) return;

  const target = document.querySelector(detailLink.hash);
  if (target?.tagName === "DETAILS") {
    target.open = true;
  }
});

document.addEventListener("keydown", (event) => {
  const tab = event.target.closest('.tabs [role="tab"]');
  if (!tab) return;

  const tabs = [...tab.closest(".tabs").querySelectorAll('[role="tab"]')];
  const currentIndex = tabs.indexOf(tab);
  const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!direction) return;

  event.preventDefault();
  const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
  activateTab(next.closest("[data-tabs]"), next.dataset.tabTarget, true);
});
