import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  DollarSign,
  Download,
  Edit3,
  FileText,
  Files,
  Flag,
  Loader2,
  ListTodo,
  Plus,
  Sparkles,
  User,
} from "lucide-react";
import { api } from "../../api/client";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useToast } from "../../contexts/ToastContext";
import { resolveProjectStage } from "../../types/enums";
import type { ProjectDetail as ProjectDetailType, ProjectFile } from "../../types/api";

const formatAmount = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return "0";
  return amount.toLocaleString("zh-CN");
};

const formatAmountInTenThousand = (
  amount: number | undefined | null,
): string => {
  if (!amount || amount === 0) return "0";
  const tenThousand = amount / 10000;
  if (tenThousand < 1) {
    return formatAmount(amount);
  }
  const hasFraction = tenThousand % 1 !== 0;
  return hasFraction
    ? tenThousand.toLocaleString("zh-CN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : tenThousand.toLocaleString("zh-CN");
};

interface ProjectOverviewTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
  onProjectUpdate: () => void;
}

export function ProjectOverviewTab({
  projectDetail,
  projectId,
  onProjectUpdate: _onProjectUpdate,
}: ProjectOverviewTabProps) {
  const { project, milestones, files, financials, todos, md_notes } = projectDetail;
  const recentTodos = todos.filter((t) => !t.is_done).slice(0, 3);
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const toast = useToast();
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryText, setSummaryText] = useState(project.context_summary || "");
  const [summaryError, setSummaryError] = useState("");
  const [descExpanded, setDescExpanded] = useState(false);
  const [overviewNotesText, setOverviewNotesText] = useState((md_notes || "").trim());

  const firstMarkdownFile = useMemo(
    () =>
      [...files]
        .filter((file) => file.file_type?.toLowerCase() === "md")
        .sort(
          (a, b) =>
            new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime(),
        )[0] || null,
    [files],
  );

  useEffect(() => {
    let cancelled = false;

    const loadOverviewNotes = async () => {
      if (!firstMarkdownFile) {
        setOverviewNotesText((md_notes || "").trim());
        return;
      }

      try {
        const data = await api.get<{ content: string }>(
          `/projects/${projectId}/documents/${firstMarkdownFile.id}`,
        );
        if (!cancelled) {
          setOverviewNotesText((data.content || "").trim() || (md_notes || "").trim());
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load overview notes:", error);
          setOverviewNotesText((md_notes || "").trim());
        }
      }
    };

    void loadOverviewNotes();
    return () => {
      cancelled = true;
    };
  }, [firstMarkdownFile, md_notes, projectId]);

  const handleDownload = async (file: ProjectFile) => {
    try {
      const response = await api.get<Blob>(
        `/projects/${projectId}/files/${file.id}/download`,
        {
          responseType: "blob",
        },
      );

      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", file.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download file:", error);
      toast.error(isZh ? "下载失败" : "Download failed");
    }
  };

  const generateSummary = async () => {
    setGeneratingSummary(true);
    setSummaryText("");
    setSummaryError("");

    try {
      const token = localStorage.getItem("authToken") || "";
      const response = await fetch(`/api/projects/${projectId}/generate-context`, {
        method: "POST",
        headers: {
          "X-Auth-Token": token,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullSummary = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text" && data.content) {
                  fullSummary += data.content;
                  setSummaryText(fullSummary);
                } else if (data.type === "done") {
                  fullSummary = data.context_summary || fullSummary;
                  setSummaryText(fullSummary);
                }
              } catch {
                // Ignore malformed stream lines and keep the stream alive.
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to generate summary:", error);
      setSummaryError(
        isZh
          ? "生成摘要失败，请稍后重试"
          : "Failed to generate summary, please try again",
      );
    } finally {
      setGeneratingSummary(false);
    }
  };

  const recentMilestones = [...milestones]
    .sort(
      (a, b) =>
        new Date(b.due_date || "").getTime() -
        new Date(a.due_date || "").getTime(),
    )
    .slice(0, 3);

  const recentFiles = [...files]
    .sort(
      (a, b) =>
        new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime(),
    )
    .slice(0, 5);

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {isZh ? "项目信息" : "Project Info"}
            </h3>
            <button
              onClick={() =>
                navigate(`/projects/${projectId}/settings`, { state: { edit: true } })
              }
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
            >
              <Edit3 className="w-4 h-4" />
              {isZh ? "编辑" : "Edit"}
            </button>
          </div>
          <div className="space-y-3">
            {(() => {
              const stage = resolveProjectStage(project.status);
              const Icon = stage.icon;
              return (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">{isZh ? "阶段:" : "Stage:"}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${stage.bgColor} ${stage.color} ${stage.borderColor}`}
                  >
                    <Icon className="w-3 h-3" />
                    {stage.labelZh}
                  </span>
                </div>
              );
            })()}
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {isZh ? "客户: " : "Client: "}
                {project.client}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {isZh ? "创建于: " : "Created: "}
                {new Date(project.created_at).toLocaleDateString()}
              </span>
            </div>
            {(project.contract_amount ?? 0) > 0 && (
              <div className="flex items-center gap-3">
                <DollarSign className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {isZh ? "合同金额: " : "Contract: "}
                  ¥{formatAmountInTenThousand(project.contract_amount)}
                  {isZh ? "万" : "K"}
                </span>
              </div>
            )}
            {project.description && (
              <div className="pt-3 border-t border-gray-100">
                <button
                  onClick={() => setDescExpanded((value) => !value)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors w-full text-left mb-1"
                >
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${descExpanded ? "rotate-180" : ""}`}
                  />
                  {isZh ? "描述" : "Description"}
                </button>
                {descExpanded && (
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">
                    {project.description}
                  </p>
                )}
              </div>
            )}
            {project.notes && (
              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-1">
                  {isZh ? "备注" : "Notes"}
                </p>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">
                  {project.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        {(project.context_summary || summaryText) ? (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-gray-900">
                  {isZh ? "AI 项目摘要" : "AI Project Summary"}
                </h3>
              </div>
              <button
                onClick={generateSummary}
                disabled={generatingSummary}
                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
              >
                {generatingSummary ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {isZh ? "重新生成" : "Regenerate"}
              </button>
            </div>
            {summaryError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                <p className="text-sm text-red-600">{summaryError}</p>
              </div>
            )}
            {generatingSummary && !summaryText ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                {isZh ? "正在生成摘要..." : "Generating summary..."}
              </div>
            ) : (
              <div className="md-root">
                <MarkdownRenderer
                  content={(summaryText || project.context_summary || "")
                    .replace(/^[\u2022\u00b7\u25cf\u25aa\u25ab-]\s*/gm, "- ")
                    .replace(/\n(?!\n)/g, "\n\n")}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  {generatingSummary ? (
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {isZh ? "AI 项目摘要" : "AI Project Summary"}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {isZh
                      ? "基于项目文档、里程碑和财务状况生成智能总结"
                      : "Generate intelligent summary based on documents, milestones & financials"}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
                <button
                  onClick={generateSummary}
                  disabled={generatingSummary}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
                >
                  {generatingSummary ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {isZh ? "生成摘要" : "Generate"}
                </button>
              </div>
            </div>
          </div>
        )}

        {overviewNotesText.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-gray-400" />
                {isZh ? "项目笔记" : "Project Notes"}
              </h3>
              <button
                onClick={() => navigate(`/projects/${projectId}/notes`)}
                className="text-sm text-primary hover:underline"
              >
                {isZh ? "打开笔记" : "Open notes"}
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-600 line-clamp-4 whitespace-pre-wrap">
                {overviewNotesText
                  .replace(/[#*`\[\]()>-]/g, " ")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 180)}
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Flag className="w-4 h-4 text-gray-400" />
              {isZh ? "里程碑" : "Milestones"}
            </h3>
            <button
              onClick={() => navigate(`/projects/${projectId}/milestones`)}
              className="text-sm text-primary hover:underline"
            >
              {isZh ? "查看全部" : "View all"}
            </button>
          </div>
          <div className="p-5">
            {recentMilestones.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">{isZh ? "暂无里程碑" : "No milestones yet"}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentMilestones.map((milestone) => (
                  <div key={milestone.id} className="flex items-start gap-3">
                    {milestone.is_done ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-300 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p
                        className={`text-sm ${milestone.is_done ? "text-gray-400 line-through" : "text-gray-900"}`}
                      >
                        {milestone.title}
                      </p>
                      {milestone.due_date && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {isZh ? "截止: " : "Due: "}
                          {new Date(milestone.due_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        milestone.priority === "high"
                          ? "bg-red-50 text-red-600"
                          : milestone.priority === "medium"
                            ? "bg-amber-50 text-amber-600"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {milestone.priority}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Files className="w-4 h-4 text-gray-400" />
              {isZh ? "最近文档" : "Recent Documents"}
            </h3>
            <button
              onClick={() => navigate(`/projects/${projectId}/documents`)}
              className="text-sm text-primary hover:underline"
            >
              {isZh ? "查看全部" : "View all"}
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {recentFiles.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">{isZh ? "暂无文档" : "No documents yet"}</p>
              </div>
            ) : (
              recentFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {file.file_type.toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDownload(file);
                    }}
                    className="p-2 rounded-lg hover:bg-gray-200 text-gray-400"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="col-span-12 lg:col-span-4 space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-gray-400" />
            {isZh ? "财务状况" : "Financials"}
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">
                {isZh ? "合同金额" : "Contract"}
              </span>
              <span className="font-semibold text-gray-900">
                ¥{formatAmount(financials.contract_amount)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">
                {isZh ? "已收款" : "Received"}
              </span>
              <span className="font-semibold text-emerald-600">
                ¥{financials.total_received.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">
                {isZh ? "已开票" : "Invoiced"}
              </span>
              <span className="font-semibold text-blue-600">
                ¥{financials.total_invoiced.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">
                {isZh ? "支出" : "Expenses"}
              </span>
              <span className="font-semibold text-red-500">
                ¥{financials.total_expense.toLocaleString()}
              </span>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">
                {isZh ? "未收款" : "Outstanding"}
              </span>
              <span className="font-bold text-gray-900">
                ¥{financials.uncollected.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <ListTodo className="w-4 h-4 text-gray-400" />
              {isZh ? "最近待办" : "Recent Todos"}
            </h3>
            <button
              onClick={() => navigate(`/projects/${projectId}/todos`)}
              className="text-sm text-primary hover:underline"
            >
              {isZh ? "查看全部" : "View all"}
            </button>
          </div>
          <div className="p-5">
            {recentTodos.length === 0 ? (
              <div className="text-center py-4 text-gray-400">
                <p className="text-sm">{isZh ? "暂无待办事项" : "No pending todos"}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentTodos.map((todo) => (
                  <div key={todo.id} className="flex items-start gap-3">
                    <Circle className="w-5 h-5 text-gray-300 mt-0.5" />
                    <p className="text-sm text-gray-900 truncate">{todo.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">
            {isZh ? "快捷操作" : "Quick Actions"}
          </h3>
          <div className="space-y-2">
            <button
              onClick={() => navigate(`/projects/${projectId}/milestones`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Plus className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-gray-700">
                {isZh ? "添加里程碑" : "Add Milestone"}
              </span>
            </button>
            <button
              onClick={() => navigate(`/projects/${projectId}/documents`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Plus className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-gray-700">
                {isZh ? "上传文档" : "Upload Document"}
              </span>
            </button>
            <button
              onClick={() => navigate(`/projects/${projectId}/financials`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <Plus className="w-4 h-4 text-amber-600" />
              </div>
              <span className="text-sm font-medium text-gray-700">
                {isZh ? "记录收款" : "Record Payment"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
