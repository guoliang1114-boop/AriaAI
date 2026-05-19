import { describe, expect, it } from "vitest";

import {
  getActiveMentionQuery,
  insertMention,
  mentionsToContext,
  parseMentions,
  stripMentionMarkers,
} from "./projectChatMentions";

describe("projectChatMentions", () => {
  it("parses file, stakeholder and milestone mentions", () => {
    const mentions = parseMentions("请看 @f:7:brief.md 问 @s:3:张三 和 @m:2:启动会");

    expect(mentions).toEqual([
      { type: "file", id: 7, name: "brief.md", raw: "@f:7:brief.md" },
      { type: "stakeholder", id: 3, name: "张三", raw: "@s:3:张三" },
      { type: "milestone", id: 2, name: "启动会", raw: "@m:2:启动会" },
    ]);
  });

  it("converts mentions to backend mention context", () => {
    const context = mentionsToContext(parseMentions("@f:1:a.md @s:2:王总 @m:3:交付"));

    expect(context).toEqual({
      file_ids: [1],
      stakeholder_ids: [2],
      milestone_ids: [3],
    });
  });

  it("detects active mention query before whitespace", () => {
    expect(getActiveMentionQuery("帮我 @王", 5)).toEqual({ query: "王", startPos: 3 });
    expect(getActiveMentionQuery("帮我 @王 总", 6)).toBeNull();
  });

  it("inserts mention at the active query", () => {
    expect(insertMention("请问 @wa 后续", 6, "stakeholder", 9, "王总")).toBe(
      "请问 @s:9:王总 后续",
    );
  });

  it("strips storage markers for display text", () => {
    expect(stripMentionMarkers("请看 @f:7:brief.md")).toBe("请看 @brief.md");
  });
});
