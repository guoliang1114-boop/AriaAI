import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FirstRunPreferredNameModal, __test__ } from "./FirstRunPreferredNameModal";

const putMock = vi.fn();
vi.mock("../api/client", () => ({
  api: {
    put: (...args: unknown[]) => putMock(...args),
  },
}));

beforeEach(() => {
  putMock.mockReset();
  putMock.mockResolvedValue({
    preferences: { personal_info: { preferred_name: "李总" } },
    version: 1,
    updated_at: "",
  });
});

describe("mergePreferredName", () => {
  it("preserves existing non-conflicting preferences", () => {
    const result = __test__.mergePreferredName(
      { response_preferences: { tone: "direct" } },
      "李总",
    );
    expect(result).toEqual({
      response_preferences: { tone: "direct" },
      personal_info: { preferred_name: "李总" },
    });
  });

  it("preserves sibling personal_info fields (e.g. title)", () => {
    const result = __test__.mergePreferredName(
      { personal_info: { title: "CEO" } },
      "李总",
    );
    expect(result).toEqual({
      personal_info: { title: "CEO", preferred_name: "李总" },
    });
  });

  it("overwrites a prior preferred_name", () => {
    const result = __test__.mergePreferredName(
      { personal_info: { preferred_name: "旧称呼" } },
      "新称呼",
    );
    expect(result.personal_info).toEqual({ preferred_name: "新称呼" });
  });
});

describe("FirstRunPreferredNameModal", () => {
  it("renders the dialog with input focused", () => {
    render(<FirstRunPreferredNameModal existingPreferences={{}} onSaved={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("preferred-name-input")).toHaveFocus();
  });

  it("disables the save button until a non-empty name is typed", () => {
    render(<FirstRunPreferredNameModal existingPreferences={{}} onSaved={() => {}} />);

    const save = screen.getByTestId("preferred-name-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const input = screen.getByTestId("preferred-name-input");
    fireEvent.change(input, { target: { value: "   " } });
    expect(save.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "李总" } });
    expect(save.disabled).toBe(false);
  });

  it("PUTs the merged preferences and calls onSaved with the server response", async () => {
    const onSaved = vi.fn();
    render(
      <FirstRunPreferredNameModal
        existingPreferences={{ response_preferences: { tone: "direct" } }}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByTestId("preferred-name-input"), {
      target: { value: "李总" },
    });
    fireEvent.click(screen.getByTestId("preferred-name-save"));

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/user-memory", {
        preferences: {
          response_preferences: { tone: "direct" },
          personal_info: { preferred_name: "李总" },
        },
      });
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
        personal_info: { preferred_name: "李总" },
      });
    });
  });

  it("Enter key triggers save just like the button", async () => {
    const onSaved = vi.fn();
    render(<FirstRunPreferredNameModal existingPreferences={{}} onSaved={onSaved} />);

    const input = screen.getByTestId("preferred-name-input");
    fireEvent.change(input, { target: { value: "小高" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("surfaces a server error and keeps the modal open", async () => {
    putMock.mockRejectedValueOnce(new Error("boom"));
    const onSaved = vi.fn();
    render(<FirstRunPreferredNameModal existingPreferences={{}} onSaved={onSaved} />);

    fireEvent.change(screen.getByTestId("preferred-name-input"), {
      target: { value: "李总" },
    });
    fireEvent.click(screen.getByTestId("preferred-name-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(onSaved).not.toHaveBeenCalled();
    // Modal still present so the user can retry.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("trims whitespace before saving", async () => {
    render(<FirstRunPreferredNameModal existingPreferences={{}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId("preferred-name-input"), {
      target: { value: "  小李  " },
    });
    fireEvent.click(screen.getByTestId("preferred-name-save"));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/user-memory", {
        preferences: { personal_info: { preferred_name: "小李" } },
      }),
    );
  });
});
