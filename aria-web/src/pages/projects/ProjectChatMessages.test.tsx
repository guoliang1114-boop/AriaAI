import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ProjectChatMessages } from "./ProjectChatMessages";
import type { ProjectQuickPrompt } from "./projectChatCopy";
import type { GeneratedArtifact, Message, Reference, ToolCallEvent } from "../../types/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "zh" } }),
}));

const noop = vi.fn();

function renderMessages(overrides: Partial<React.ComponentProps<typeof ProjectChatMessages>> = {}) {
  const props: React.ComponentProps<typeof ProjectChatMessages> = {
    choosePromptLabel: "选择一个场景",
    highlightedMessageId: null,
    isGeneratingPlan: false,
    isLoading: true,
    isLoadingMessages: false,
    isStreamingTruncated: false,
    messages: [] as Message[],
    onDownloadArtifact: noop,
    onOpenArtifact: noop,
    onOpenTasks: noop,
    onQuickPrompt: noop,
    onSaveMessage: noop,
    planResult: null,
    projectId: 27,
    quickPrompts: [] as ProjectQuickPrompt[],
    startConversationLabel: "开始对话",
    streamingArtifacts: [] as GeneratedArtifact[],
    streamingContent: "",
    streamingReferences: [] as Reference[],
    streamingStatus: "",
    streamingToolCalls: [] as ToolCallEvent[],
    thinkingLabel: "思考中",
    ...overrides,
  };

  return render(
    <MemoryRouter>
      <ProjectChatMessages {...props} />
    </MemoryRouter>,
  );
}

describe("ProjectChatMessages UX baseline", () => {
  it("shows ordinary stream status as a lightweight hint instead of a progress card", () => {
    renderMessages({
      streamingStatus: "正在理解你的需求，并准备调用模型生成方案...",
    });

    expect(screen.getByText("正在理解你的需求，并准备调用模型生成方案...")).toBeInTheDocument();
    expect(screen.queryByText("理解需求")).not.toBeInTheDocument();
    expect(screen.queryByText("规划执行")).not.toBeInTheDocument();
    expect(screen.queryByText("处理进度")).not.toBeInTheDocument();
    expect(screen.queryByText("保存结果")).not.toBeInTheDocument();
  });

  it("keeps real workflow steps visible as collapsible step cards", () => {
    renderMessages({
      streamingStatus: "正在整理项目上下文。",
      streamingToolCalls: [
        {
          tool_name: "步骤 1/4：判断执行方式",
          status: "completed",
          message: "第 1 步已完成。",
          step_index: 1,
          step_total: 4,
          step_title: "判断执行方式",
        },
      ],
    });

    expect(screen.getByText((_, element) => element?.textContent === "步骤 1/4·判断执行方式")).toBeInTheDocument();
    expect(screen.getByText("正在整理项目上下文。")).toBeInTheDocument();
  });
});
