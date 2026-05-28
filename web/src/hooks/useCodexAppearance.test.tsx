import { describe, expect, it, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { useCodexAppearance } from "./useCodexAppearance";
import {
  CODEX_APPEARANCE_DEFAULT,
  CODEX_APPEARANCE_EVENT,
  writeSavedAppearance,
} from "../utils/codexAppearance";

function Probe() {
  const { appearance, setAppearance, patchAppearance } = useCodexAppearance();
  return (
    <div>
      <span data-testid="theme">{appearance.theme}</span>
      <span data-testid="accent">{appearance.accent}</span>
      <button
        data-testid="set-dark-azure"
        onClick={() =>
          setAppearance({
            theme: "dark",
            accent: "azure",
            density: "comfy",
            radius: "round",
          })
        }
      />
      <button
        data-testid="patch-accent-amber"
        onClick={() => patchAppearance({ accent: "amber" })}
      />
    </div>
  );
}

describe("useCodexAppearance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("seeds state from localStorage on mount", () => {
    writeSavedAppearance({
      theme: "dark",
      accent: "amber",
      density: "comfy",
      radius: "round",
    });
    render(<Probe />);
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("accent").textContent).toBe("amber");
  });

  it("falls back to the default when storage is empty", () => {
    render(<Probe />);
    expect(screen.getByTestId("theme").textContent).toBe(CODEX_APPEARANCE_DEFAULT.theme);
    expect(screen.getByTestId("accent").textContent).toBe(CODEX_APPEARANCE_DEFAULT.accent);
  });

  it("setAppearance persists + applies + updates state", () => {
    render(<Probe />);
    act(() => {
      screen.getByTestId("set-dark-azure").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("accent").textContent).toBe("azure");
    expect(window.localStorage.getItem("aria-codex-appearance")).toContain('"theme":"dark"');
    expect(document.documentElement.classList.contains("accent-azure")).toBe(true);
  });

  it("patchAppearance updates one field and preserves the rest", () => {
    render(<Probe />);
    act(() => {
      screen.getByTestId("patch-accent-amber").click();
    });
    expect(screen.getByTestId("accent").textContent).toBe("amber");
    expect(screen.getByTestId("theme").textContent).toBe(CODEX_APPEARANCE_DEFAULT.theme);
  });

  it("syncs across hook instances via the change event", () => {
    render(
      <>
        <Probe />
        <Probe />
      </>,
    );
    const accents = screen.getAllByTestId("accent");
    expect(accents[0].textContent).toBe(CODEX_APPEARANCE_DEFAULT.accent);
    expect(accents[1].textContent).toBe(CODEX_APPEARANCE_DEFAULT.accent);

    // First probe's button mutates → both probes should observe the change
    // (because writeSavedAppearance dispatches CODEX_APPEARANCE_EVENT).
    act(() => {
      screen.getAllByTestId("patch-accent-amber")[0].click();
    });
    const updated = screen.getAllByTestId("accent");
    expect(updated[0].textContent).toBe("amber");
    expect(updated[1].textContent).toBe("amber");
  });

  it("ignores events with no detail payload", () => {
    render(<Probe />);
    const before = screen.getByTestId("accent").textContent;
    act(() => {
      window.dispatchEvent(new CustomEvent(CODEX_APPEARANCE_EVENT));
    });
    expect(screen.getByTestId("accent").textContent).toBe(before);
  });
});
