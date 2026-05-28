import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CxSwitch } from "./CxSwitch";

describe("CxSwitch", () => {
  it("renders as a switch button with the current aria-checked state", () => {
    const { rerender } = render(
      <CxSwitch checked={false} onCheckedChange={() => {}} aria-label="dark mode" />,
    );
    const button = screen.getByRole("switch", { name: "dark mode" });
    expect(button).toHaveAttribute("aria-checked", "false");

    rerender(
      <CxSwitch checked onCheckedChange={() => {}} aria-label="dark mode" />,
    );
    expect(screen.getByRole("switch", { name: "dark mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("calls onCheckedChange with the opposite value on click", () => {
    const onChange = vi.fn();
    render(
      <CxSwitch checked={false} onCheckedChange={onChange} aria-label="dark mode" />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles on Space key (ARIA APG pattern)", () => {
    const onChange = vi.fn();
    render(
      <CxSwitch checked onCheckedChange={onChange} aria-label="dark mode" />,
    );
    fireEvent.keyDown(screen.getByRole("switch"), { key: " " });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not fire onCheckedChange when disabled", () => {
    const onChange = vi.fn();
    render(
      <CxSwitch
        checked={false}
        onCheckedChange={onChange}
        disabled
        aria-label="dark mode"
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("translates the inner thumb when checked", () => {
    const { rerender } = render(
      <CxSwitch checked={false} onCheckedChange={() => {}} aria-label="toggle" />,
    );
    let thumb = screen.getByRole("switch").firstElementChild as HTMLElement;
    expect(thumb.style.transform).toBe("translateX(0)");

    rerender(
      <CxSwitch checked onCheckedChange={() => {}} aria-label="toggle" />,
    );
    thumb = screen.getByRole("switch").firstElementChild as HTMLElement;
    expect(thumb.style.transform).toBe("translateX(15px)");
  });
});
