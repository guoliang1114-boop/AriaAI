import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh-CN" } }),
}));

import { AppearanceSettings } from "./AppearanceSettings";
import { CODEX_APPEARANCE_DEFAULT } from "../../utils/codexAppearance";

describe("AppearanceSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("renders the four control groups and a preview card", () => {
    render(<AppearanceSettings />);
    expect(screen.getByTestId("appearance-theme")).toBeInTheDocument();
    expect(screen.getByTestId("appearance-accent")).toBeInTheDocument();
    expect(screen.getByTestId("appearance-density")).toBeInTheDocument();
    expect(screen.getByTestId("appearance-radius")).toBeInTheDocument();
    expect(screen.getByTestId("appearance-preview")).toBeInTheDocument();
  });

  it("marks the saved value as aria-checked on each control", () => {
    render(<AppearanceSettings />);
    const themeGroup = screen.getByTestId("appearance-theme");
    const light = within(themeGroup).getByRole("radio", { name: "浅色" });
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(CODEX_APPEARANCE_DEFAULT.theme).toBe("light");
  });

  it("picking dark theme writes to localStorage AND applies .dark to <html>", () => {
    render(<AppearanceSettings />);
    const themeGroup = screen.getByTestId("appearance-theme");

    act(() => {
      fireEvent.click(within(themeGroup).getByRole("radio", { name: "深色" }));
    });

    expect(window.localStorage.getItem("aria-codex-appearance")).toContain('"theme":"dark"');
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(within(themeGroup).getByRole("radio", { name: "深色" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("picking an accent updates the class and aria-checked, leaving theme alone", () => {
    render(<AppearanceSettings />);
    const accentGroup = screen.getByTestId("appearance-accent");

    act(() => {
      fireEvent.click(within(accentGroup).getByRole("radio", { name: "琥珀" }));
    });

    expect(document.documentElement.classList.contains("accent-amber")).toBe(true);
    expect(document.documentElement.classList.contains("accent-moss")).toBe(false);
    // Theme untouched.
    expect(
      window.localStorage.getItem("aria-codex-appearance"),
    ).toContain('"theme":"light"');
  });

  it("density and radius pickers swap their class on <html>", () => {
    render(<AppearanceSettings />);

    act(() => {
      fireEvent.click(
        within(screen.getByTestId("appearance-density")).getByRole("radio", { name: "宽松" }),
      );
    });
    expect(document.documentElement.classList.contains("density-comfy")).toBe(true);
    expect(document.documentElement.classList.contains("density-regular")).toBe(false);

    act(() => {
      fireEvent.click(
        within(screen.getByTestId("appearance-radius")).getByRole("radio", { name: "圆润" }),
      );
    });
    expect(document.documentElement.classList.contains("radius-round")).toBe(true);
    expect(document.documentElement.classList.contains("radius-soft")).toBe(false);
  });
});
