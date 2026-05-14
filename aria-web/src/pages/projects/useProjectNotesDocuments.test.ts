import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjectNotesDocuments } from "./useProjectNotesDocuments";
import type { ProjectFile, ProjectFolder } from "../../types/api";

const mockGet = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const makeFile = (overrides: Partial<ProjectFile> = {}): ProjectFile => ({
  id: 1,
  project_id: 10,
  name: "readme.md",
  file_type: "md",
  path: "/files/readme.md",
  size: 100,
  uploaded_at: "2025-01-01T00:00:00Z",
  folder_id: null,
  ...overrides,
});

const makeFolder = (overrides: Partial<ProjectFolder> = {}): ProjectFolder => ({
  id: 100,
  project_id: 10,
  name: "Docs",
  sort_order: 1,
  ...overrides,
});

const defaultProps = {
  projectId: "10",
  files: [] as ProjectFile[],
  folders: [] as ProjectFolder[],
};

describe("useProjectNotesDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
  });

  it("returns empty state when no files or folders provided", () => {
    const { result } = renderHook(() =>
      useProjectNotesDocuments(defaultProps),
    );

    expect(result.current.markdownFiles).toEqual([]);
    expect(result.current.spaceFiles).toEqual([]);
    expect(result.current.folderList).toEqual([]);
    expect(result.current.selectedFileId).toBeNull();
    expect(result.current.content).toBe("");
    expect(result.current.dirty).toBe(false);
    expect(result.current.isLoadingDoc).toBe(false);
    expect(result.current.selectedFile).toBeNull();
  });

  it("filters and sorts markdown files", () => {
    const files = [
      makeFile({ id: 1, name: "zebra.md", file_type: "md" }),
      makeFile({ id: 2, name: "alpha.md", file_type: "md" }),
      makeFile({ id: 3, name: "image.png", file_type: "png" }),
    ];
    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    expect(result.current.markdownFiles).toHaveLength(2);
    expect(result.current.markdownFiles[0].name).toBe("alpha.md");
    expect(result.current.markdownFiles[1].name).toBe("zebra.md");
  });

  it("sorts spaceFiles by folder_id then name", () => {
    const files = [
      makeFile({ id: 1, name: "b.md", folder_id: 2 }),
      makeFile({ id: 2, name: "a.md", folder_id: 1 }),
      makeFile({ id: 3, name: "c.md", folder_id: null }),
    ];
    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    const ids = result.current.spaceFiles.map((f) => f.id);
    expect(ids).toEqual([3, 2, 1]);
  });

  it("sorts folderList by sort_order then name", () => {
    const folders = [
      makeFolder({ id: 1, name: "B", sort_order: 1 }),
      makeFolder({ id: 2, name: "A", sort_order: 1 }),
      makeFolder({ id: 3, name: "C", sort_order: 0 }),
    ];
    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, folders }),
    );

    const ids = result.current.folderList.map((f) => f.id);
    expect(ids).toEqual([3, 2, 1]);
  });

  it("auto-selects first markdown file when files exist", async () => {
    const files = [
      makeFile({ id: 5, name: "doc.md", file_type: "md" }),
      makeFile({ id: 6, name: "pic.png", file_type: "png" }),
    ];
    mockGet.mockResolvedValue({ id: 1, content: "hello", name: "doc.md" });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.selectedFileId).toBe(5);
    });
  });

  it("loads document content for selected markdown file", async () => {
    const files = [makeFile({ id: 5, name: "doc.md", file_type: "md" })];
    mockGet.mockResolvedValue({
      id: 1,
      project_id: 10,
      name: "doc.md",
      content: "# Hello World",
      uploaded_at: "2025-01-01",
    });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingDoc).toBe(false);
    });
    expect(result.current.content).toBe("# Hello World");
    expect(result.current.dirty).toBe(false);
    expect(mockGet).toHaveBeenCalledWith("/projects/10/documents/5");
  });

  it("handles API error when loading document gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const files = [makeFile({ id: 5, name: "doc.md", file_type: "md" })];
    mockGet.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingDoc).toBe(false);
    });
    expect(result.current.content).toBe("");
    consoleSpy.mockRestore();
  });

  it("updateContent sets dirty when content differs from loaded", async () => {
    const files = [makeFile({ id: 5, name: "doc.md", file_type: "md" })];
    mockGet.mockResolvedValue({
      id: 1,
      content: "original",
      name: "doc.md",
    });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.content).toBe("original");
    });

    act(() => {
      result.current.updateContent("modified");
    });

    expect(result.current.content).toBe("modified");
    expect(result.current.dirty).toBe(true);
  });

  it("updateContent clears dirty when content matches loaded", async () => {
    const files = [makeFile({ id: 5, name: "doc.md", file_type: "md" })];
    mockGet.mockResolvedValue({ id: 1, content: "original", name: "doc.md" });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.content).toBe("original");
    });

    act(() => {
      result.current.updateContent("something else");
    });
    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.updateContent("original");
    });
    expect(result.current.dirty).toBe(false);
  });

  it("markContentSynced resets dirty and updates ref", async () => {
    const files = [makeFile({ id: 5, name: "doc.md", file_type: "md" })];
    mockGet.mockResolvedValue({ id: 1, content: "original", name: "doc.md" });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.content).toBe("original");
    });

    act(() => {
      result.current.updateContent("changed");
    });
    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.markContentSynced("changed");
    });
    expect(result.current.dirty).toBe(false);
  });

  it("resetDocumentState clears content and dirty", async () => {
    const files = [makeFile({ id: 5, name: "doc.md", file_type: "md" })];
    mockGet.mockResolvedValue({ id: 1, content: "data", name: "doc.md" });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.content).toBe("data");
    });

    act(() => {
      result.current.updateContent("changed");
    });
    act(() => {
      result.current.resetDocumentState();
    });

    expect(result.current.content).toBe("");
    expect(result.current.dirty).toBe(false);
  });

  it("toggleFolder toggles open/close state", () => {
    const folders = [makeFolder({ id: 100 })];
    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, folders }),
    );

    // Folder defaults to open
    expect(result.current.openFolders[100]).toBe(true);

    act(() => {
      result.current.toggleFolder(100);
    });
    expect(result.current.openFolders[100]).toBe(false);

    act(() => {
      result.current.toggleFolder(100);
    });
    expect(result.current.openFolders[100]).toBe(true);
  });

  it("setSelectedFileId changes selected file", () => {
    const files = [
      makeFile({ id: 1, name: "a.md", file_type: "md" }),
      makeFile({ id: 2, name: "b.md", file_type: "md" }),
    ];
    mockGet.mockResolvedValue({ id: 1, content: "", name: "a.md" });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    act(() => {
      result.current.setSelectedFileId(2);
    });
    expect(result.current.selectedFileId).toBe(2);
  });

  it("clears content when selected file is not markdown", async () => {
    const files = [
      makeFile({ id: 1, name: "a.md", file_type: "md" }),
      makeFile({ id: 2, name: "b.png", file_type: "png" }),
    ];
    mockGet.mockResolvedValue({ id: 1, content: "some content", name: "a.md" });

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files }),
    );

    await waitFor(() => {
      expect(result.current.selectedFileId).toBe(1);
    });

    act(() => {
      result.current.setSelectedFileId(2);
    });

    await waitFor(() => {
      expect(result.current.content).toBe("");
    });
  });

  it("groups files by folder in groupedFiles", () => {
    const folders = [
      makeFolder({ id: 100, name: "FolderA" }),
    ];
    const files = [
      makeFile({ id: 1, name: "in-folder.md", folder_id: 100 }),
      makeFile({ id: 2, name: "uncategorized.md", folder_id: null }),
    ];

    const { result } = renderHook(() =>
      useProjectNotesDocuments({ ...defaultProps, files, folders }),
    );

    const grouped = result.current.groupedFiles;
    expect(grouped.get(100)).toHaveLength(1);
    expect(grouped.get(100)![0].name).toBe("in-folder.md");
    expect(grouped.get("uncategorized")).toHaveLength(1);
    expect(grouped.get("uncategorized")![0].name).toBe("uncategorized.md");
  });
});
