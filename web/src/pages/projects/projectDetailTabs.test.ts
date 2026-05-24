import { describe, expect, it } from "vitest";
import { getActiveProjectDetailTabId } from "./projectDetailTabs";

describe("getActiveProjectDetailTabId", () => {
  it("treats conversation-specific chat URLs as the chat tab", () => {
    expect(getActiveProjectDetailTabId("/projects/26/chat/123", "26")).toBe("chat");
  });
});
