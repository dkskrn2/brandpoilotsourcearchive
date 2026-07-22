import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelLogo } from "./ChannelLogo";

describe("ChannelLogo", () => {
  it("renders a decorative local Instagram logo", () => {
    const { container } = render(<ChannelLogo channel="instagram" decorative />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/assets/channels/instagram.svg");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("uses the supplied accessible channel label", () => {
    render(<ChannelLogo channel="youtube" label="YouTube" />);
    expect(screen.getByRole("img", { name: "YouTube" })).toHaveAttribute("src", "/assets/channels/youtube.svg");
  });

  it("uses the official local LinkedIn PNG", () => {
    render(<ChannelLogo channel="linkedin" label="LinkedIn" />);
    expect(screen.getByRole("img", { name: "LinkedIn" })).toHaveAttribute("src", "/assets/channels/linkedin.png");
  });
});
