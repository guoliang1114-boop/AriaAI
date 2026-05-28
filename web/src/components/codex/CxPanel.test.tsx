import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CxPanel } from "./CxPanel";
import { CxStatus } from "./CxStatus";

describe("CxPanel", () => {
  it("renders children inside a bordered section", () => {
    render(
      <CxPanel title="项目档案">
        <p>body</p>
      </CxPanel>,
    );
    const panel = screen.getByTestId("cx-panel");
    expect(panel.tagName).toBe("SECTION");
    expect(panel).toHaveTextContent("项目档案");
    expect(panel).toHaveTextContent("body");
  });

  it("renders subtitle and action when provided", () => {
    render(
      <CxPanel
        title="近期节奏"
        subtitle="未来 14 天的会议与里程碑"
        action={<CxStatus tone="good">已同步</CxStatus>}
      >
        <p>row</p>
      </CxPanel>,
    );
    expect(screen.getByText("未来 14 天的会议与里程碑")).toBeInTheDocument();
    expect(screen.getByTestId("cx-status")).toHaveTextContent("已同步");
  });

  it("omits the header entirely when no title / subtitle / action", () => {
    render(
      <CxPanel>
        <p data-testid="body">body only</p>
      </CxPanel>,
    );
    const panel = screen.getByTestId("cx-panel");
    expect(panel.querySelector("header")).toBeNull();
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });
});
