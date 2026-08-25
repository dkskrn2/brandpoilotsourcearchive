import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublishOperationalStatus } from "../../types";
import { PublishMobileAgenda } from "./PublishMobileAgenda";
import type { PresentedCalendarEntry } from "./PublishDateDetail";

function entry(id: string, title: string, operationalStatus: PublishOperationalStatus): PresentedCalendarEntry {
  return {
    id,
    calendarDate: "2099-08-25T02:30:00.000Z",
    scheduledFor: "2099-08-25T02:30:00.000Z",
    effectiveScheduledFor: "2099-08-25T02:30:00.000Z",
    publishedAt: operationalStatus === "published" ? "2099-08-25T02:30:00.000Z" : null,
    title,
    status: operationalStatus === "cancelled" ? "cancelled" : "scheduled",
    mode: "manual",
    channels: ["instagram"],
    contentFormat: "card_news",
    operationalStatus,
    operationalReason: operationalStatus === "published" ? "published" : operationalStatus === "cancelled" ? "cancelled" : operationalStatus === "action_required" ? "publish_failed" : operationalStatus === "delayed_today" ? "reserved_time_passed" : "future_reservation",
  };
}

describe("PublishMobileAgenda", () => {
  it("shows every day and slot in the seven-day strip with visible shared status labels", () => {
    render(<PublishMobileAgenda
      anchorDate="2099-08-26"
      selectedDate="2099-08-26"
      selectedId={null}
      entries={[
        entry("published", "완료 콘텐츠", "published"),
        entry("upcoming", "예정 콘텐츠", "upcoming"),
        entry("delayed", "지연 콘텐츠", "delayed_today"),
        entry("failed", "실패 콘텐츠", "action_required"),
        entry("cancelled", "취소 콘텐츠", "cancelled"),
      ]}
      onSelectDate={vi.fn()}
      onSelectEntry={vi.fn()}
      onWeekChange={vi.fn()}
    />);

    const agenda = screen.getByRole("region", { name: "주간 게시 일정" });
    expect(within(agenda).getAllByRole("listitem")).toHaveLength(7);
    expect(within(agenda).getByRole("heading", { name: "8월 24일 월요일" })).toBeVisible();
    expect(within(agenda).getByRole("heading", { name: "8월 30일 일요일" })).toBeVisible();
    expect(within(agenda).getAllByText("일정 없음")).toHaveLength(6);

    for (const [name, label, className] of [
      ["완료 콘텐츠", "게시 완료", "is-completed"],
      ["예정 콘텐츠", "게시 예정", "is-upcoming"],
      ["지연 콘텐츠", "게시 지연", "is-delayed"],
      ["실패 콘텐츠", "처리 필요", "is-failed"],
      ["취소 콘텐츠", "취소", "is-cancelled"],
    ] as const) {
      const slot = within(agenda).getByRole("button", { name: `${name} ${label} 슬롯 상세 보기` });
      expect(slot).toHaveClass(className);
      expect(within(slot).getByText(label)).toBeVisible();
    }
  });

  it("moves the agenda anchor by exactly seven days in either direction", async () => {
    const onWeekChange = vi.fn();
    render(<PublishMobileAgenda
      anchorDate="2099-08-26"
      selectedDate="2099-08-26"
      selectedId={null}
      entries={[]}
      onSelectDate={vi.fn()}
      onSelectEntry={vi.fn()}
      onWeekChange={onWeekChange}
    />);

    await userEvent.click(screen.getByRole("button", { name: "이전 주" }));
    await userEvent.click(screen.getByRole("button", { name: "다음 주" }));

    expect(onWeekChange).toHaveBeenNthCalledWith(1, "2099-08-19");
    expect(onWeekChange).toHaveBeenNthCalledWith(2, "2099-09-02");
  });

  it("reuses the calendar date and slot selection callbacks", async () => {
    const onSelectDate = vi.fn();
    const onSelectEntry = vi.fn();
    render(<PublishMobileAgenda
      anchorDate="2099-08-26"
      selectedDate="2099-08-26"
      selectedId={null}
      entries={[entry("upcoming", "예정 콘텐츠", "upcoming")]}
      onSelectDate={onSelectDate}
      onSelectEntry={onSelectEntry}
      onWeekChange={vi.fn()}
    />);

    await userEvent.click(screen.getByRole("button", { name: "8월 24일 일정 보기" }));
    await userEvent.click(screen.getByRole("button", { name: "예정 콘텐츠 게시 예정 슬롯 상세 보기" }));

    expect(onSelectDate).toHaveBeenCalledWith("2099-08-24");
    expect(onSelectEntry).toHaveBeenCalledWith("2099-08-25", "upcoming");
  });
});
