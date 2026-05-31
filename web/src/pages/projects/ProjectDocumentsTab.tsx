import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Link as LinkIcon,
  Loader2,
  Plus,
} from "lucide-react";
import { api } from "../../api/client";
import { CxPagination } from "../../components/codex";
import { useToast } from "../../contexts/ToastContext";
import type {
  ProjectDetail as ProjectDetailType,
  ProjectFile,
} from "../../types/api";
import { CxPanel } from "./ProjectOverviewPanels";
import { downloadProjectFile } from "./downloadProjectFile";
import { formatDateOnly } from "../../utils/timezone";

interface ProjectDocumentsTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}

interface ProjectFileListResponse {
  items: ProjectFile[];
  total: number;
  limit: number;
  offset: number;
  source_counts: Record<Exclude<FilterKey, "all">, number>;
  recent: ProjectFile[];
}

type FilterKey = "all" | "manual" | "knowledge" | "skill" | "auto";

const FILTER_LABEL_ZH: Record<FilterKey, string> = {
  all: "全部",
  manual: "本地上传",
  knowledge: "知识库链接",
  skill: "Skill 输出",
  auto: "自动生成",
};

const FILTER_LABEL_EN: Record<FilterKey, string> = {
  all: "All",
  manual: "Uploads",
  knowledge: "Knowledge base",
  skill: "Skill output",
  auto: "Auto-generated",
};

const PROJECT_DOCUMENT_PAGE_SIZE = 10;

function originOf(file: ProjectFile): Exclude<FilterKey, "all"> {
  const origin = (file.origin || "").toLowerCase();
  if (origin.includes("knowledge") || origin.includes("kb")) return "knowledge";
  if (origin.includes("skill")) return "skill";
  if (origin.includes("auto") || origin.includes("memory") || origin.includes("generated")) return "auto";
  return "manual";
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function typeBadge(file: ProjectFile): string {
  const ext = (file.file_type || file.name.split(".").pop() || "DOC")
    .replace(/^application\//, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  if (!ext) return "DOC";
  return ext.slice(0, 4);
}

export function ProjectDocumentsTab({
  projectDetail,
  projectId,
  onUpdate,
}: ProjectDocumentsTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>(projectDetail.files);
  const [documentTotal, setDocumentTotal] = useState(projectDetail.files.length);
  const [sourceCounts, setSourceCounts] = useState<Record<Exclude<FilterKey, "all">, number>>({
    manual: 0,
    knowledge: 0,
    skill: 0,
    auto: 0,
  });
  const [recentFiles, setRecentFiles] = useState<ProjectFile[]>([]);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentPageSize, setDocumentPageSize] = useState(PROJECT_DOCUMENT_PAGE_SIZE);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadDocuments = async () => {
    try {
      const data = await api.get<ProjectFileListResponse>(`/projects/${projectId}/files/list`, {
        params: {
          origin: filter,
          limit: documentPageSize,
          offset: (documentPage - 1) * documentPageSize,
        },
      });
      setFiles(data.items);
      setDocumentTotal(data.total);
      setSourceCounts(data.source_counts);
      setRecentFiles(data.recent);
    } catch (error) {
      console.error("Failed to load project documents:", error);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, [documentPage, documentPageSize, filter, projectDetail.files, projectId]);

  const allDocumentCount = Object.values(sourceCounts).reduce((sum, value) => sum + value, 0);
  const documentPageCount = Math.max(1, Math.ceil(documentTotal / documentPageSize));
  const currentDocumentPage = Math.min(documentPage, documentPageCount);

  useEffect(() => {
    setDocumentPage(1);
  }, [filter]);

  useEffect(() => {
    setDocumentPage((current) => Math.min(current, documentPageCount));
  }, [documentPageCount]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api.post(`/projects/${projectId}/files`, form);
      }
      onUpdate();
      await loadDocuments();
      toast.success(isZh ? "上传完成" : "Upload complete");
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error(isZh ? "上传失败" : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (file: ProjectFile) => {
    try {
      await downloadProjectFile({
        fileId: file.id,
        fileName: file.name,
        projectId,
      });
    } catch (error) {
      console.error("Download failed:", error);
      toast.error(isZh ? "下载失败" : "Download failed");
    }
  };

  return (
    <div
      className="grid gap-6"
      style={{ gridTemplateColumns: "minmax(0, 1fr) 260px", alignItems: "start" }}
    >
      <div className="flex min-w-0 flex-col" style={{ gap: 16 }}>
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between" style={{ gap: 12 }}>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 500,
                color: "var(--color-codex-ink)",
                letterSpacing: "-0.015em",
              }}
            >
              {isZh ? `文档 · ${allDocumentCount} 份` : `Documents · ${allDocumentCount}`}
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
              }}
            >
              {isZh
                ? "上传后会自动加入项目记忆索引"
                : "Uploaded files are folded into project memory automatically"}
            </p>
          </div>
          <div className="flex" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={() => toast.info(isZh ? "从知识库链接即将上线" : "Knowledge link coming soon")}
              className="inline-flex items-center transition-colors"
              style={{
                gap: 5,
                padding: "6px 12px",
                fontSize: 12,
                color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 6px)",
                background: "transparent",
              }}
            >
              <LinkIcon className="h-3 w-3" />
              {isZh ? "从知识库链接" : "Link from knowledge"}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                gap: 5,
                padding: "6px 12px",
                fontSize: 12,
                background: "var(--color-codex-ink)",
                color: "var(--color-codex-bg-elev)",
                borderRadius: "var(--codex-r-sm, 6px)",
                border: "none",
              }}
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              {isZh ? "上传" : "Upload"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => void handleUpload(event.target.files)}
            />
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {(["all", "manual", "knowledge", "skill", "auto"] as const).map((key) => {
            const active = filter === key;
            const count = key === "all" ? allDocumentCount : sourceCounts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFilter(key);
                  setDocumentPage(1);
                }}
                className="inline-flex items-center transition-colors"
                style={{
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: "var(--codex-r-sm, 6px)",
                  background: active ? "var(--color-codex-ink)" : "transparent",
                  color: active
                    ? "var(--color-codex-bg-elev)"
                    : "var(--color-codex-ink-soft, var(--color-codex-ink))",
                  border: active
                    ? "1px solid var(--color-codex-ink)"
                    : "1px solid var(--color-codex-line)",
                  fontSize: 12,
                }}
              >
                {isZh ? FILTER_LABEL_ZH[key] : FILTER_LABEL_EN[key]}
                <span
                  style={{
                    fontFamily:
                      'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                    fontSize: 10.5,
                    opacity: 0.75,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Doc list */}
        <div>
          {documentTotal === 0 ? (
            <div
              style={{
                padding: "32px 8px",
                textAlign: "center",
                color: "var(--color-codex-ink-mute)",
                fontSize: 12.5,
                background: "var(--color-codex-bg-elev)",
                border: "1px dashed var(--color-codex-line-strong, var(--color-codex-line))",
                borderRadius: "var(--codex-r-md, 8px)",
              }}
            >
              {filter === "all"
                ? isZh
                  ? "暂无文档。点 + 上传 开始第一份。"
                  : "No documents. Upload one to get started."
                : isZh
                  ? "当前筛选下没有文档。"
                  : "No documents matching this filter."}
            </div>
          ) : (
            <>
              {files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => void handleDownload(file)}
                  className="grid w-full transition-colors hover:[background:var(--color-codex-bg-tint)]"
                  style={{
                    gridTemplateColumns: "50px 1fr 100px 90px 14px",
                    padding: "14px 8px",
                    gap: 14,
                    alignItems: "flex-start",
                    borderBottom: "1px solid var(--color-codex-line-soft)",
                    borderRadius: "var(--codex-r-sm, 6px)",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--color-codex-ink-mute)",
                      padding: "3px 8px",
                      border: "1px solid var(--color-codex-line)",
                      borderRadius: "var(--codex-r-sm, 6px)",
                      textAlign: "center",
                      letterSpacing: "0.04em",
                      justifySelf: "start",
                      fontFamily:
                        'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                    }}
                  >
                    {typeBadge(file)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 14,
                        color: "var(--color-codex-ink)",
                        fontWeight: 500,
                      }}
                    >
                      {file.name}
                    </div>
                    {file.summary ? (
                      <p
                        className="line-clamp-2"
                        style={{
                          margin: "3px 0 6px",
                          fontSize: 12.5,
                          color: "var(--color-codex-ink-soft, var(--color-codex-ink))",
                          lineHeight: 1.55,
                        }}
                      >
                        {file.summary}
                      </p>
                    ) : null}
                    <div
                      className="flex flex-wrap items-center"
                      style={{
                        gap: 8,
                        fontSize: 11,
                        color: "var(--color-codex-ink-mute)",
                        marginTop: file.summary ? 0 : 6,
                      }}
                    >
                      <span>
                        {isZh
                          ? FILTER_LABEL_ZH[originOf(file)]
                          : FILTER_LABEL_EN[originOf(file)]}
                      </span>
                      <span style={{ color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))" }}>·</span>
                      <span>{formatDateOnly(file.uploaded_at)}</span>
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily:
                        'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                      fontSize: 11.5,
                      color: "var(--color-codex-ink-mute)",
                    }}
                  >
                    {formatFileSize(file.size)}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))",
                    }}
                  >
                    {file.file_type || "—"}
                  </span>
                  <ArrowRight
                    className="h-3 w-3"
                    style={{ color: "var(--color-codex-ink-faint, var(--color-codex-ink-mute))" }}
                  />
                </button>
              ))}
              <CxPagination
                page={currentDocumentPage}
                pageSize={documentPageSize}
                totalItems={documentTotal}
                onPageChange={setDocumentPage}
                onPageSizeChange={(nextPageSize) => {
                  setDocumentPageSize(nextPageSize);
                  setDocumentPage(1);
                }}
                isZh={isZh}
                pageSizeOptions={[10, 20, 50]}
              />
            </>
          )}
        </div>
      </div>

      {/* Right rail */}
      <aside className="flex flex-col" style={{ gap: 16, position: "sticky", top: 76 }}>
        <CxPanel title={isZh ? "文档来源分布" : "Source distribution"}>
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.85,
              color: "var(--color-codex-ink)",
            }}
          >
            {(Object.keys(FILTER_LABEL_ZH) as FilterKey[])
              .filter((key) => key !== "all")
              .map((key) => (
                <div
                  key={key}
                  className="flex justify-between"
                  style={{ padding: "3px 0" }}
                >
                  <span style={{ color: "var(--color-codex-ink-mute)" }}>
                    {isZh ? FILTER_LABEL_ZH[key] : FILTER_LABEL_EN[key]}
                  </span>
                  <span
                    style={{
                      fontFamily:
                        'var(--codex-mono, "JetBrains Mono", ui-monospace, monospace)',
                    }}
                  >
                    {sourceCounts[key as Exclude<FilterKey, "all">]}
                  </span>
                </div>
              ))}
          </div>
        </CxPanel>

        <CxPanel title={isZh ? "最近上传" : "Recent uploads"}>
          {recentFiles.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--color-codex-ink-mute)",
                padding: "6px 0",
              }}
            >
              {isZh ? "暂无文档。" : "No documents yet."}
            </p>
          ) : (
            recentFiles.map((file, i, arr) => (
              <div
                key={file.id}
                className="flex"
                style={{
                  padding: "7px 0",
                  borderBottom:
                    i === arr.length - 1
                      ? "none"
                      : "1px solid var(--color-codex-line-soft)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="truncate"
                    style={{ fontSize: 12.5, color: "var(--color-codex-ink)" }}
                  >
                    {file.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-codex-ink-mute)",
                      marginTop: 2,
                    }}
                  >
                    {formatDateOnly(file.uploaded_at)} ·{" "}
                    {formatFileSize(file.size)}
                  </div>
                </div>
              </div>
            ))
          )}
        </CxPanel>
      </aside>
    </div>
  );
}
