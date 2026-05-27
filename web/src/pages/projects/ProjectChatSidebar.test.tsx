import { describe, expect, it } from "vitest";

import { formatProjectConversationTime } from "./ProjectChatSidebar";

describe("formatProjectConversationTime", () => {
  it("treats backend timestamps without timezone as UTC", () => {
    const now = new Date("2026-05-27T06:00:00Z");

    expect(
      formatProjectConversationTime(
        "2026-05-27T04:09:00",
        "Asia/Shanghai",
        now,
      ),
    ).toBe("12:09");
  });
});
