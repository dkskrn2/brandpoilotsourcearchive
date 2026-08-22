import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ManualPublishProvisioner } from "./ManualPublishProvisioner";
import type { PublishCalendarManualOptions } from "../../types";

const options: PublishCalendarManualOptions = {
  purposes: [{ value: "informational", label: "정보성" }],
  subjectModes: [{ value: "topic_text", label: "직접 입력", requiredField: "topicText" }],
  channels: [{ value: "instagram", label: "Instagram", formats: [{ value: "card_news", label: "카드뉴스" }, { value: "reel", label: "릴스" }] }],
  products: [],
  suggestions: [],
  references: [],
  usage: {
    startsAt: "2099-08-20T00:00:00.000Z",
    endsAt: "2099-08-27T00:00:00.000Z",
    generation: { limit: 10, succeeded: 0, reserved: 0, remaining: 10, additionalAvailable: 10 },
    publishing: { limit: 10, succeeded: 0, reserved: 0, remaining: 10, additionalAvailable: 10 }
  }
};

function renderProvisioner(dateKey = "2099-08-24") {
  const onStartBulk = vi.fn();
  render(<ManualPublishProvisioner
    dateKey={dateKey}
    connected
    options={options}
    optionsError={null}
    onStartNew={vi.fn()}
    initialBulkDraft={null}
    onStartBulk={onStartBulk}
    onContinueBulk={vi.fn()}
    onProvisionBatch={vi.fn(async () => true)}
  />);
  return { onStartBulk };
}

describe("ManualPublishProvisioner bulk times", () => {
  it("allows duplicate and nearby times and copies the last time into a new row", async () => {
    const { onStartBulk } = renderProvisioner();
    await userEvent.click(screen.getByRole("radio", { name: "여러 주제 일괄 설정" }));
    const table = screen.getByRole("table", { name: "일괄 주제 설정" });
    const times = [within(table).getByLabelText("1행 게시 시간"), within(table).getByLabelText("2행 게시 시간")];
    await userEvent.clear(times[1]);
    await userEvent.type(times[1], "11:45");
    const topics = within(table).getAllByRole("textbox", { name: "주제" });
    await userEvent.type(topics[0], "SNS 마케팅 기본기");
    await userEvent.type(topics[1], "사장님 콘텐츠 운영");

    await userEvent.click(screen.getByRole("button", { name: "행 추가" }));
    const updatedTable = screen.getByRole("table", { name: "일괄 주제 설정" });
    const updatedTimes = [
      within(updatedTable).getByLabelText("1행 게시 시간"),
      within(updatedTable).getByLabelText("2행 게시 시간"),
      within(updatedTable).getByLabelText("3행 게시 시간")
    ];
    expect(updatedTimes[2]).toHaveValue("11:45");
    await userEvent.type(within(updatedTable).getAllByRole("textbox", { name: "주제" })[2], "릴스 주제 기획");
    await userEvent.click(screen.getByRole("button", { name: "일괄 설정 시작" }));

    expect(onStartBulk).toHaveBeenCalledTimes(1);
    expect(onStartBulk.mock.calls[0][0].map((row: { scheduledFor: string }) => row.scheduledFor)).toEqual([
      "2099-08-24T02:30:00.000Z",
      "2099-08-24T02:45:00.000Z",
      "2099-08-24T02:45:00.000Z"
    ]);
    expect(screen.queryByText(/30분 간격/)).not.toBeInTheDocument();
  });

  it("still blocks bulk rows in the past", async () => {
    renderProvisioner("2000-01-01");
    await userEvent.click(screen.getByRole("radio", { name: "여러 주제 일괄 설정" }));
    expect(screen.getByText("모든 게시 시간은 미래여야 합니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "일괄 설정 시작" })).toBeDisabled();
  });
});
