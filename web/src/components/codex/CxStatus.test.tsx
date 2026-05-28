import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CxStatus } from "./CxStatus";

describe("CxStatus", () => {
  it("renders the label and exposes the tone via data attribute", () => {
    render(<CxStatus tone="good">on track</CxStatus>);
    const pill = screen.getByTestId("cx-status");
    expect(pill).toHaveTextContent("on track");
    expect(pill).toHaveAttribute("data-tone", "good");
  });

  it("falls back to neutral when no tone is provided", () => {
    render(<CxStatus>idle</CxStatus>);
    expect(screen.getByTestId("cx-status")).toHaveAttribute("data-tone", "neutral");
  });

  it("attaches the pulse animation class only when pulse is true", () => {
    const { rerender } = render(<CxStatus tone="accent">live</CxStatus>);
    let dot = screen.getByTestId("cx-status").querySelector("span");
    expect(dot?.className).not.toContain("codex-dot-pulse");

    rerender(
      <CxStatus tone="accent" pulse>
        live
      </CxStatus>,
    );
    dot = screen.getByTestId("cx-status").querySelector("span");
    expect(dot?.className).toContain("codex-dot-pulse");
  });

  it("colors the pill and the dot with the tone's CSS variable", () => {
    render(<CxStatus tone="bad">error</CxStatus>);
    const pill = screen.getByTestId("cx-status");
    expect(pill).toHaveStyle({ color: "var(--color-codex-bad)" });
    const dot = pill.querySelector("span");
    expect(dot).toHaveStyle({ background: "var(--color-codex-bad)" });
  });
});
