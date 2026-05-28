import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CxSkeleton } from "./CxSkeleton";

describe("CxSkeleton", () => {
  it("renders a status role with aria-busy for screen readers", () => {
    render(<CxSkeleton aria-label="Loading project" />);
    const node = screen.getByRole("status", { name: "Loading project" });
    expect(node).toHaveAttribute("aria-busy", "true");
  });

  it("defaults to full-width and 12px height", () => {
    render(<CxSkeleton />);
    const node = screen.getByTestId("cx-skeleton");
    expect(node).toHaveStyle({ width: "100%", height: "12px" });
  });

  it("accepts numeric or string sizes", () => {
    render(<CxSkeleton w={320} h="2rem" />);
    const node = screen.getByTestId("cx-skeleton");
    expect(node).toHaveStyle({ width: "320px", height: "2rem" });
  });

  it("uses the codex-shimmer animation", () => {
    render(<CxSkeleton />);
    const node = screen.getByTestId("cx-skeleton");
    expect(node.style.animation).toContain("codex-shimmer");
  });

  it("allows overriding the corner radius", () => {
    render(<CxSkeleton radius={999} />);
    const node = screen.getByTestId("cx-skeleton");
    expect(node).toHaveStyle({ borderRadius: "999px" });
  });
});
