import { describe, expect, it, beforeEach } from "vitest";

import { buildDownloadUrl } from "./downloadArtifact";

describe("buildDownloadUrl", () => {
  beforeEach(() => {
    localStorage.setItem("serverUrl", "https://aria.example.com/api");
  });

  it("uses artifact path before artifact id so task artifacts can download", () => {
    const url = buildDownloadUrl({
      artifact: {
        id: 34,
        name: "客户会议准备.md",
        file_type: "md",
        path: "projects/27/客户会议准备.md",
      },
    });

    expect(url).toBe(
      "https://aria.example.com/api/artifacts/download-by-path?path=projects%2F27%2F%E5%AE%A2%E6%88%B7%E4%BC%9A%E8%AE%AE%E5%87%86%E5%A4%87.md",
    );
  });

  it("falls back to id when no path is available", () => {
    const url = buildDownloadUrl({ artifactId: 34 });

    expect(url).toBe("https://aria.example.com/api/artifacts/34/download");
  });
});
