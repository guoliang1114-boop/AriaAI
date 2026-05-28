import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CxLogo } from "./CxLogo";

describe("CxLogo", () => {
  it("renders the monogram and wordmark by default", () => {
    render(<CxLogo />);
    const root = screen.getByTestId("cx-logo");
    expect(root).toHaveTextContent(/^a\s*Aria$/);
  });

  it("hides the wordmark when showWordmark is false", () => {
    render(<CxLogo showWordmark={false} />);
    const root = screen.getByTestId("cx-logo");
    expect(root.textContent?.trim()).toBe("a");
  });

  it("uses the provided size for the monogram square", () => {
    render(<CxLogo size={36} />);
    const square = screen.getByTestId("cx-logo").firstElementChild as HTMLElement;
    expect(square).toHaveStyle({ width: "36px", height: "36px" });
  });

  it("scales the wordmark up with size unless wordmarkSize overrides", () => {
    const { rerender } = render(<CxLogo size={36} />);
    let wordmark = screen.getByText("Aria");
    expect(wordmark).toHaveStyle({ fontSize: "17px" });

    rerender(<CxLogo size={36} wordmarkSize={22} />);
    wordmark = screen.getByText("Aria");
    expect(wordmark).toHaveStyle({ fontSize: "22px" });
  });
});
