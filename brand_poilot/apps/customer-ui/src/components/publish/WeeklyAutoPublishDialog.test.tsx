import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChannelConnection, PublishCalendarWeeklySettings, PublishCalendarWeeklyUsage } from "../../types";
import { WeeklyAutoPublishDialog } from "./WeeklyAutoPublishDialog";

const settings: PublishCalendarWeeklySettings = {
  brandId: "brand-1",
  enabled: false,
  channels: ["instagram", "threads", "youtube"],
  informationalFormat: "card_news",
  trendFormat: "reel",
  weeklySchedule: [
    { id: "40000000-0000-4000-8000-000000000001", dayOfWeek: 1, time: "11:17", sortOrder: 0 },
    { id: "40000000-0000-4000-8000-000000000002", dayOfWeek: 1, time: "11:17", sortOrder: 1 },
  ],
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const channels: ChannelConnection[] = [
  { type: "instagram", label: "Instagram", enabled: true, oauthState: "connected", status: "connected", accountLabel: "@brand", lastHealthyAt: "", lastPublishedAt: "" },
  { type: "threads", label: "Threads", enabled: true, oauthState: "connected", status: "connected", accountLabel: "@brand_threads", lastHealthyAt: "", lastPublishedAt: "" },
  { type: "youtube", label: "YouTube", enabled: false, oauthState: "not_connected", status: "not_connected", accountLabel: "연결 전", lastHealthyAt: "", lastPublishedAt: "" },
];

const usage: PublishCalendarWeeklyUsage = {
  startsAt: "2026-08-23T15:00:00.000Z",
  endsAt: "2026-08-30T15:00:00.000Z",
  generation: { limit: 30, succeeded: 0, reserved: 0, remaining: 30, additionalAvailable: 30 },
  publishing: { limit: 30, succeeded: 2, reserved: 3, remaining: 28, additionalAvailable: 25 },
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof WeeklyAutoPublishDialog>> = {}) {
  const props: React.ComponentProps<typeof WeeklyAutoPublishDialog> = {
    settings,
    channels,
    publishableChannels: ["instagram", "youtube"],
    usage,
    now: new Date("2026-08-26T06:00:00.000Z"),
    onClose: vi.fn(),
    onSave: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
  const view = render(<WeeklyAutoPublishDialog {...props} />);
  return {
    props,
    rerender(next: Partial<React.ComponentProps<typeof WeeklyAutoPublishDialog>>) {
      view.rerender(<WeeklyAutoPublishDialog {...props} {...next} />);
    },
  };
}

describe("WeeklyAutoPublishDialog", () => {
  it("focuses its heading, traps focus, and never duplicates the master switch", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "주간 자동 게시 설정" });
    expect(within(dialog).getByRole("heading", { name: "주간 자동 게시 설정" })).toHaveFocus();
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();

    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "설정 저장" })).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole("button", { name: "닫기" })).toHaveFocus();
  });

  it("shows API-driven channels and preserves a saved disconnected selection", () => {
    renderDialog();

    expect(screen.getByRole("checkbox", { name: "Instagram 연결됨" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Instagram 연결됨" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Threads 자동 게시 미지원 · 저장된 선택 유지" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Threads 자동 게시 미지원 · 저장된 선택 유지" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "YouTube 미연결 · 저장된 선택 유지" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "YouTube 미연결 · 저장된 선택 유지" })).toBeDisabled();
  });

  it("keeps the saved channel draft neutral and blocks save while channel metadata is unavailable", async () => {
    const onRetryMetadata = vi.fn();
    const onSave = vi.fn(async () => ({ ok: true as const }));
    renderDialog({
      channels: [],
      publishableChannels: [],
      metadataStatus: "error",
      onRetryMetadata,
      onSave,
    } as never);

    expect(screen.getByRole("alert")).toHaveTextContent("게시 채널 정보를 확인하지 못했습니다.");
    expect(screen.getByRole("checkbox", { name: "Instagram 채널 상태 확인 필요 · 저장된 선택 유지" })).toBeChecked();
    expect(screen.queryByText(/자동 게시 미지원|미연결/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "게시 채널 다시 시도" }));
    expect(onRetryMetadata).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the server draft visible and blocks schedule mutations and save while usage is loading", () => {
    renderDialog({ usage: null, usageStatus: "loading" } as never);

    expect(screen.getByText("주간 게시 한도를 확인하는 중입니다.")).toBeVisible();
    expect(screen.getByLabelText("월요일 1번째 게시 시간")).toHaveValue("11:17");
    expect(screen.getByLabelText("월요일 1번째 게시 시간")).toBeDisabled();
    expect(screen.getByRole("button", { name: "월요일 일정 추가" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();
  });

  it("preserves an edited draft across a usage failure retry", async () => {
    const onRetryUsage = vi.fn();
    renderDialog({ usage: null, usageStatus: "error", onRetryUsage } as never);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "정보성 콘텐츠 형식" }), "reel");
    expect(screen.getByRole("alert")).toHaveTextContent("주간 게시 한도를 확인하지 못했습니다.");
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "사용량 다시 시도" }));
    expect(onRetryUsage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "정보성 콘텐츠 형식" })).toHaveValue("reel");
  });

  it("keeps the edited draft and focus inside the dialog while retrying a failed settings read", async () => {
    const onRetrySettings = vi.fn();
    const view = renderDialog({ settingsStatus: "error", onRetrySettings } as never);

    const format = screen.getByRole("combobox", { name: "정보성 콘텐츠 형식" });
    await userEvent.selectOptions(format, "reel");
    const retry = screen.getByRole("button", { name: "주간 설정 다시 시도" });
    retry.focus();
    await userEvent.click(retry);
    view.rerender({ settingsStatus: "loading" });

    expect(onRetrySettings).toHaveBeenCalledTimes(1);
    expect(format).toHaveValue("reel");
    expect(screen.getByRole("dialog", { name: "주간 자동 게시 설정" })).toContainElement(document.activeElement as HTMLElement);

    view.rerender({ settingsStatus: "ready", settings: { ...settings, informationalFormat: "card_news" } });
    expect(format).toHaveValue("reel");
    expect(screen.getByRole("heading", { name: "주간 자동 게시 설정" })).toHaveFocus();
  });

  it("renders Monday through Sunday with the actual dates of the current KST week", () => {
    renderDialog();

    [
      "월요일 8월 24일",
      "화요일 8월 25일",
      "수요일 8월 26일",
      "목요일 8월 27일",
      "금요일 8월 28일",
      "토요일 8월 29일",
      "일요일 8월 30일",
    ].forEach((name) => expect(screen.getByRole("group", { name })).toBeVisible());
  });

  it("keeps duplicate arbitrary-minute rows and supports add, delete, and keyboard reorder actions", async () => {
    renderDialog();
    const monday = screen.getByRole("group", { name: "월요일 8월 24일" });

    expect(within(monday).getAllByLabelText(/게시 시간/)).toHaveLength(2);
    expect(within(monday).getAllByDisplayValue("11:17")).toHaveLength(2);
    expect(within(monday).getAllByLabelText(/게시 시간/)[0]).toHaveAttribute("step", "60");

    await userEvent.click(within(monday).getByRole("button", { name: "월요일 일정 추가" }));
    expect(within(monday).getAllByLabelText(/게시 시간/)).toHaveLength(3);
    await userEvent.clear(within(monday).getAllByLabelText(/게시 시간/)[2]);
    await userEvent.type(within(monday).getAllByLabelText(/게시 시간/)[2], "09:43");

    await userEvent.click(within(monday).getByRole("button", { name: "월요일 3번째 일정을 위로 이동" }));
    expect(within(monday).getAllByLabelText(/게시 시간/)[1]).toHaveValue("09:43");
    await userEvent.click(within(monday).getByRole("button", { name: "월요일 2번째 일정 삭제" }));
    expect(within(monday).getAllByLabelText(/게시 시간/)).toHaveLength(2);
  });

  it("shows the API-provided weekly plan count and limit with the reservation preservation notice", () => {
    renderDialog();

    expect(screen.getByText("주간 게시 계획 2/30건")).toBeVisible();
    expect(screen.getByText("설정을 바꾸거나 자동 게시를 꺼도 기존 예약은 유지됩니다.")).toBeVisible();
  });

  it("copies confirmed settings into a disposable draft and cancel does not save", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    renderDialog({ onSave, onClose });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "정보성 콘텐츠 형식" }), "reel");
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves the unsaved draft and save-button focus after a failed save", async () => {
    const onSave = vi.fn(async () => ({ ok: false as const, message: "주간 자동 게시 설정을 저장하지 못했습니다." }));
    renderDialog({ onSave });
    const monday = screen.getByRole("group", { name: "월요일 8월 24일" });
    const firstTime = within(monday).getAllByLabelText(/게시 시간/)[0];
    await userEvent.clear(firstTime);
    await userEvent.type(firstTime, "07:13");

    const save = screen.getByRole("button", { name: "설정 저장" });
    await userEvent.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent("주간 자동 게시 설정을 저장하지 못했습니다.");
    expect(firstTime).toHaveValue("07:13");
    expect(save).toHaveFocus();
  });

  it("saves configuration without a master enabled field and preserves duplicate rows", async () => {
    const onSave = vi.fn(async (_input: import("../../types").PublishCalendarWeeklySettingsInput) => ({ ok: true as const }));
    const onClose = vi.fn();
    renderDialog({ onSave, onClose });

    await userEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload).not.toHaveProperty("enabled");
    expect(payload.channels).toEqual(["instagram", "threads", "youtube"]);
    expect(payload.weeklySchedule).toEqual([
      { id: "40000000-0000-4000-8000-000000000001", dayOfWeek: 1, time: "11:17", sortOrder: 0 },
      { id: "40000000-0000-4000-8000-000000000002", dayOfWeek: 1, time: "11:17", sortOrder: 1 },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks an ON draft after removing all weekly rows and shows the actionable schedule message", async () => {
    renderDialog({ settings: { ...settings, enabled: true } });

    await userEvent.click(screen.getByRole("button", { name: "월요일 1번째 일정 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "월요일 1번째 일정 삭제" }));

    expect(screen.getByRole("alert")).toHaveTextContent("자동 게시가 켜져 있어 설정을 저장하려면 주간 일정을 한 개 이상 추가해 주세요.");
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();
  });

  it("blocks an ON draft after removing its last usable channel", async () => {
    renderDialog({ settings: { ...settings, enabled: true, channels: ["instagram"] } });

    await userEvent.click(screen.getByRole("checkbox", { name: "Instagram 연결됨" }));

    expect(screen.getByRole("alert")).toHaveTextContent("자동 게시가 켜져 있어 설정을 저장하려면 게시 가능한 연결 채널을 한 개 이상 선택해 주세요.");
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();
  });

  it("does not count preserved unavailable selections as usable for an ON draft", () => {
    renderDialog({ settings: { ...settings, enabled: true, channels: ["threads", "youtube"] } });

    expect(screen.getByRole("checkbox", { name: "Threads 자동 게시 미지원 · 저장된 선택 유지" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "YouTube 미연결 · 저장된 선택 유지" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("자동 게시가 켜져 있어 설정을 저장하려면 게시 가능한 연결 채널을 한 개 이상 선택해 주세요.");
    expect(screen.getByRole("button", { name: "설정 저장" })).toBeDisabled();
  });

  it("allows an OFF draft to save without rows or a usable selected channel", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const }));
    renderDialog({ settings: { ...settings, enabled: false, channels: ["threads"], weeklySchedule: [] }, onSave });

    await userEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ channels: ["threads"], weeklySchedule: [] })));
  });
});
