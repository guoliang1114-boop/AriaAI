import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigateMock };
});

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
}));

beforeEach(() => {
  navigateMock.mockReset();
  apiGet.mockReset();
  apiPut.mockReset();
  apiGet.mockResolvedValue({ preferences: {}, version: 0, updated_at: "" });
  apiPut.mockResolvedValue({ preferences: {}, version: 1, updated_at: "" });
});

async function renderPage() {
  // PreferenceOnboarding is imported dynamically so the mocks above are in
  // place before the module evaluates.
  const { PreferenceOnboarding } = await import("./PreferenceOnboarding");
  const utils = render(
    <MemoryRouter>
      <PreferenceOnboarding />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("preference-onboarding-page")).toBeInTheDocument(),
  );
  return utils;
}

// Codex chip groups render as ``<div role=radiogroup><button role=radio>…``,
// not native ``<select>``. Pick a chip by its visible label.
function selectChip(groupTestId: string, label: string) {
  const group = screen.getByTestId(groupTestId);
  fireEvent.click(within(group).getByRole("radio", { name: label }));
}

describe("PreferenceOnboarding payload helpers", () => {
  it("buildPayloadFromDraft preserves unrelated existing keys and stamps onboarding_seen", async () => {
    const { __test__ } = await import("./PreferenceOnboarding");
    const result = __test__.buildPayloadFromDraft(
      { client_facts_should_not_appear: "ok" } as Record<string, unknown>,
      {
        preferred_name: "李总",
        language: "zh",
        tone: "direct",
        format: "",
        ask_before_destructive: "true",
        proactive_care: "work_partner",
      },
    );
    expect(result.client_facts_should_not_appear).toBe("ok");
    expect(result.personal_info).toEqual({
      preferred_name: "李总",
      onboarding_seen: true,
    });
    expect(result.response_preferences).toEqual({ language: "zh", tone: "direct" });
    expect(result.work_style).toEqual({ ask_before_destructive: true });
    expect(result.collaboration_style).toEqual({ proactive_care: "work_partner" });
  });

  it("buildPayloadFromDraft drops empty preferred_name but still stamps onboarding_seen", async () => {
    const { __test__ } = await import("./PreferenceOnboarding");
    const result = __test__.buildPayloadFromDraft(
      {},
      {
        preferred_name: "   ",
        language: "",
        tone: "",
        format: "",
        ask_before_destructive: "",
        proactive_care: "",
      },
    );
    expect(result.personal_info).toEqual({ onboarding_seen: true });
    expect(result.response_preferences).toBeUndefined();
    expect(result.work_style).toBeUndefined();
    expect(result.collaboration_style).toBeUndefined();
  });

  it("readDraftFromPreferences round-trips a saved payload back into the form shape", async () => {
    const { __test__ } = await import("./PreferenceOnboarding");
    const draft = __test__.readDraftFromPreferences({
      personal_info: { preferred_name: "李总" },
      response_preferences: { language: "zh", tone: "direct", format: "free" },
      work_style: { ask_before_destructive: true },
      collaboration_style: { proactive_care: "gentle" },
    });
    expect(draft).toEqual({
      preferred_name: "李总",
      language: "zh",
      tone: "direct",
      format: "free",
      ask_before_destructive: "true",
      proactive_care: "gentle",
    });
  });
});

describe("PreferenceOnboarding rendered behaviour", () => {
  it("renders the form column, chip groups, and the preview column", async () => {
    await renderPage();
    expect(screen.getByTestId("onb-preferred-name")).toBeInTheDocument();
    expect(screen.getByTestId("onb-language")).toBeInTheDocument();
    expect(screen.getByTestId("onb-tone")).toBeInTheDocument();
    expect(screen.getByTestId("onb-format")).toBeInTheDocument();
    expect(screen.getByTestId("onb-proactive-care")).toBeInTheDocument();
    expect(screen.getByTestId("onb-ask")).toBeInTheDocument();
    expect(screen.getByTestId("preview-aria-reply")).toBeInTheDocument();
  });

  it("clicking a chip toggles aria-checked on the radio and re-renders the preview", async () => {
    await renderPage();
    const reply = screen.getByTestId("preview-aria-reply");
    const before = reply.textContent;

    const toneGroup = screen.getByTestId("onb-tone");
    const friendly = within(toneGroup).getByRole("radio", { name: "温和" });
    expect(friendly).toHaveAttribute("aria-checked", "false");

    fireEvent.click(friendly);

    expect(friendly).toHaveAttribute("aria-checked", "true");
    await waitFor(() => {
      expect(screen.getByTestId("preview-aria-reply").textContent).not.toBe(before);
    });
  });

  it("clicking the active chip again clears the selection", async () => {
    await renderPage();
    const toneGroup = screen.getByTestId("onb-tone");
    const direct = within(toneGroup).getByRole("radio", { name: "直接" });

    fireEvent.click(direct);
    expect(direct).toHaveAttribute("aria-checked", "true");

    fireEvent.click(direct);
    expect(direct).toHaveAttribute("aria-checked", "false");
  });

  it('"完成设置" PUTs the draft + stamps onboarding_seen + navigates to "/"', async () => {
    await renderPage();
    fireEvent.change(screen.getByTestId("onb-preferred-name"), {
      target: { value: "李总" },
    });
    selectChip("onb-language", "中文");
    selectChip("onb-proactive-care", "工作型");
    fireEvent.click(screen.getByTestId("complete-onboarding"));

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const call = apiPut.mock.calls[0];
    expect(call[0]).toBe("/user-memory");
    expect(call[1].preferences.personal_info).toEqual({
      preferred_name: "李总",
      onboarding_seen: true,
    });
    expect(call[1].preferences.response_preferences).toEqual({ language: "zh" });
    expect(call[1].preferences.collaboration_style).toEqual({ proactive_care: "work_partner" });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });

  it('"稍后再说" stamps onboarding_seen ONLY and navigates away', async () => {
    await renderPage();
    fireEvent.change(screen.getByTestId("onb-preferred-name"), {
      target: { value: "Liang" },
    });
    selectChip("onb-language", "English");

    fireEvent.click(screen.getByTestId("skip-onboarding"));

    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const call = apiPut.mock.calls[0];
    // Skip mode discards the draft — only the seen flag persists.
    expect(call[1].preferences).toEqual({ personal_info: { onboarding_seen: true } });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });

  it("keeps the user on the page and shows an error if PUT fails", async () => {
    apiPut.mockRejectedValueOnce(new Error("boom"));
    await renderPage();
    fireEvent.click(screen.getByTestId("complete-onboarding"));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders a setting → effect chip row once a tone is picked", async () => {
    await renderPage();
    // No effect rows visible before any chip is selected.
    expect(screen.queryByText(/省去客套寒暄/)).not.toBeInTheDocument();

    selectChip("onb-tone", "直接");

    await waitFor(() => {
      expect(screen.getByText("语气 · 直接")).toBeInTheDocument();
      expect(screen.getByText(/省去客套寒暄/)).toBeInTheDocument();
    });
  });
});
