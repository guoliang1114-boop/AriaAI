import { useEffect, useRef, useState, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useParams,
  useNavigate,
  NavLink,
  Routes,
  Route,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import {
  ArrowLeft,
  FolderKanban,
  CheckCircle2,
  Circle,
  FileText,
  DollarSign,
  Loader2,
  MessageSquare,
  Edit3,
  LayoutDashboard,
  Files,
  Flag,
  Settings,
  MoreVertical,
  Plus,
  Trash2,
  Calendar,
  AlertCircle,
  TrendingUp,
  Receipt,
  User,
  Link as LinkIcon,
  Download,
  ChevronRight,
  ChevronLeft,
  Send,
  Paperclip,
  Bot,
  Sparkles,
  Wand2,
  LayoutGrid,
  List,
  Search,
  Upload,
  Share2,
  X,
  ChevronUp,
  ChevronDown,
  Copy,
  BookOpen,
  ListTodo,
  Wrench,
} from "lucide-react";
import { api } from "../../api/client";
import { exportConversationFile } from "../../api/chatExport";
import { PageTitle } from "../../components/PageTitle";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useToast } from "../../contexts/ToastContext";
import { PROJECT_STAGE_CONFIGS, resolveProjectStage, toBackendStatus } from "../../types/enums";
import type {
  ProjectDetail as ProjectDetailType,
  Project,
  Milestone,
  ProjectFile,
  ProjectFolder,
  ProjectPayment,
} from "../../types/api";
import { ProjectNotesTab } from "./ProjectNotesTab";
import { ProjectTodosTab } from "./ProjectTodosTab";

// ==================== Helper Functions ====================
// Format number with thousand separators
const formatAmount = (amount: number | undefined | null): string => {
  if (!amount || amount === 0) return "0";
  return amount.toLocaleString("zh-CN");
};

// Format amount in "万" unit with thousand separators
const formatAmountInTenThousand = (
  amount: number | undefined | null,
): string => {
  if (!amount || amount === 0) return "0";
  const tenThousand = amount / 10000;
  // If less than 1万, show original number
  if (tenThousand < 1) {
    return formatAmount(amount);
  }
  // Show with decimal if has fraction, otherwise integer
  const hasFraction = tenThousand % 1 !== 0;
  return hasFraction
    ? tenThousand.toLocaleString("zh-CN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    : tenThousand.toLocaleString("zh-CN");
};

// ==================== Types ====================
type TabId =
  | "overview"
  | "documents"
  | "milestones"
  | "notes"
  | "todos"
  | "chat"
  | "financials"
  | "settings";

interface TabConfig {
  id: TabId;
  label: string;
  labelZh: string;
  icon: typeof LayoutDashboard;
  path: string;
  getPath: (projectId: string) => string;
}

// ==================== Navigation Tabs ====================
const TABS: TabConfig[] = [
  {
    id: "overview",
    label: "Overview",
    labelZh: "概览",
    icon: LayoutDashboard,
    path: "",
    getPath: (id) => `/projects/${id}`,
  },
  {
    id: "documents",
    label: "Documents",
    labelZh: "文档",
    icon: Files,
    path: "documents",
    getPath: (id) => `/projects/${id}/documents`,
  },
  {
    id: "milestones",
    label: "Milestones",
    labelZh: "里程碑",
    icon: Flag,
    path: "milestones",
    getPath: (id) => `/projects/${id}/milestones`,
  },
  {
    id: "notes",
    label: "Notes",
    labelZh: "笔记",
    icon: BookOpen,
    path: "notes",
    getPath: (id) => `/projects/${id}/notes`,
  },
  {
    id: "todos",
    label: "Todos",
    labelZh: "待办",
    icon: ListTodo,
    path: "todos",
    getPath: (id) => `/projects/${id}/todos`,
  },
  {
    id: "chat",
    label: "Project Chat",
    labelZh: "项目对话",
    icon: MessageSquare,
    path: "chat",
    getPath: (id) => `/projects/${id}/chat`,
  },
  {
    id: "financials",
    label: "Financials",
    labelZh: "财务",
    icon: DollarSign,
    path: "financials",
    getPath: (id) => `/projects/${id}/financials`,
  },
  {
    id: "settings",
    label: "Settings",
    labelZh: "设置",
    icon: Settings,
    path: "settings",
    getPath: (id) => `/projects/${id}/settings`,
  },
];

// ==================== Sub Components ====================

// Project Header Component - 简化为面包屑 + Tab 导航
function ProjectHeader({
  project,
  onBack,
  projectId,
}: {
  project: Project;
  onBack: () => void;
  projectId: string;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  return (
    <>
      {/* 顶部固定栏 - 面包屑 + 导航 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        {/* 面包屑 + 返回 */}
        <div className="max-w-full mx-auto px-6">
          <div className="flex items-center gap-3 py-2">
            <button
              onClick={onBack}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </button>
            <div className="h-5 w-px bg-gray-200" />
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <FolderKanban className="w-4 h-4" />
              <span>{isZh ? "项目空间" : "Projects"}</span>
              <ChevronRight className="w-4 h-4" />
              <span className="text-gray-900 font-medium truncate max-w-[200px]">
                {project.name}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-full mx-auto px-6 border-t border-gray-100">
          <div className="flex items-center gap-1">
            {TABS.map((tab) => (
              <NavLink
                key={tab.id}
                to={tab.getPath(projectId)}
                end={tab.path === ""}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`
                }
              >
                <tab.icon className="w-4 h-4" />
                {isZh ? tab.labelZh : tab.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// Edit Project Modal
interface AISuggestion {
  name: string;
  description: string;
}

function EditProjectModal({
  project,
  isOpen,
  onClose,
  onSave,
}: {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Project>) => void;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [form, setForm] = useState({
    name: project.name,
    client: project.client,
    description: project.description || "",
    status: project.status,
    contract_amount: project.contract_amount || 0,
    notes: project.notes || "",
  });
  const [saving, setSaving] = useState(false);

  // AI state
  const [isAILoading, setIsAILoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  };

  // AI suggest function
  const runAISuggest = async () => {
    setIsAILoading(true);
    setAiError(null);
    setShowSuggestions(false);

    try {
      const results = await api.post<AISuggestion[]>("/projects/ai-suggest", {
        query: form.description || form.name,
        client_name: form.client,
        client_industry: "",
      });

      if (results.length === 0) {
        setAiError(isZh ? "AI 未返回结果" : "AI returned no results");
      } else {
        // Show all suggestions
        setSuggestions(results);
        setShowSuggestions(true);
      }
    } catch (error) {
      console.error("AI suggest failed:", error);
      setAiError(isZh ? "AI 生成失败" : "AI generation failed");
    } finally {
      setIsAILoading(false);
    }
  };

  // AI polish description
  const runAIPolish = async () => {
    if (!form.description.trim()) {
      setAiError(isZh ? "请先输入描述" : "Please enter a description first");
      return;
    }

    setIsAILoading(true);
    setAiError(null);

    try {
      const prompt = `Polish and improve this project description to be more professional and comprehensive. Return only the improved description, no other text:

Original description: ${form.description}

Requirements:
- Make it more professional and specific
- Keep it to 2-3 sentences
- Focus on objectives, scope, and deliverables
- Use consulting-style language

Improved description:`;

      const response = await api.post<{ response: string }>(
        "/chat/completions",
        {
          messages: [{ role: "user", content: prompt }],
          stream: false,
        },
      );

      const improved = response.response?.trim();
      if (improved) {
        setForm((prev) => ({ ...prev, description: improved }));
      }
    } catch (error) {
      console.error("AI polish failed:", error);
      setAiError(isZh ? "AI 优化失败" : "AI polish failed");
    } finally {
      setIsAILoading(false);
    }
  };

  const applySuggestion = (suggestion: AISuggestion) => {
    setForm((prev) => ({
      ...prev,
      name: suggestion.name,
      description: suggestion.description,
    }));
    setShowSuggestions(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">
            {isZh ? "编辑项目" : "Edit Project"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "项目名称" : "Project Name"}
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              required
            />
          </div>

          {/* Client */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "客户" : "Client"}
            </label>
            <input
              type="text"
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              required
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "状态" : "Status"}
            </label>
            <select
              value={form.status}
              onChange={(e) =>
                setForm({
                  ...form,
                  status: e.target.value as Project["status"],
                })
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="lead">{isZh ? "商机" : "Lead"}</option>
              <option value="active">{isZh ? "进行中" : "Active"}</option>
              <option value="completed">{isZh ? "已完成" : "Completed"}</option>
              <option value="archived">{isZh ? "已归档" : "Archived"}</option>
            </select>
          </div>

          {/* Contract Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "合同金额 (元)" : "Contract Amount (CNY)"}
            </label>
            <input
              type="number"
              value={form.contract_amount}
              onChange={(e) =>
                setForm({
                  ...form,
                  contract_amount: parseFloat(e.target.value) || 0,
                })
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              min="0"
              step="0.01"
            />
          </div>

          {/* AI Assistant Section */}
          <div className="bg-gradient-to-r from-primary/5 to-purple-500/5 rounded-xl p-4 border border-primary/10">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-gray-700">
                {isZh ? "AI 助手" : "AI Assistant"}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runAISuggest}
                disabled={isAILoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isAILoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {isZh ? "重新生成" : "Regenerate"}
              </button>

              {form.description && (
                <button
                  type="button"
                  onClick={runAIPolish}
                  disabled={isAILoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-primary text-primary rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isZh ? "优化描述" : "Polish"}
                </button>
              )}
            </div>

            {/* Error message */}
            {aiError && (
              <div className="mt-2 text-amber-600 text-xs">⚠️ {aiError}</div>
            )}

            {/* Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-500">
                  {isZh
                    ? "AI 建议（点击应用）"
                    : "AI suggestions (click to apply)"}
                </p>
                {suggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applySuggestion(suggestion)}
                    className="w-full text-left p-3 bg-white rounded-lg border border-gray-200 hover:border-primary/50 hover:shadow-sm transition-all"
                  >
                    <p className="font-medium text-sm text-gray-900">
                      {suggestion.name}
                    </p>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {suggestion.description}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "描述" : "Description"}
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isZh ? "备注" : "Notes"}
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isZh ? "保存" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Overview Tab Content
function OverviewTab({
  projectDetail,
  projectId,
  onProjectUpdate,
}: {
  projectDetail: ProjectDetailType;
  projectId: string;
  onProjectUpdate: () => void;
}) {
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

  // Download file handler
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

  // Generate AI context summary
  const generateSummary = async () => {
    setGeneratingSummary(true);
    setSummaryText("");
    setSummaryError("");

    try {
      const token = localStorage.getItem("authToken") || "";
      const response = await fetch(
        `/api/projects/${projectId}/generate-context`,
        {
          method: "POST",
          headers: {
            "X-Auth-Token": token,
          },
        },
      );

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
                  // Don't refresh entire page, just update local state
                }
              } catch (e) {
                // Ignore parse errors for individual lines
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

  // Get recent milestones (upcoming or recent)
  const recentMilestones = [...milestones]
    .sort(
      (a, b) =>
        new Date(b.due_date || "").getTime() -
        new Date(a.due_date || "").getTime(),
    )
    .slice(0, 3);

  // Get recent files
  const recentFiles = [...files]
    .sort(
      (a, b) =>
        new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime(),
    )
    .slice(0, 5);

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left Column */}
      <div className="col-span-12 lg:col-span-8 space-y-6">
        {/* Project Info - Moved to top */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {isZh ? "项目信息" : "Project Info"}
            </h3>
            <button
              onClick={() => navigate(`/projects/${projectId}/settings`, { state: { edit: true } })}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-colors"
            >
              <Edit3 className="w-4 h-4" />
              {isZh ? "编辑" : "Edit"}
            </button>
          </div>
          <div className="space-y-3">
            {/* Status Badge */}
            {(() => {
              const stage = resolveProjectStage(project.status)
              const Icon = stage.icon
              return (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">{isZh ? "阶段:" : "Stage:"}</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${stage.bgColor} ${stage.color} ${stage.borderColor}`}>
                    <Icon className="w-3 h-3" />
                    {stage.labelZh}
                  </span>
                </div>
              )
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
                  {isZh ? "合同金额: " : "Contract: "}¥
                  {formatAmountInTenThousand(project.contract_amount)}
                  {isZh ? "万" : "K"}
                </span>
              </div>
            )}
            {/* Description */}
            {project.description && (
              <div className="pt-3 border-t border-gray-100">
                <button
                  onClick={() => setDescExpanded(v => !v)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors w-full text-left mb-1"
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${descExpanded ? 'rotate-180' : ''}`} />
                  {isZh ? "描述" : "Description"}
                </button>
                {descExpanded && (
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">
                    {project.description}
                  </p>
                )}
              </div>
            )}
            {/* Notes */}
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

        {/* AI Context Summary */}
        {(project.context_summary || summaryText) ? (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-gray-900">{isZh ? 'AI 项目摘要' : 'AI Project Summary'}</h3>
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
                {isZh ? '重新生成' : 'Regenerate'}
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
                {isZh ? '正在生成摘要...' : 'Generating summary...'}
              </div>
            ) : (
              <div className="md-root">
                <MarkdownRenderer content={
                  (summaryText || project.context_summary || '')
                    // Convert • bullets to markdown list items
                    .replace(/^[•·]\s*/gm, '- ')
                    // Ensure single newlines between lines become double (paragraph breaks)
                    .replace(/\n(?!\n)/g, '\n\n')
                } />
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
                  <h3 className="font-semibold text-gray-900">{isZh ? 'AI 项目摘要' : 'AI Project Summary'}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{isZh ? '基于项目文档、里程碑和财务状况生成智能总结' : 'Generate intelligent summary based on documents, milestones & financials'}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {summaryError && (
                  <p className="text-xs text-red-500">{summaryError}</p>
                )}
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
                  {isZh ? '生成摘要' : 'Generate'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recent Milestones */}
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
                <p className="text-sm">
                  {isZh ? "暂无里程碑" : "No milestones yet"}
                </p>
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

        {/* Recent Files */}
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
                <p className="text-sm">
                  {isZh ? "暂无文档" : "No documents yet"}
                </p>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(file);
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

        {/* Recent Todos */}
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
                <p className="text-sm">
                  {isZh ? "暂无待办事项" : "No pending todos"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentTodos.map((todo) => (
                  <div key={todo.id} className="flex items-start gap-3">
                    <Circle className="w-5 h-5 text-gray-300 mt-0.5" />
                    <p className="text-sm text-gray-900 truncate">
                      {todo.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Notes Preview */}
        {(md_notes || "").trim().length > 0 && (
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
                {md_notes.replace(/[#*`\[\]()>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)}
              </p>
            </div>
          </div>
        )}
      </div>
      {/* Right Column - Sidebar */}
      <div className="col-span-12 lg:col-span-4 space-y-6">
        {/* Financial Summary */}
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
      {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">{isZh ? '快捷操作' : 'Quick Actions'}</h3>
          <div className="space-y-2">
            <button 
              onClick={() => navigate(`/projects/${projectId}/milestones`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Plus className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-gray-700">{isZh ? '添加里程碑' : 'Add Milestone'}</span>
            </button>
            <button 
              onClick={() => navigate(`/projects/${projectId}/documents`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Plus className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-gray-700">{isZh ? '上传文档' : 'Upload Document'}</span>
            </button>
            <button 
              onClick={() => navigate(`/projects/${projectId}/financials`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <Plus className="w-4 h-4 text-amber-600" />
              </div>
              <span className="text-sm font-medium text-gray-700">{isZh ? '记录收款' : 'Record Payment'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Documents Tab Content - Google Drive Style
type DocFile = {
  id: number
  name: string
  file_type: string
  uploaded_at: string
  folder_id?: number | null
}

type DocFolder = {
  id: number
  name: string
}

function DocumentsTab({ projectDetail, projectId, onUpdate }: { projectDetail: ProjectDetailType; projectId: string; onUpdate: () => void }) {
  const { folders } = projectDetail
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: DocFile | DocFolder | null } | null>(null)
  // Use URL search params to persist folder state
  const currentFolder = searchParams.get('folder') // null = root
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Local state for files to avoid full page refresh on upload
  const [localFiles, setLocalFiles] = useState<ProjectFile[]>(projectDetail.files)
  // Track if we're in the middle of uploading to ignore parent updates
  const isUploadingRef = useRef(false)
  const prevFilesLengthRef = useRef(projectDetail.files.length)
  
  // Sync with parent data when projectDetail changes (but not during upload)
  useEffect(() => {
    // Only update if not uploading AND file count changed (avoid unnecessary updates)
    if (!isUploadingRef.current && projectDetail.files.length !== prevFilesLengthRef.current) {
      prevFilesLengthRef.current = projectDetail.files.length
      setLocalFiles(projectDetail.files)
    }
  }, [projectDetail.files.length])
  const [uploadProgress, setUploadProgress] = useState<{ name: string; progress: number; status: 'uploading' | 'done' | 'error' }[]>([])
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const newMenuRef = useRef<HTMLDivElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  
  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<{ id: number; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  
  // Download file handler
  const handleDownload = async (file: ProjectFile) => {
    try {
      const response = await api.get<Blob>(`/projects/${projectId}/files/${file.id}/download`, {
        responseType: 'blob'
      })
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', file.name)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download file:', error)
      toast.error(isZh ? '下载失败' : 'Download failed')
    }
  }
  
  // Delete file handler
  const handleDeleteFile = (fileId: number, fileName: string) => {
    setFileToDelete({ id: fileId, name: fileName })
    setShowDeleteModal(true)
  }
  
  const confirmDelete = async () => {
    if (!fileToDelete) return
    
    setDeleting(true)
    try {
      await api.delete(`/projects/${projectId}/files/${fileToDelete.id}`)
      // Remove from local state
      setLocalFiles(prev => prev.filter(f => f.id !== fileToDelete.id))
      setShowDeleteModal(false)
      setFileToDelete(null)
    } catch (error) {
      console.error('Failed to delete file:', error)
      toast.error(isZh ? '删除失败' : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  // Get file's folder name from folder_id
  const getFileFolderName = (folderId: number | null | undefined): string | null => {
    if (!folderId) return null
    const folder = folders.find(f => f.id === folderId)
    return folder?.name || null
  }

  // Navigate into a folder
  const enterFolder = (folderName: string) => {
    setSearchParams({ folder: folderName })
    setSearchQuery('') // Clear search when entering folder
  }

  // Navigate to root
  const goToRoot = () => {
    setSearchParams({})
    setSearchQuery('')
  }

  // Filter folders by current location and search
  const filteredFolders = folders.filter(f => {
    // In root: show all folders (as there's no nested folder support yet)
    if (currentFolder !== null) return false // Don't show folders inside folders for now
    return f.name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  // Filter files by current folder and search
  const filteredFiles = localFiles.filter(f => {
    const fileFolderName = getFileFolderName(f.folder_id)
    // fileFolderName is null for root files, currentFolder is null when in root
    const inCurrentFolder = fileFolderName === currentFolder
    const matchesSearch = f.name.toLowerCase().includes(searchQuery.toLowerCase())
    return inCurrentFolder && matchesSearch
  })

  // Get file icon by type
  const getFileIcon = (fileType: string) => {
    const type = fileType.toLowerCase()
    if (type.includes('pdf')) return <FileText className="w-6 h-6 text-red-500" />
    if (type.includes('doc') || type.includes('word')) return <FileText className="w-6 h-6 text-blue-500" />
    if (type.includes('xls') || type.includes('sheet') || type.includes('csv')) return <FileText className="w-6 h-6 text-green-500" />
    if (type.includes('ppt') || type.includes('presentation')) return <FileText className="w-6 h-6 text-orange-500" />
    if (type.includes('image') || type.includes('jpg') || type.includes('png')) return <FileText className="w-6 h-6 text-purple-500" />
    return <FileText className="w-6 h-6 text-gray-500" />
  }

  // Handle right click
  const handleContextMenu = (e: React.MouseEvent, item: DocFile | DocFolder) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  // Close context menu and new menu on click elsewhere
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      setContextMenu(null)
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length > 0) {
      await uploadFiles(droppedFiles)
    }
  }

  const uploadFiles = async (filesToUpload: File[]) => {
    // Set ref BEFORE setState to prevent useEffect from running during upload
    isUploadingRef.current = true
    setUploading(true)
    setShowUploadPanel(true)
    
    // Initialize progress for all files
    setUploadProgress(filesToUpload.map(f => ({ name: f.name, progress: 0, status: 'uploading' })))
    
    try {
      // Find folder_id if we're in a folder
      let folderId: number | null = null
      if (currentFolder) {
        const folder = folders.find(f => f.name === currentFolder)
        if (folder) {
          folderId = folder.id
        }
      }
      
      // Upload files concurrently with individual progress tracking
      const uploadPromises = filesToUpload.map(async (file, index) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('file_type', file.name.split('.').pop() || 'unknown')
        formData.append('size', file.size.toString())
        if (folderId) {
          formData.append('folder_id', folderId.toString())
        }
        
        try {
          await api.post(`/projects/${projectId}/files`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total)
                setUploadProgress(prev => prev.map((p, i) => 
                  i === index ? { ...p, progress } : p
                ))
              }
            }
          })
          
          // Mark as done
          setUploadProgress(prev => prev.map((p, i) => 
            i === index ? { ...p, progress: 100, status: 'done' } : p
          ))
        } catch (error) {
          setUploadProgress(prev => prev.map((p, i) => 
            i === index ? { ...p, status: 'error' } : p
          ))
          throw error
        }
      })
      
      await Promise.all(uploadPromises)
      
      // Fetch only files data instead of full project refresh
      try {
        const updatedDetail = await api.get<ProjectDetailType>(`/projects/${projectId}/detail`)
        setLocalFiles(updatedDetail.files)
      } catch (e) {
        console.error('Failed to refresh files:', e)
      }
      
      // Hide panel after 2 seconds when all done
      setTimeout(() => {
        setShowUploadPanel(false)
        setUploadProgress([])
      }, 2000)
      
    } catch (error) {
      console.error('Failed to upload files:', error)
      toast.error(isZh ? '上传失败' : 'Upload failed')
    } finally {
      setUploading(false)
      isUploadingRef.current = false
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length > 0) {
      await uploadFiles(selectedFiles)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return
    
    setCreatingFolder(true)
    try {
      await api.post(`/projects/${projectId}/folders`, { name: folderName.trim() })
      setShowFolderModal(false)
      setFolderName('')
      onUpdate()
    } catch (err) {
      console.error('Failed to create folder:', err)
      toast.error(isZh ? '创建文件夹失败' : 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  // Focus input when modal opens
  useEffect(() => {
    if (showFolderModal && folderInputRef.current) {
      setTimeout(() => folderInputRef.current?.focus(), 100)
    }
  }, [showFolderModal])

  // Empty state
  const isEmpty = filteredFolders.length === 0 && filteredFiles.length === 0

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm">
          <button
            onClick={goToRoot}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
              currentFolder === null
                ? "text-gray-900 font-medium"
                : "hover:bg-gray-100 text-gray-600"
            }`}
          >
            <FolderKanban className="w-4 h-4" />
            {isZh ? "所有文件" : "All Files"}
          </button>
          {currentFolder && (
            <>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <span className="px-3 py-1.5 text-gray-900 font-medium">
                {currentFolder}
              </span>
            </>
          )}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={isZh ? "搜索文件..." : "Search files..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-48 sm:w-64"
            />
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {/* New Button with Dropdown */}
          <div className="relative" ref={newMenuRef}>
            <button
              onClick={() => setShowNewMenu(!showNewMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
              {isZh ? "新建" : "New"}
            </button>

            {showNewMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50">
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {isZh ? "上传文件" : "Upload File"}
                </button>
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setShowFolderModal(true);
                  }}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <FolderKanban className="w-4 h-4" />
                  {isZh ? "新建文件夹" : "New Folder"}
                </button>
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>
      {/* Content Area with Drag Overlay */}
      <div
        className="flex-1 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag Overlay - only show when dragging, not when uploading */}
        {isDragging && !uploading && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center z-20">
            <Upload className="w-12 h-12 text-primary mb-3" />
            <p className="text-primary font-medium">
              {isZh ? "释放以上传文件" : "Drop files to upload"}
            </p>
          </div>
        )}

        {isEmpty ? (
          <div className="h-full flex flex-col items-center bg-white rounded-xl border border-dashed border-gray-200 pt-16">
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
              <Upload className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium mb-2">
              {currentFolder
                ? isZh
                  ? "此文件夹为空"
                  : "This folder is empty"
                : isZh
                  ? "将文件拖放到此处"
                  : "Drop files here"}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              {currentFolder
                ? isZh
                  ? "点击右上角新建按钮添加文件"
                  : "Click the New button to add files"
                : isZh
                  ? "或点击右上角新建按钮"
                  : "Or click the New button above"}
            </p>
            {currentFolder && (
              <button
                onClick={goToRoot}
                className="text-sm text-primary hover:underline mb-12"
              >
                ← {isZh ? "返回上级" : "Go back"}
              </button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          /* Grid View */
          <div className="flex-1 overflow-auto">
            {/* Folders Section */}
            {filteredFolders.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-500 mb-3 px-1">
                  {isZh ? "文件夹" : "Folders"}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {filteredFolders.map((folder) => (
                    <div
                      key={folder.id}
                      onClick={() => enterFolder(folder.name)}
                      onContextMenu={(e) => handleContextMenu(e, folder)}
                      className="group bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer"
                    >
                      <div className="flex flex-col items-center text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                          <FolderKanban className="w-7 h-7 text-blue-500" />
                        </div>
                        <h4 className="font-medium text-gray-900 text-sm truncate w-full">
                          {folder.name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1">
                          {isZh ? "文件夹" : "Folder"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Files Section */}
            {filteredFiles.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3 px-1">
                  {isZh ? "文件" : "Files"}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {filteredFiles.map((file) => (
                    <div
                      key={file.id}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                      className="group bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer relative"
                    >
                      {/* Delete button - top right */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(file.id, file.name);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="flex flex-col items-center text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                          {getFileIcon(file.file_type)}
                        </div>
                        <h4
                          className="font-medium text-gray-900 text-sm truncate w-full"
                          title={file.name}
                        >
                          {file.name}
                        </h4>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(file.uploaded_at).toLocaleString(
                            isZh ? "zh-CN" : "en-GB",
                            { hour12: false },
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* List View */
          <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">
                    {isZh ? "名称" : "Name"}
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-32">
                    {isZh ? "类型" : "Type"}
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-52">
                    {isZh ? "修改日期" : "Modified"}
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase px-4 py-3 w-20">
                    {isZh ? "操作" : "Action"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* Folders */}
                {filteredFolders.map((folder) => (
                  <tr
                    key={folder.id}
                    onClick={() => enterFolder(folder.name)}
                    onContextMenu={(e) => handleContextMenu(e, folder)}
                    className="hover:bg-gray-50 cursor-pointer group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                          <FolderKanban className="w-5 h-5 text-blue-500" />
                        </div>
                        <span className="font-medium text-gray-900 text-sm">
                          {folder.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {isZh ? "文件夹" : "Folder"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">-</td>
                    <td className="px-4 py-3 text-right">
                      <button className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {/* Files */}
                {filteredFiles.map((file) => (
                  <tr
                    key={file.id}
                    onContextMenu={(e) => handleContextMenu(e, file)}
                    className="hover:bg-gray-50 cursor-pointer group"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                          {getFileIcon(file.file_type)}
                        </div>
                        <span className="font-medium text-gray-900 text-sm">
                          {file.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 uppercase">
                      {file.file_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {new Date(file.uploaded_at).toLocaleString(
                        isZh ? "zh-CN" : "en-GB",
                        { hour12: false },
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file);
                          }}
                          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFile(file.id, file.name);
                          }}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>{" "}
      {/* Close Content Area */}
      {/* Context Menu */}
      {contextMenu && contextMenu.item && (
        <div
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {/* File-specific actions */}
          {"file_type" in contextMenu.item && (
            <>
              <button
                onClick={() => {
                  handleDownload(contextMenu.item as ProjectFile);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {isZh ? "下载" : "Download"}
              </button>
              <button
                onClick={() => setContextMenu(null)}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Edit3 className="w-4 h-4" />
                {isZh ? "重命名" : "Rename"}
              </button>
              <button
                onClick={() => setContextMenu(null)}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" />
                {isZh ? "分享" : "Share"}
              </button>
              <div className="h-px bg-gray-100 my-1" />
              <button
                onClick={() => {
                  handleDeleteFile(
                    contextMenu.item!.id,
                    contextMenu.item!.name,
                  );
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {isZh ? "删除" : "Delete"}
              </button>
            </>
          )}

          {/* Folder-specific actions */}
          {!("file_type" in contextMenu.item) && (
            <>
              <button
                onClick={() => {
                  enterFolder(contextMenu.item!.name);
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <FolderKanban className="w-4 h-4" />
                {isZh ? "打开" : "Open"}
              </button>
              <button
                onClick={() => setContextMenu(null)}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Edit3 className="w-4 h-4" />
                {isZh ? "重命名" : "Rename"}
              </button>
            </>
          )}
        </div>
      )}
      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {isZh ? "新建文件夹" : "New Folder"}
              </h3>
              <button
                onClick={() => {
                  setShowFolderModal(false);
                  setFolderName("");
                }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {isZh ? "文件夹名称" : "Folder name"}
              </label>
              <input
                ref={folderInputRef}
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && folderName.trim()) {
                    handleCreateFolder();
                  }
                  if (e.key === "Escape") {
                    setShowFolderModal(false);
                    setFolderName("");
                  }
                }}
                placeholder={isZh ? "请输入文件夹名称" : "Enter folder name"}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowFolderModal(false);
                  setFolderName("");
                }}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!folderName.trim() || creatingFolder}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {creatingFolder && <Loader2 className="w-4 h-4 animate-spin" />}
                {isZh ? "创建" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {showDeleteModal && fileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4 p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {isZh ? "删除文件" : "Delete File"}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {isZh ? "此操作不可撤销" : "This action cannot be undone"}
                </p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700 truncate">
                <span className="text-gray-500">
                  {isZh ? "文件: " : "File: "}
                </span>
                <span className="font-medium">{fileToDelete.name}</span>
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setFileToDelete(null);
                }}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isZh ? "删除" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Upload Progress Panel */}
      {showUploadPanel && uploadProgress.length > 0 && (
        <div className="fixed bottom-6 right-6 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h4 className="font-medium text-gray-900 text-sm">
              {isZh ? "上传文件" : "Uploading Files"}
            </h4>
            <button
              onClick={() => {
                setShowUploadPanel(false);
                setUploadProgress([]);
              }}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {uploadProgress.map((file, index) => (
              <div
                key={index}
                className="px-4 py-3 border-b border-gray-50 last:border-0"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-700 truncate flex-1 mr-2">
                    {file.name}
                  </span>
                  {file.status === "done" && (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  )}
                  {file.status === "error" && (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  )}
                  {file.status === "uploading" && (
                    <span className="text-xs text-gray-500">
                      {file.progress}%
                    </span>
                  )}
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      file.status === "error"
                        ? "bg-red-500"
                        : file.status === "done"
                          ? "bg-green-500"
                          : "bg-primary"
                    }`}
                    style={{ width: `${file.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Milestones Tab Content
function MilestonesTab({
  projectDetail,
  projectId,
  onUpdate,
}: {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}) {
  const { milestones } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();

  const [showModal, setShowModal] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(
    null,
  );
  const [formData, setFormData] = useState({
    title: "",
    due_date: "",
    priority: "medium" as "low" | "medium" | "high",
    is_done: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const completedCount = milestones.filter((m) => m.is_done).length;
  const progress =
    milestones.length > 0 ? (completedCount / milestones.length) * 100 : 0;

  const handleAdd = () => {
    setEditingMilestone(null);
    setFormData({
      title: "",
      due_date: "",
      priority: "medium",
      is_done: false,
    });
    setShowModal(true);
  };

  const handleEdit = (milestone: Milestone) => {
    setEditingMilestone(milestone);
    setFormData({
      title: milestone.title,
      due_date: milestone.due_date || "",
      priority: milestone.priority,
      is_done: milestone.is_done,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.warning(isZh ? "请输入里程碑名称" : "Please enter milestone title");
      return;
    }

    setIsSaving(true);
    try {
      if (editingMilestone) {
        await api.patch(
          `/projects/${projectId}/milestones/${editingMilestone.id}`,
          formData,
        );
      } else {
        await api.post(`/projects/${projectId}/milestones`, formData);
      }
      // Refresh data and close modal
      await onUpdate();
      setShowModal(false);
    } catch (error: any) {
      console.error("Failed to save milestone:", error);
      const errorMsg = error?.response?.data?.detail || error?.message || "";
      toast.error(isZh ? `保存失败: ${errorMsg}` : `Failed to save: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDone = async (milestone: Milestone) => {
    try {
      await api.patch(`/projects/${projectId}/milestones/${milestone.id}`, {
        is_done: !milestone.is_done,
      });
      await onUpdate();
    } catch (error: any) {
      console.error("Failed to toggle milestone:", error);
      const errorMsg = error?.response?.data?.detail || error?.message || "";
      toast.error(isZh ? `更新失败: ${errorMsg}` : `Failed to update: ${errorMsg}`);
    }
  };

  const handleDelete = async (milestone: Milestone) => {
    if (
      !confirm(
        isZh
          ? "确定要删除这个里程碑吗？"
          : "Are you sure you want to delete this milestone?",
      )
    )
      return;
    try {
      await api.delete(`/projects/${projectId}/milestones/${milestone.id}`);
      await onUpdate();
    } catch (error: any) {
      console.error("Failed to delete milestone:", error);
      const errorMsg = error?.response?.data?.detail || error?.message || "";
      toast.error(isZh ? `删除失败: ${errorMsg}` : `Failed to delete: ${errorMsg}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">
              {isZh ? "项目进度" : "Project Progress"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {completedCount} {isZh ? "已完成，共" : "completed of"}{" "}
              {milestones.length} {isZh ? "个里程碑" : "milestones"}
            </p>
          </div>
          <span className="text-2xl font-bold text-gray-900">
            {progress.toFixed(0)}%
          </span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Milestones List */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {isZh ? "里程碑列表" : "Milestones"}
          </h3>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            {isZh ? "添加" : "Add"}
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {milestones.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Flag className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{isZh ? "暂无里程碑" : "No milestones yet"}</p>
            </div>
          ) : (
            milestones.map((milestone, index) => (
              <div
                key={milestone.id}
                className="flex items-start gap-4 p-5 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => handleToggleDone(milestone)}
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      milestone.is_done
                        ? "bg-emerald-500 border-emerald-500"
                        : "border-gray-300 hover:border-primary"
                    }`}
                  >
                    {milestone.is_done && (
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    )}
                  </button>
                  {index < milestones.length - 1 && (
                    <div className="w-0.5 h-full bg-gray-200 my-2" />
                  )}
                </div>
                <div className="flex-1 pb-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4
                        className={`font-medium ${milestone.is_done ? "text-gray-400 line-through" : "text-gray-900"}`}
                      >
                        {milestone.title}
                      </h4>
                      {milestone.due_date && (
                        <div className="flex items-center gap-2 mt-2">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          <span
                            className={`text-xs ${
                              !milestone.is_done &&
                              new Date(milestone.due_date) < new Date()
                                ? "text-red-500"
                                : "text-gray-500"
                            }`}
                          >
                            {isZh ? "截止: " : "Due: "}
                            {new Date(milestone.due_date).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                          milestone.priority === "high"
                            ? "bg-red-50 text-red-600"
                            : milestone.priority === "medium"
                              ? "bg-amber-50 text-amber-600"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {milestone.priority}
                      </span>
                      <button
                        onClick={() => handleEdit(milestone)}
                        className="p-2 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-primary"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(milestone)}
                        className="p-2 rounded-lg hover:bg-red-100 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Milestone Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingMilestone
                  ? isZh
                    ? "编辑里程碑"
                    : "Edit Milestone"
                  : isZh
                    ? "添加里程碑"
                    : "Add Milestone"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? "里程碑名称" : "Title"}
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder={
                    isZh ? "请输入里程碑名称" : "Enter milestone title"
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? "截止日期" : "Due Date"}
                </label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      due_date: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZh ? "优先级" : "Priority"}
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      priority: e.target.value as "low" | "medium" | "high",
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="low">{isZh ? "低" : "Low"}</option>
                  <option value="medium">{isZh ? "中" : "Medium"}</option>
                  <option value="high">{isZh ? "高" : "High"}</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_done"
                  checked={formData.is_done}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      is_done: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                />
                <label htmlFor="is_done" className="text-sm text-gray-700">
                  {isZh ? "已完成" : "Completed"}
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 border-t border-gray-100">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isZh ? "保存" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Chat Tab Content - Multi-topic conversations
interface Conversation {
  id: number;
  title: string;
  project_id: number | null;
  skill_id: number | null;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const QUICK_PROMPTS = [
  {
    key: "summary",
    icon: FileText,
    labelZh: "总结项目",
    labelEn: "Summarize Project",
  },
  {
    key: "milestones",
    icon: Flag,
    labelZh: "分析里程碑",
    labelEn: "Analyze Milestones",
  },
  {
    key: "risks",
    icon: AlertCircle,
    labelZh: "风险识别",
    labelEn: "Identify Risks",
  },
  {
    key: "documents",
    icon: FolderKanban,
    labelZh: "文档问答",
    labelEn: "Document Q&A",
  },
];

// ==================== Chat Message Components ====================
// MBA-style messaging — aligned with main Chat.tsx design
// Defined outside ChatTab to keep stable identity across renders — prevents unmount/remount flicker.

// Export dropdown for conversation
const ExportDropdown = memo<{ conversationId: number; conversationTitle?: string }>(
  ({ conversationId, conversationTitle }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      };
      if (isOpen) document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);
    
    const handleExport = async (format: "markdown" | "pdf") => {
      setIsExporting(true);
      try {
        await exportConversationFile(conversationId, format, conversationTitle || "conversation");
        setIsOpen(false);
      } catch (err) {
        console.error("Export failed:", err);
        alert(t('chat.exportFailed'));
      } finally {
        setIsExporting(false);
      }
    };
    
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          {isExporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">{t('chat.export')}</span>
          <ChevronDown className="w-3 h-3" />
        </button>
        
        {isOpen && (
          <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
            <button
              onClick={() => handleExport("markdown")}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <FileText className="w-4 h-4 text-gray-400" />
              {t('chat.exportMarkdown')}
            </button>
            <button
              onClick={() => handleExport("pdf")}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <FileText className="w-4 h-4 text-red-400" />
              {t('chat.exportPDF')}
            </button>
          </div>
        )}
      </div>
    );
  }
);
ExportDropdown.displayName = "ExportDropdown";

// Copy button for assistant messages
const MessageCopyButton = memo(({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
      title="复制内容"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
});
MessageCopyButton.displayName = "MessageCopyButton";

const ChatMessageBubble = memo<{ msg: ChatMessage }>(
  ({ msg }) => {
    const { t } = useTranslation();
    const isUser = msg.role === "user";
    
    // Parse references from metadata if any
    let references: Array<{ type: string; id: number; title: string }> = [];
    try {
      const meta = JSON.parse((msg as any).metadata_json || '{}');
      references = meta.references || [];
    } catch (_) {}

    return (
      <div className={`flex items-start gap-3.5 group ${isUser ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
          isUser
            ? 'bg-gray-200'
            : 'bg-gradient-to-br from-primary to-indigo-500 shadow-sm shadow-primary/20'
        }`}>
          {isUser ? (
            <span className="text-[10px] font-semibold text-gray-500">{t('chat.you', '你')}</span>
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-white" />
          )}
        </div>

        {/* Content + actions */}
        <div className={`flex-1 flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          {/* Role label */}
          <p className="text-[11px] font-medium text-gray-400 mb-1.5 px-0.5">
            {isUser ? t('chat.you', '你') : 'Aria'}
          </p>

          {/* Message bubble */}
          <div className={`max-w-[85%] ${
            isUser
              ? 'px-4 py-2.5 bg-gray-900 text-white rounded-2xl rounded-tr-sm text-[15px] leading-[1.7]'
              : 'text-[15px] leading-[1.8] text-gray-700'
          }`}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            ) : (
              <div className="md-root">
                <MarkdownRenderer content={msg.content} />
              </div>
            )}
          </div>

          {/* References — for AI messages */}
          {!isUser && references.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {references.map((ref, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-[11px] text-gray-500 border border-gray-200">
                  {ref.type === 'skill' && <Wrench className="w-3 h-3" />}
                  {ref.type === 'doc' && <BookOpen className="w-3 h-3" />}
                  {ref.type === 'file' && <FileText className="w-3 h-3" />}
                  {ref.title}
                </span>
              ))}
            </div>
          )}

          {/* Timestamp + copy — visible on hover */}
          <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 ${isUser ? 'flex-row-reverse' : ''}`}>
            <span className="text-[11px] text-gray-300 px-0.5">
              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {!isUser && <MessageCopyButton text={msg.content} />}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.msg.id === next.msg.id && prev.msg.content === next.msg.content,
);
ChatMessageBubble.displayName = "ChatMessageBubble";

const ChatStreamingMessage = memo<{ content: string }>(({ content }) => {
  const { t } = useTranslation();
  const renderedContent = useMemo(
    () => <MarkdownRenderer content={content} />,
    [content],
  );
  return (
    <div className="flex items-start gap-3.5">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-gradient-to-br from-primary to-indigo-500 shadow-sm shadow-primary/20">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-start">
        {/* Role label */}
        <p className="text-[11px] font-medium text-gray-400 mb-1.5 px-0.5">Aria</p>

        {/* Message content — MBA style: no bubble, just text */}
        <div className="max-w-[85%] text-[15px] leading-[1.8] text-gray-700">
          <div className="md-root">
            {renderedContent}
            <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
});
ChatStreamingMessage.displayName = "ChatStreamingMessage";

function ChatTab({ project }: { project: Project }) {
  // DEBUG_VERSION: 2024-04-11-v2
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");

  // Conversations state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [streamingContent, setStreamingContent] = useState("");

  // UI state
  const [editingConvId, setEditingConvId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const skipNextFetchRef = useRef(false); // Skip fetch after creating new conversation
  const isNearBottomRef = useRef(true);

  // Fetch conversations
  useEffect(() => {
    fetchConversations();
  }, [project.id]);

  // Fetch messages when active conversation changes
  useEffect(() => {
    if (activeConvId) {
      // Skip fetching if we just created this conversation (messages already in local state via optimistic update)
      if (skipNextFetchRef.current) {
        skipNextFetchRef.current = false;
        return;
      }
      setMessages([]); // clear immediately so old messages don't flash
      setStreamingContent("");
      fetchMessages(activeConvId);
    } else {
      setMessages([]);
      setStreamingContent("");
    }
  }, [activeConvId]);

  // Track whether user is near the bottom
  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = (smooth = true) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // Scroll when new complete messages arrive (smooth)
  useEffect(() => {
    if (messages.length > 0 && isNearBottomRef.current) {
      scrollToBottom(true);
    }
  }, [messages]);

  // Scroll while streaming (instant, to keep up with content)
  useEffect(() => {
    if (streamingContent && isNearBottomRef.current) {
      scrollToBottom(false);
    }
  }, [streamingContent]);

  const fetchConversations = async () => {
    setIsLoadingConversations(true);
    try {
      const data = await api.get<Conversation[]>(
        `/chat/conversations?project_id=${project.id}`,
      );
      setConversations(data);
      if (data.length > 0 && !activeConvId) {
        setActiveConvId(data[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const fetchMessages = async (convId: number) => {
    setIsLoadingMessages(true);
    try {
      const data = await api.get<ChatMessage[]>(
        `/chat/conversations/${convId}/messages`,
      );
      setMessages(data);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const createConversation = async (firstMessage?: string) => {
    try {
      const cleanContent = firstMessage
        ? firstMessage.replace(/[#*`\[\]]/g, "").trim()
        : "";
      const title = cleanContent
        ? cleanContent.slice(0, 15) + (cleanContent.length > 15 ? "..." : "")
        : isZh
          ? "新对话"
          : "New Chat";
      
      console.log("[CreateConversation] Creating with title:", title, "from message:", firstMessage?.slice(0, 30));
      
      const newConv = await api.post<Conversation>("/chat/conversations", {
        project_id: project.id,
        title: title,
      });
      
      console.log("[CreateConversation] Created:", newConv.id, "title:", newConv.title);
      
      // Update conversations list with the new conversation
      setConversations((prev) => [newConv, ...prev]);
      skipNextFetchRef.current = true;
      setActiveConvId(newConv.id);
      
      return newConv.id;
    } catch (error) {
      console.error("Failed to create conversation:", error);
      return null;
    }
  };

  const deleteConversation = async (convId: number) => {
    if (
      !confirm(
        isZh
          ? "确定要删除这个对话吗？"
          : "Are you sure you want to delete this conversation?",
      )
    )
      return;
    try {
      await api.delete(`/chat/conversations/${convId}`);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const renameConversation = async (convId: number, newTitle: string) => {
    try {
      await api.patch(`/chat/conversations/${convId}`, { title: newTitle });
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, title: newTitle } : c)),
      );
      setEditingConvId(null);
    } catch (error) {
      console.error("Failed to rename conversation:", error);
    }
  };

  // Auto-generate title from first message (first 15 chars)
  const generateTitle = (content: string): string => {
    if (!content) return isZh ? "新对话" : "New Chat";
    // Remove markdown and extra spaces, take first 15 chars
    const clean = content.replace(/[#*`\[\]]/g, "").trim();
    const title = clean.slice(0, 15);
    return title + (clean.length > 15 ? "..." : "");
  };

  // Check if conversation has default title and auto-rename
  const maybeAutoRenameConversation = async (convId: number, firstMessage: string) => {
    // Find conversation in current state (may be newly created)
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) {
      console.log("[AutoRename] Conversation not found in state:", convId);
      return;
    }
    
    const defaultTitles = ["新对话", "New Chat"];
    console.log("[AutoRename] Checking conversation:", conv.title, "Message:", firstMessage.slice(0, 20));
    
    if (defaultTitles.includes(conv.title)) {
      const newTitle = generateTitle(firstMessage);
      console.log("[AutoRename] Renaming from", conv.title, "to", newTitle);
      if (newTitle !== conv.title) {
        await renameConversation(convId, newTitle);
      }
    } else {
      console.log("[AutoRename] Skipping, title is not default:", conv.title);
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;
    
    console.log("[SendMessage] Starting, activeConvId:", activeConvId, "content:", content.slice(0, 30));

    let convId: number | null = activeConvId;
    let isNewConv = false;

    // Immediately update UI to show user message (optimistic update)
    setInputValue("");
    setIsLoading(true);
    setStreamingContent("");

    // Create new conversation if none selected
    if (!convId) {
      isNewConv = true;
      console.log("[SendMessage] Creating new conversation");
      const newConvId = await createConversation(content);
      console.log("[SendMessage] New convId:", newConvId);
      if (!newConvId) {
        setIsLoading(false);
        return;
      }
      convId = newConvId;
    }

    // Add user message to local state immediately
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      conversation_id: convId,
      role: "user",
      content: content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    isNearBottomRef.current = true; // force scroll after user sends
    setTimeout(() => scrollToBottom(true), 0);

    // Declare before try so it's accessible in finally
    let streamCompleted = false;

    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": localStorage.getItem("authToken") || "",
        },
        body: JSON.stringify({
          conversation_id: convId,
          content: content,
          project_id: project.id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      // Handle SSE streaming with batched updates to prevent flickering
      const reader = response.body?.getReader();

      if (reader) {
        const decoder = new TextDecoder();
        let fullContent = "";
        let pendingContent = "";
        let updateScheduled = false;
        let rafCancelled = false; // prevents stale rAF from reviving cleared streaming

        const scheduleUpdate = () => {
          if (updateScheduled) return;
          updateScheduled = true;
          requestAnimationFrame(() => {
            updateScheduled = false;
            if (rafCancelled) return; // stream already done — don't touch state
            if (pendingContent) {
              fullContent += pendingContent;
              pendingContent = "";
              setStreamingContent(fullContent);
            }
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text" && data.content) {
                  pendingContent += data.content;
                  scheduleUpdate();
                } else if (data.type === "done") {
                  console.log("[SendMessage] Received 'done' event, isNewConv:", isNewConv);
                  // Cancel any pending rAF before touching state
                  rafCancelled = true;
                  // Flush any content not yet committed by rAF
                  if (pendingContent) {
                    fullContent += pendingContent;
                    pendingContent = "";
                  }
                  streamCompleted = true;
                  // Clear streaming bubble and add final message in same render cycle
                  setStreamingContent("");
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: Date.now(),
                      conversation_id: convId!,
                      role: "assistant",
                      content: fullContent,
                      created_at: new Date().toISOString(),
                    },
                  ]);
                  // Auto-rename: always rename new conversations, check existing ones
                  const newTitle = generateTitle(content);
                  console.log("[AutoRename] isNewConv:", isNewConv, "newTitle:", newTitle);
                  
                  // Force rename for new conversations
                  if (isNewConv) {
                    console.log("[AutoRename] Forcing rename for new conversation");
                    await renameConversation(convId!, newTitle);
                  } else {
                    // For existing, only rename if default title
                    const conv = conversations.find((c) => c.id === convId);
                    if (conv && ["新对话", "New Chat"].includes(conv.title)) {
                      console.log("[AutoRename] Renaming existing with default title");
                      await renameConversation(convId!, newTitle);
                    }
                  }
                  // Fetch only this conversation's updated title
                  const targetConvId = convId!;
                  setTimeout(async () => {
                    try {
                      const updated = await api.get<Conversation>(
                        `/chat/conversations/${targetConvId}`,
                      );
                      setConversations((prev) =>
                        prev.map((c) => (c.id === targetConvId ? updated : c)),
                      );
                    } catch (_) {}
                  }, 1200);
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
      if (!streamCompleted) {
        setStreamingContent("");
      }
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="h-full bg-white rounded-xl border border-gray-200 flex overflow-hidden">
      {/* Sidebar - Conversation List */}
      <div
        className={`${isSidebarOpen ? "w-64" : "w-0"} border-r border-gray-200 bg-gray-50/50 flex flex-col transition-all duration-300 ${isSidebarOpen ? "" : "overflow-hidden"}`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-100 bg-white">
          <button
            onClick={() => {
              setActiveConvId(null);
              setMessages([]);
              setStreamingContent("");
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {isZh ? "新建对话" : "New Chat"}
          </button>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Pending new conversation placeholder */}
          {activeConvId === null && (
            <div className="flex items-center gap-2 p-2.5 bg-white rounded-lg border border-primary/20 shadow-sm">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              </div>
              <p className="text-sm font-medium text-gray-900 truncate">
                {isZh ? "新对话" : "New Chat"}
              </p>
            </div>
          )}
          {isLoadingConversations ? (
            <div className="p-2 space-y-2 animate-pulse">
              {[80, 60, 70, 55].map((w, i) => (
                <div key={i} className="flex items-center gap-2 p-2.5">
                  <div className="w-6 h-6 rounded bg-gray-200 flex-shrink-0" />
                  <div
                    className={`h-3 bg-gray-200 rounded-full`}
                    style={{ width: `${w}%` }}
                  />
                </div>
              ))}
            </div>
          ) : conversations.length === 0 && activeConvId !== null ? (
            <div className="p-4 text-center text-gray-400 text-sm">
              {isZh ? "暂无对话" : "No conversations yet"}
            </div>
          ) : conversations.length > 0 ? (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`group flex items-center gap-2 p-2.5 cursor-pointer rounded-lg transition-all ${
                  activeConvId === conv.id
                    ? "bg-white shadow-sm border border-gray-200"
                    : "hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200"
                }`}
              >
                <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${activeConvId === conv.id ? "bg-primary/10" : "bg-gray-100 group-hover:bg-primary/5"}`}>
                  <MessageSquare
                    className={`w-3.5 h-3.5 flex-shrink-0 ${activeConvId === conv.id ? "text-primary" : "text-gray-400 group-hover:text-primary/60"}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  {editingConvId === conv.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          renameConversation(conv.id, editTitle);
                        } else if (e.key === "Escape") {
                          setEditingConvId(null);
                        }
                      }}
                      onBlur={() => renameConversation(conv.id, editTitle)}
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary/20"
                      autoFocus
                    />
                  ) : (
                    <p
                      className={`text-sm truncate ${activeConvId === conv.id ? "font-medium text-gray-900" : "text-gray-600"}`}
                    >
                      {conv.title}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingConvId(conv.id);
                      setEditTitle(conv.title);
                    }}
                    className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          ) : null}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header */}
        {/* DEBUG: AutoRename feature active */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              {isSidebarOpen ? (
                <ChevronLeft className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-base">
                {activeConversation?.title ||
                  (isZh ? "项目 AI 助手" : "Project AI Assistant")}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {isZh
                  ? "基于项目上下文提供智能建议"
                  : "Smart suggestions based on project context"}
              </p>
            </div>
          </div>
          
          {/* Export button */}
          {activeConversation?.id && (
            <ExportDropdown 
              conversationId={activeConversation.id}
              conversationTitle={activeConversation.title}
            />
          )}
        </div>

        {/* Messages Area */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
        >
          {/* Loading skeleton when switching conversations */}
          {isLoadingMessages && (
            <div className="space-y-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded-full w-3/4" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/2" />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <div className="flex-1 space-y-2 flex flex-col items-end">
                  <div className="h-3 bg-gray-200 rounded-full w-2/3" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/3" />
                </div>
                <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded-full w-5/6" />
                  <div className="h-3 bg-gray-200 rounded-full w-2/3" />
                  <div className="h-3 bg-gray-200 rounded-full w-1/2" />
                </div>
              </div>
            </div>
          )}

          {/* Empty State - only show when truly empty and not loading */}
          {messages.length === 0 &&
            !streamingContent &&
            !isLoading &&
            !isLoadingMessages && (
              <div className="h-full flex flex-col items-center justify-center text-gray-500">
                <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center mb-4 border border-primary/10">
                  <Bot className="w-8 h-8 text-primary/40" />
                </div>
                <p className="text-base font-semibold text-gray-900 mb-2">
                  {isZh ? "开始对话" : "Start a conversation"}
                </p>
                <p className="text-sm text-gray-500 mb-6 max-w-xs text-center">
                  {isZh
                    ? "选择下方快捷场景或直接输入问题"
                    : "Choose a quick prompt below or type your question"}
                </p>

                {/* Quick Prompts */}
                <div className="grid grid-cols-2 gap-3 max-w-md">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt.key}
                      onClick={() =>
                        sendMessage(isZh ? prompt.labelZh : prompt.labelEn)
                      }
                      className="flex items-center gap-2 p-3 bg-white border border-gray-200 hover:border-primary/30 hover:bg-primary/5 rounded-xl text-left transition-all shadow-sm hover:shadow"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <prompt.icon className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {isZh ? prompt.labelZh : prompt.labelEn}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

          {/* Message List */}
          {!isLoadingMessages &&
            (messages.length > 0 || streamingContent || isLoading) && (
              <>
                {messages.map((msg) => (
                  <ChatMessageBubble key={msg.id} msg={msg} />
                ))}

                {streamingContent && (
                  <ChatStreamingMessage
                    key="streaming"
                    content={streamingContent}
                  />
                )}

                {/* Loading indicator */}
                {isLoading && !streamingContent && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-sm text-gray-500">
                          {isZh ? "思考中..." : "Thinking..."}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-100 bg-white">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(inputValue);
                  }
                }}
                placeholder={
                  isZh
                    ? "输入消息... (Shift+Enter 换行)"
                    : "Type a message... (Shift+Enter for new line)"
                }
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 resize-none min-h-[48px] max-h-[120px] transition-all"
                rows={1}
                style={{ height: "auto" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = target.scrollHeight + "px";
                }}
              />
            </div>
            <button
              onClick={() => sendMessage(inputValue)}
              disabled={!inputValue.trim() || isLoading}
              className="p-3 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Financials Tab Content
// Payment Form Modal
function PaymentModal({
  isOpen,
  onClose,
  onSave,
  projectId,
  defaultType = "received",
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  projectId: string;
  defaultType?: string;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [form, setForm] = useState({
    amount: "",
    payment_date: new Date().toISOString().split("T")[0],
    note: "",
    payment_type: defaultType,
  });
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount) return;

    setSaving(true);
    try {
      await api.post(`/projects/${projectId}/financials`, {
        amount: parseFloat(form.amount),
        payment_date: form.payment_date,
        note: form.note,
        payment_type: form.payment_type,
      });
      onSave();
      onClose();
    } catch (error) {
      console.error("Failed to add payment:", error);
      toast.error(isZh ? "添加失败" : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">
            {form.payment_type === "received"
              ? isZh
                ? "记录收款"
                : "Record Payment"
              : form.payment_type === "invoiced"
                ? isZh
                  ? "记录开票"
                  : "Record Invoice"
                : isZh
                  ? "记录支出"
                  : "Record Expense"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "类型" : "Type"}
            </label>
            <div className="flex gap-2">
              {[
                {
                  value: "received",
                  label: isZh ? "收款" : "Received",
                  color: "emerald",
                },
                {
                  value: "invoiced",
                  label: isZh ? "开票" : "Invoiced",
                  color: "blue",
                },
                {
                  value: "expense",
                  label: isZh ? "支出" : "Expense",
                  color: "red",
                },
              ].map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm({ ...form, payment_type: t.value })}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    form.payment_type === t.value
                      ? `bg-${t.color}-50 border-${t.color}-200 text-${t.color}-700`
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "金额" : "Amount"}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                ¥
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "日期" : "Date"}
            </label>
            <input
              type="date"
              required
              value={form.payment_date}
              onChange={(e) =>
                setForm({ ...form, payment_date: e.target.value })
              }
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isZh ? "备注" : "Note"}
            </label>
            <input
              type="text"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder={isZh ? "可选" : "Optional"}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={saving || !form.amount}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving
                ? isZh
                  ? "保存中..."
                  : "Saving..."
                : isZh
                  ? "保存"
                  : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Contract Amount Modal
function ContractAmountModal({
  isOpen,
  onClose,
  currentAmount,
  projectId,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentAmount: number;
  projectId: string;
  onSave: () => void;
}) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();
  const [amount, setAmount] = useState(currentAmount.toString());
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/projects/${projectId}`, {
        contract_amount: parseFloat(amount) || 0,
      });
      onSave();
      onClose();
    } catch (error) {
      console.error("Failed to update contract amount:", error);
      toast.error(isZh ? "更新失败" : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm m-4 p-5">
        <h3 className="text-lg font-bold text-gray-900 mb-4">
          {isZh ? "设置合同金额" : "Set Contract Amount"}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              ¥
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="0.00"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90"
            >
              {saving
                ? isZh
                  ? "保存中..."
                  : "Saving..."
                : isZh
                  ? "保存"
                  : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FinancialsTab({
  projectDetail,
  projectId,
  onUpdate,
}: {
  projectDetail: ProjectDetailType;
  projectId: string;
  onUpdate: () => void;
}) {
  const { financials } = projectDetail;
  const payments = financials.payments || [];
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toast = useToast();

  const [filter, setFilter] = useState<
    "all" | "received" | "invoiced" | "expense"
  >("all");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [defaultPaymentType, setDefaultPaymentType] = useState("received");

  const filteredPayments = payments.filter(
    (p) => filter === "all" || p.payment_type === filter,
  );

  const handleDeletePayment = async (paymentId: number) => {
    if (
      !confirm(
        isZh
          ? "确定要删除这条记录吗？"
          : "Are you sure you want to delete this record?",
      )
    )
      return;
    try {
      await api.delete(`/projects/${projectId}/financials/${paymentId}`);
      onUpdate();
    } catch (error) {
      console.error("Failed to delete payment:", error);
      toast.error(isZh ? "删除失败" : "Failed to delete");
    }
  };

  const getPaymentIcon = (type: string) => {
    switch (type) {
      case "received":
        return <TrendingUp className="w-5 h-5" />;
      case "invoiced":
        return <FileText className="w-5 h-5" />;
      case "expense":
        return <TrendingUp className="w-5 h-5 rotate-180" />;
      default:
        return <DollarSign className="w-5 h-5" />;
    }
  };

  const getPaymentColor = (type: string) => {
    switch (type) {
      case "received":
        return "bg-emerald-100 text-emerald-600";
      case "invoiced":
        return "bg-blue-100 text-blue-600";
      case "expense":
        return "bg-red-100 text-red-600";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  const getPaymentLabel = (type: string) => {
    switch (type) {
      case "received":
        return isZh ? "收款" : "Received";
      case "invoiced":
        return isZh ? "开票" : "Invoiced";
      case "expense":
        return isZh ? "支出" : "Expense";
      default:
        return type;
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Financial Summary Cards - Horizontal */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Contract Amount */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">
              {isZh ? "合同金额" : "Contract"}
            </span>
            <button
              onClick={() => setShowContractModal(true)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xl font-bold text-gray-900">
            {financials.contract_amount
              ? `¥${formatAmountInTenThousand(financials.contract_amount)}万`
              : isZh
                ? "未设置"
                : "Not set"}
          </p>
          {financials.contract_amount > 0 && (
            <div className="mt-2 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{
                  width: `${Math.min((financials.total_received / financials.contract_amount) * 100, 100)}%`,
                }}
              />
            </div>
          )}
        </div>

        {/* Received */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "已收款" : "Received"}
          </span>
          <p className="text-xl font-bold text-emerald-600">
            ¥{financials.total_received.toLocaleString()}
          </p>
        </div>

        {/* Invoiced */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "已开票" : "Invoiced"}
          </span>
          <p className="text-xl font-bold text-blue-600">
            ¥{financials.total_invoiced.toLocaleString()}
          </p>
        </div>

        {/* Expenses */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <span className="text-sm text-gray-500">
            {isZh ? "支出" : "Expenses"}
          </span>
          <p className="text-xl font-bold text-red-600">
            ¥{financials.total_expense.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Net Profit Bar */}
      <div
        className={`rounded-xl p-4 flex items-center justify-between ${financials.remaining >= 0 ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}
      >
        <div>
          <span
            className={`text-sm ${financials.remaining >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {isZh ? "净利润" : "Net Profit"}
          </span>
          <p
            className={`text-2xl font-bold ${financials.remaining >= 0 ? "text-emerald-900" : "text-red-900"}`}
          >
            {financials.remaining >= 0 ? "+" : "-"}¥
            {Math.abs(financials.remaining).toLocaleString()}
          </p>
        </div>
        <div className="text-right text-sm text-gray-500">
          <p>
            {isZh ? "未收款" : "Uncollected"}: ¥
            {financials.uncollected.toLocaleString()}
          </p>
          {financials.contract_amount > 0 && (
            <p>
              {isZh ? "支出占比" : "Expense"}:{" "}
              {(
                (financials.total_expense / financials.contract_amount) *
                100
              ).toFixed(1)}
              %
            </p>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => {
            setDefaultPaymentType("received");
            setShowPaymentModal(true);
          }}
          className="flex-1 flex items-center justify-center gap-2 p-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          {isZh ? "收款" : "Payment"}
        </button>
        <button
          onClick={() => {
            setDefaultPaymentType("invoiced");
            setShowPaymentModal(true);
          }}
          className="flex-1 flex items-center justify-center gap-2 p-3 bg-blue-50 text-blue-700 rounded-xl font-medium hover:bg-blue-100 transition-colors"
        >
          <FileText className="w-5 h-5" />
          {isZh ? "开票" : "Invoice"}
        </button>
        <button
          onClick={() => {
            setDefaultPaymentType("expense");
            setShowPaymentModal(true);
          }}
          className="flex-1 flex items-center justify-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl font-medium hover:bg-red-100 transition-colors"
        >
          <TrendingUp className="w-5 h-5 rotate-180" />
          {isZh ? "支出" : "Expense"}
        </button>
      </div>

      {/* Transactions */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {isZh ? "交易记录" : "Transactions"}
          </h3>
          <div className="flex items-center gap-2">
            {[
              { key: "all", label: isZh ? "全部" : "All", color: "gray" },
              {
                key: "received",
                label: isZh ? "收款" : "Received",
                color: "emerald",
              },
              {
                key: "invoiced",
                label: isZh ? "开票" : "Invoiced",
                color: "blue",
              },
              {
                key: "expense",
                label: isZh ? "支出" : "Expense",
                color: "red",
              },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key as any)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filter === f.key
                    ? `bg-${f.color}-50 text-${f.color}-700 font-medium`
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {filteredPayments.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Receipt className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{isZh ? "暂无交易记录" : "No transactions yet"}</p>
            </div>
          ) : (
            filteredPayments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between p-5 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${getPaymentColor(payment.payment_type)}`}
                  >
                    {getPaymentIcon(payment.payment_type)}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {getPaymentLabel(payment.payment_type)}
                    </p>
                    {payment.note && (
                      <p className="text-sm text-gray-500">{payment.note}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(payment.payment_date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={`font-semibold ${
                      payment.payment_type === "expense"
                        ? "text-red-600"
                        : payment.payment_type === "invoiced"
                          ? "text-blue-600"
                          : "text-emerald-600"
                    }`}
                  >
                    {payment.payment_type === "expense" ? "-" : "+"}¥
                    {Math.abs(payment.amount).toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleDeletePayment(payment.id)}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSave={onUpdate}
        projectId={projectId}
        defaultType={defaultPaymentType}
      />
      <ContractAmountModal
        isOpen={showContractModal}
        onClose={() => setShowContractModal(false)}
        currentAmount={financials.contract_amount || 0}
        projectId={projectId}
        onSave={onUpdate}
      />
    </div>
  );
}

// Settings Tab Content
function SettingsTab({
  projectDetail,
  onUpdate,
}: {
  projectDetail: ProjectDetailType;
  onUpdate: () => void;
}) {
  const { project } = projectDetail;
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const [isEditing, setIsEditing] = useState(() => !!(location.state as any)?.edit);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ name: string; description: string }>
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [formData, setFormData] = useState({
    name: project.name,
    client: project.client,
    description: project.description || "",
    notes: project.notes || "",
    status: project.status,
    contract_amount: project.contract_amount || 0,
    start_date: (project as any).start_date || "",
    end_date: (project as any).end_date || "",
  });

  const stageRef = useRef<HTMLDivElement>(null);

  // Fetch clients list when entering edit mode - extract from all projects
  useEffect(() => {
    if (isEditing) {
      fetchClients();
      // Scroll to stage selector when opened via "编辑" button
      if ((location.state as any)?.edit) {
        setTimeout(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
      }
    }
  }, [isEditing]);

  const fetchClients = async () => {
    setIsLoadingClients(true);
    try {
      // Get all projects and extract unique client names
      const res = await api.get<{ projects: Array<{ client: string }> }>(
        "/projects?limit=1000",
      );
      const projectList = res.projects || [];
      // Extract unique client names, filter out empty ones, and sort
      const uniqueClients = Array.from(
        new Set(projectList.map((p) => p.client).filter((c) => c && c.trim())),
      ).sort();
      // Ensure current client is in the list
      if (project.client && !uniqueClients.includes(project.client)) {
        uniqueClients.unshift(project.client);
      }
      setClients(uniqueClients);
    } catch (error) {
      console.error("Failed to fetch clients:", error);
      // Fallback: use current project client
      setClients([project.client]);
    } finally {
      setIsLoadingClients(false);
    }
  };

  const handleChange = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleArchive = async () => {
    try {
      await api.patch(`/projects/${project.id}`, { status: 'archived' })
      onUpdate()
    } catch (err) {
      console.error('Archive failed:', err)
    }
  }

  const handleDelete = async () => {
    if (deleteConfirmText !== project.name) return
    setIsDeleting(true)
    try {
      await api.delete(`/projects/${project.id}`)
      toast.success(isZh ? `项目"${project.name}"已删除` : `Project "${project.name}" deleted`)
      navigate('/projects', { replace: true })
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error(isZh ? '删除失败，请重试' : 'Delete failed, please try again')
      setIsDeleting(false)
    }
  }

  // AI Suggest project name and description
  const runAISuggest = async () => {
    if (!formData.client.trim()) {
      setAiError(
        isZh ? "请先填写客户名称" : "Please fill in client name first",
      );
      return;
    }
    setIsAILoading(true);
    setAiError("");
    try {
      const res = await api.post<{
        suggestions: Array<{ name: string; description: string }>;
      }>("/ai/suggest-project", {
        client: formData.client,
        current_name: formData.name,
        current_description: formData.description,
      });
      setSuggestions(res.suggestions || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error("AI suggest failed:", error);
      setAiError(isZh ? "AI 建议生成失败" : "AI suggestion failed");
    } finally {
      setIsAILoading(false);
    }
  };

  // AI Polish description
  const runAIPolish = async () => {
    if (!formData.description.trim()) {
      setAiError(isZh ? "请先填写描述" : "Please fill in description first");
      return;
    }
    setIsAILoading(true);
    setAiError("");
    try {
      const res = await api.post<{ improved: string }>("/ai/polish", {
        text: formData.description,
        type: "project_description",
      });
      if (res.improved) {
        setFormData((prev) => ({ ...prev, description: res.improved }));
      }
    } catch (error) {
      console.error("AI polish failed:", error);
      setAiError(isZh ? "AI 优化失败" : "AI polish failed");
    } finally {
      setIsAILoading(false);
    }
  };

  const applySuggestion = (suggestion: {
    name: string;
    description: string;
  }) => {
    setFormData((prev) => ({
      ...prev,
      name: suggestion.name,
      description: suggestion.description,
    }));
    setShowSuggestions(false);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.client.trim()) {
      toast.warning(
        isZh
          ? "项目名称和客户名称不能为空"
          : "Project name and client name are required",
      );
      return;
    }

    setIsSaving(true);
    try {
      await api.patch(`/projects/${project.id}`, {
        name: formData.name,
        client: formData.client,
        description: formData.description,
        notes: formData.notes,
        status: toBackendStatus(formData.status),
        contract_amount: Number(formData.contract_amount) || 0,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
      });
      onUpdate();
      setIsEditing(false);
      setShowSuggestions(false);
      toast.success(isZh ? "项目信息已保存" : "Project saved");
    } catch (error) {
      console.error("Failed to update project:", error);
      toast.error(isZh ? "保存失败，请重试" : "Failed to save, please try again");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      name: project.name,
      client: project.client,
      description: project.description || "",
      notes: project.notes || "",
      status: project.status,
      contract_amount: project.contract_amount || 0,
      start_date: (project as any).start_date || "",
      end_date: (project as any).end_date || "",
    });
    setIsEditing(false);
    setShowSuggestions(false);
    setAiError("");
  };

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Project Info Settings - Left Column (2/3) */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-gray-900">
                {isZh ? "项目信息" : "Project Information"}
              </h3>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                  {isZh ? "编辑" : "Edit"}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {isZh ? "取消" : "Cancel"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    {isZh ? "保存" : "Save"}
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {isZh ? "项目名称" : "Project Name"}
                  {isEditing && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  disabled={!isEditing}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {isZh ? "客户名称" : "Client Name"}
                  {isEditing && <span className="text-red-500 ml-1">*</span>}
                </label>
                {isEditing ? (
                  <div className="relative">
                    <select
                      value={formData.client}
                      onChange={(e) => handleChange("client", e.target.value)}
                      disabled={isLoadingClients}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 appearance-none cursor-pointer"
                    >
                      <option value="">
                        {isZh ? "请选择客户" : "Select a client"}
                      </option>
                      {clients.map((client) => (
                        <option key={client} value={client}>
                          {client}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      {isLoadingClients ? (
                        <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400 rotate-90" />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-2.5 bg-gray-100 rounded-lg text-sm text-gray-500">
                    {formData.client || (isZh ? "未设置" : "Not set")}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {isZh ? "开始日期" : "Start Date"}
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => handleChange("start_date", e.target.value)}
                    disabled={!isEditing}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {isZh ? "结束日期" : "End Date"}
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => handleChange("end_date", e.target.value)}
                    disabled={!isEditing}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {isZh ? "合同金额 (¥)" : "Contract Amount (¥)"}
                </label>
                <input
                  type="number"
                  value={formData.contract_amount}
                  onChange={(e) =>
                    handleChange("contract_amount", e.target.value)
                  }
                  disabled={!isEditing}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>

              {/* Stage Selector */}
              <div ref={stageRef}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {isZh ? "项目阶段" : "Project Stage"}
                </label>
                {isEditing ? (
                  <div className="space-y-2">
                    {/* Business Phase */}
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">商机阶段</p>
                    <div className="grid grid-cols-5 gap-1.5 mb-3">
                      {PROJECT_STAGE_CONFIGS.filter(s => s.phase === 'business').map(stage => {
                        const Icon = stage.icon
                        const isActive = resolveProjectStage(formData.status).id === stage.id
                        return (
                          <button
                            key={stage.id}
                            type="button"
                            onClick={() => handleChange("status", stage.id)}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-all ${
                              isActive
                                ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm`
                                : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <span className="text-xs leading-tight">{stage.labelZh}</span>
                          </button>
                        )
                      })}
                    </div>
                    {/* Delivery Phase */}
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">交付阶段</p>
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {PROJECT_STAGE_CONFIGS.filter(s => s.phase === 'delivery').map(stage => {
                        const Icon = stage.icon
                        const isActive = resolveProjectStage(formData.status).id === stage.id
                        return (
                          <button
                            key={stage.id}
                            type="button"
                            onClick={() => handleChange("status", stage.id)}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-all ${
                              isActive
                                ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm`
                                : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <span className="text-xs leading-tight">{stage.labelZh}</span>
                          </button>
                        )
                      })}
                    </div>
                    {/* Archived */}
                    {(() => {
                      const stage = PROJECT_STAGE_CONFIGS.find(s => s.id === 'archived') || PROJECT_STAGE_CONFIGS[0]
                      const Icon = stage.icon
                      const isActive = resolveProjectStage(formData.status).id === 'archived'
                      return (
                        <button
                          type="button"
                          onClick={() => handleChange("status", "archived")}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                            isActive
                              ? `${stage.bgColor} ${stage.color} ${stage.borderColor} shadow-sm`
                              : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {stage.labelZh}
                        </button>
                      )
                    })()}
                  </div>
                ) : (
                  (() => {
                    const stage = resolveProjectStage(formData.status)
                    const Icon = stage.icon
                    return (
                      <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${stage.bgColor} ${stage.color} ${stage.borderColor}`}>
                        <Icon className="w-4 h-4" />
                        {stage.labelZh}
                      </div>
                    )
                  })()
                )}
              </div>

              {/* AI Assistant Section - hidden until backend API is ready */}
              {false && isEditing && (
                <div className="bg-gradient-to-r from-primary/5 to-purple-500/5 rounded-xl p-4 border border-primary/10">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-gray-700">
                      {isZh ? "AI 助手" : "AI Assistant"}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={runAISuggest}
                      disabled={isAILoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {isAILoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="w-3.5 h-3.5" />
                      )}
                      {isZh ? "重新生成" : "Regenerate"}
                    </button>

                    {formData.description && (
                      <button
                        type="button"
                        onClick={runAIPolish}
                        disabled={isAILoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-primary text-primary rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {isZh ? "优化描述" : "Polish"}
                      </button>
                    )}
                  </div>

                  {aiError && (
                    <div className="mt-2 text-amber-600 text-xs">
                      ⚠️ {aiError}
                    </div>
                  )}

                  {showSuggestions && suggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-500">
                        {isZh
                          ? "AI 建议（点击应用）"
                          : "AI suggestions (click to apply)"}
                      </p>
                      {suggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => applySuggestion(suggestion)}
                          className="w-full text-left p-3 bg-white rounded-lg border border-gray-200 hover:border-primary/50 hover:shadow-sm transition-all"
                        >
                          <p className="font-medium text-sm text-gray-900">
                            {suggestion.name}
                          </p>
                          <p className="text-xs text-gray-500 line-clamp-2">
                            {suggestion.description}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {isZh ? "项目描述" : "Description"}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleChange("description", e.target.value)}
                  disabled={!isEditing}
                  rows={4}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {isZh ? "备注" : "Notes"}
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  disabled={!isEditing}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Danger Zone - Right Column (1/3) */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-red-200 p-6">
            <h3 className="font-semibold text-red-600 mb-4">
              {isZh ? "危险区域" : "Danger Zone"}
            </h3>
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {isZh ? "归档项目" : "Archive Project"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {isZh
                      ? "将项目标记为已完成并归档"
                      : "Mark project as completed and archive"}
                  </p>
                </div>
                <button
                  onClick={handleArchive}
                  disabled={project.status === 'archived'}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {project.status === 'archived' ? (isZh ? "已归档" : "Archived") : (isZh ? "归档项目" : "Archive Project")}
                </button>
              </div>
              <div className="h-px bg-red-100" />
              <div className="flex flex-col gap-3">
                <div>
                  <p className="font-medium text-red-600">
                    {isZh ? "删除项目" : "Delete Project"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {isZh ? "永久删除此项目及其所有数据，此操作不可撤销" : "Permanently delete this project and all its data. This cannot be undone."}
                  </p>
                </div>
                <button
                  onClick={() => { setShowDeleteDialog(true); setDeleteConfirmText('') }}
                  className="w-full px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                >
                  {isZh ? "删除项目" : "Delete Project"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{isZh ? "确认删除项目" : "Delete Project"}</h3>
                <p className="text-sm text-gray-500">{isZh ? "此操作不可撤销" : "This action cannot be undone"}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              {isZh ? "请输入项目名称" : "Please type the project name"} <span className="font-semibold text-gray-900">"{project.name}"</span> {isZh ? "以确认删除" : "to confirm deletion"}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={project.name}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100 mb-4 transition-colors"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== project.name || isDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isZh ? "确认删除" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== Main Component ====================
export function ProjectDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isChatTab = location.pathname.endsWith("/chat");
  const isNotesTab = location.pathname.endsWith("/notes");
  const isTodosTab = location.pathname.endsWith("/todos");
  const [initialLoading, setInitialLoading] = useState(true);
  const [projectDetail, setProjectDetail] = useState<ProjectDetailType | null>(
    null,
  );

  useEffect(() => {
    if (id) {
      fetchProjectDetail(parseInt(id));
    }
  }, [id]);

  const fetchProjectDetail = async (projectId: number) => {
    try {
      const data = await api.get<ProjectDetailType>(
        `/projects/${projectId}/detail`,
      );
      setProjectDetail(data);
    } catch (error) {
      console.error("Failed to fetch project detail:", error);
    } finally {
      setInitialLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <>
        <PageTitle title="Project" />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    );
  }

  if (!projectDetail) {
    return (
      <>
        <PageTitle title="Project" />
        <div className="min-h-full bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500">Project not found</p>
            <button
              onClick={() => navigate("/projects")}
              className="mt-4 text-primary hover:underline"
            >
              {t("projects.projectDetail.back")}
            </button>
          </div>
        </div>
      </>
    );
  }

  const { project } = projectDetail;

  return (
    <>
      <PageTitle title={project.name} />
      <div
        className={
          isChatTab
            ? "bg-gray-50 h-screen overflow-hidden flex flex-col"
            : "min-h-full bg-gray-50"
        }
      >
        {/* Sticky Header with Navigation */}
        <ProjectHeader
          project={project}
          onBack={() => navigate("/projects")}
          projectId={id!}
        />

        {/* ChatTab — flex-1 fills remaining height, kept mounted to preserve state */}
        {isChatTab && (
          <div className="flex-1 overflow-hidden px-6 py-4">
            <ChatTab project={project} />
          </div>
        )}
        {/* Always-mounted hidden ChatTab to preserve state when on other tabs */}
        {!isChatTab && (
          <div className="hidden">
            <ChatTab project={project} />
          </div>
        )}

        {/* NotesTab — kept mounted to preserve editing state */}
        {isNotesTab && (
          <div className="max-w-full mx-auto px-6 py-6 min-h-[calc(100vh-180px)]">
            <ProjectNotesTab
              projectId={id!}
              mdNotes={projectDetail.md_notes}
              onUpdate={() => fetchProjectDetail(parseInt(id!))}
            />
          </div>
        )}
        {!isNotesTab && (
          <div className="hidden">
            <ProjectNotesTab
              projectId={id!}
              mdNotes={projectDetail.md_notes}
              onUpdate={() => fetchProjectDetail(parseInt(id!))}
            />
          </div>
        )}

        {/* TodosTab — kept mounted to preserve form state */}
        {isTodosTab && (
          <div className="max-w-full mx-auto px-6 py-6 min-h-[calc(100vh-180px)]">
            <ProjectTodosTab
              projectId={id!}
              todos={projectDetail.todos}
              onUpdate={() => fetchProjectDetail(parseInt(id!))}
            />
          </div>
        )}
        {!isTodosTab && (
          <div className="hidden">
            <ProjectTodosTab
              projectId={id!}
              todos={projectDetail.todos}
              onUpdate={() => fetchProjectDetail(parseInt(id!))}
            />
          </div>
        )}

        {/* Other tabs — normal scrollable content */}
        <div
          className={`max-w-full mx-auto px-6 py-6 min-h-[calc(100vh-180px)] ${isChatTab || isNotesTab || isTodosTab ? "hidden" : ""}`}
        >
          <Routes>
            <Route
              path="/"
              element={
                <OverviewTab
                  projectDetail={projectDetail}
                  projectId={id!}
                  onProjectUpdate={() => fetchProjectDetail(parseInt(id!))}
                />
              }
            />
            <Route
              path="/documents"
              element={
                <DocumentsTab
                  projectDetail={projectDetail}
                  projectId={id!}
                  onUpdate={() => fetchProjectDetail(parseInt(id!))}
                />
              }
            />
            <Route
              path="/milestones"
              element={
                <MilestonesTab
                  projectDetail={projectDetail}
                  projectId={id!}
                  onUpdate={async () => await fetchProjectDetail(parseInt(id!))}
                />
              }
            />
            <Route
              path="/financials"
              element={
                <FinancialsTab
                  projectDetail={projectDetail}
                  projectId={id!}
                  onUpdate={() => fetchProjectDetail(parseInt(id!))}
                />
              }
            />
            <Route
              path="/settings"
              element={
                <SettingsTab
                  projectDetail={projectDetail}
                  onUpdate={() => fetchProjectDetail(parseInt(id!))}
                />
              }
            />
          </Routes>
        </div>
      </div>
    </>
  );
}

export default ProjectDetail;
