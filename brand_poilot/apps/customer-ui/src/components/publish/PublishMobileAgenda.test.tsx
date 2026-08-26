import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PublishOperationalStatus } from "../../types";
import { PublishMobileAgenda } from "./PublishMobileAgenda";
import type { PresentedCalendarEntry } from "./PublishDateDetail";

function entry(id: string, title: string, operationalStatus: PublishOperationalStatus, calendarDate = "2099-08-25T02:30:00.000Z"): PresentedCalendarEntry {
  return {
    id,
    calendarDate,
    scheduledFor: calendarDate,
    effectiveScheduledFor: calendarDate,
    publishedAt: operationalStatus === "published" ? calendarDate : null,
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
  it("shows seven date controls and only the selected date agenda with visible shared status labels", () => {
    render(<PublishMobileAgenda
      anchorDate="2099-08-26"
      selectedDate="2099-08-25"
      selectedId={null}
      entries={[
        entry("published", "완료 콘텐츠", "published"),
        entry("upcoming", "예정 콘텐츠", "upcoming"),
        entry("delayed", "지연 콘텐츠", "delayed_today"),
        entry("failed", "실패 콘텐츠", "action_required"),
        entry("cancelled", "취소 콘텐츠", "cancelled"),
        entry("other-day", "다른 날짜 콘텐츠", "upcoming", "2099-08-27T02:30:00.000Z"),
      ]}
      onSelectDate={vi.fn()}
      onSelectEntry={vi.fn()}
      onWeekChange={vi.fn()}
    />);

    const agenda = screen.getByRole("region", { name: "주간 게시 일정" });
    const dateControls = within(agenda).getByRole("group", { name: "주간 날짜 선택" });
    expect(within(dateControls).getAllByRole("button")).toHaveLength(7);
    expect(within(dateControls).getByRole("button", { name: "8월 24일 일정 보기" })).toBeVisible();
    expect(within(dateControls).getByRole("button", { name: "8월 30일 일정 보기" })).toBeVisible();
    expect(within(agenda).getByRole("heading", { name: "8월 25일 화요일 일정" })).toBeVisible();
    expect(within(agenda).queryByText("다른 날짜 콘텐츠")).not.toBeInTheDocument();

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

  it("shows an empty state for a selected date without slots", () => {
    render(<PublishMobileAgenda
      anchorDate="2099-08-26"
      selectedDate="2099-08-26"
      selectedId={null}
      entries={[entry("other-day", "다른 날짜 콘텐츠", "upcoming")]}
      onSelectDate={vi.fn()}
      onSelectEntry={vi.fn()}
      onWeekChange={vi.fn()}
    />);

    expect(screen.getByRole("heading", { name: "8월 26일 수요일 일정" })).toBeVisible();
    expect(screen.getByText("선택한 날짜에 게시 일정이 없습니다.")).toBeVisible();
    expect(screen.queryByText("다른 날짜 콘텐츠")).not.toBeInTheDocument();
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
      selectedDate="2099-08-25"
      selectedId={null}
      entries={[entry("upcoming", "예정 콘텐츠", "upcoming")]}
      onSelectDate={onSelectDate}
      onSelectEntry={onSelectEntry}
      onWeekChange={vi.fn()}
    />);

    await userEvent.click(screen.getByRole("button", { name: "예정 콘텐츠 게시 예정 슬롯 상세 보기" }));
    await userEvent.click(screen.getByRole("button", { name: "8월 24일 일정 보기" }));

    expect(onSelectDate).toHaveBeenCalledWith("2099-08-24");
    expect(onSelectEntry).toHaveBeenCalledWith("2099-08-25", "upcoming");
  });

  it("changes the selected-day agenda when a focused date control uses Enter or Space", async () => {
    function KeyboardHarness() {
      const [selectedDate, setSelectedDate] = useState("2099-08-25");
      return <PublishMobileAgenda
        anchorDate={selectedDate}
        selectedDate={selectedDate}
        selectedId={null}
        entries={[
          entry("tuesday", "화요일 콘텐츠", "upcoming"),
          entry("wednesday", "수요일 콘텐츠", "published", "2099-08-26T02:30:00.000Z"),
        ]}
        onSelectDate={setSelectedDate}
        onSelectEntry={vi.fn()}
        onWeekChange={setSelectedDate}
      />;
    }
    render(<KeyboardHarness />);

    const wednesday = screen.getByRole("button", { name: "8월 26일 일정 보기" });
    wednesday.focus();
    await userEvent.keyboard("{Enter}");
    expect(wednesday).toHaveAttribute("aria-current", "date");
    expect(screen.getByText("수요일 콘텐츠")).toBeVisible();
    expect(screen.queryByText("화요일 콘텐츠")).not.toBeInTheDocument();

    const tuesday = screen.getByRole("button", { name: "8월 25일 일정 보기" });
    tuesday.focus();
    await userEvent.keyboard(" ");
    expect(tuesday).toHaveAttribute("aria-current", "date");
    expect(screen.getByText("화요일 콘텐츠")).toBeVisible();
    expect(screen.queryByText("수요일 콘텐츠")).not.toBeInTheDocument();
  });
});
