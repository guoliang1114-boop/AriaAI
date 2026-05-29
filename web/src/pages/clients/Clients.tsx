import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, Loader2, Plus, Search, Sparkles, X } from "lucide-react";

import { api } from "../../api/client";
import { CxSkeleton, CxStatus, CxTopProgress, type CxStatusTone } from "../../components/codex";
import { PageTitle } from "../../components/PageTitle";
import { formatDateOnly, getResolvedAppTimeZone, parseAppDateTime } from "../../utils/timezone";

interface Client {
  id: number;
  name: string;
  industry: string;
  contact: string;
  notes: string;
  created_at: string;
  document_count: number;
  project_names: string[];
  client_memory_version?: number;
  client_memory_stale?: boolean;
  client_memory_updated_at?: string | null;
}

interface ClientSuggestion {
  name: string;
  industry: string;
  contact: string;
  notes: string;
}

type ClientHealth = "active" | "watch" | "dormant";

const CLIENT_GRID = "minmax(260px,1.8fr) minmax(110px,.7fr) minmax(90px,.6fr) minmax(70px,.55fr) minmax(110px,.75fr) 100px 20px";
const CLIENT_TABLE_MIN_WIDTH = 820;

function safeText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function formatRelativeActivity(value: string | null | undefined, isZh: boolean) {
  if (!value) return isZh ? "未记录" : "Not recorded";

  const date = parseAppDateTime(value);
  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));

  if (Number.isFinite(diffHours)) {
    if (diffHours < 1) return isZh ? "刚刚" : "Just now";
    if (diffHours < 24) return isZh ? "今天" : "Today";
    if (diffHours < 48) return isZh ? "昨天" : "Yesterday";
  }

  return formatDateOnly(value, { month: "short", day: "numeric" }, getResolvedAppTimeZone());
}

function getClientHealth(client: Client): ClientHealth {
  if (client.project_names.length > 0) return "active";
  if (
    client.document_count > 0 ||
    safeText(client.contact) ||
    safeText(client.notes) ||
    (client.client_memory_version || 0) > 0
  ) {
    return "watch";
  }
  return "dormant";
}

function getClientShortName(name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return "-";

  const firstPart = clean.split(/[·|｜\-—]/)[0]?.trim() || clean;
  if (/[\u4e00-\u9fff]/.test(firstPart)) return Array.from(firstPart).slice(0, 6).join("");
  return firstPart.split(" ").slice(0, 2).join(" ");
}

function getAvatarText(name: string) {
  const short = getClientShortName(name);
  const length = /[\u4e00-\u9fff]/.test(short) ? 1 : 2;
  return Array.from(short).slice(0, length).join("").toUpperCase();
}

function inferRegion(client: Client, isZh: boolean) {
  const text = `${client.name} ${client.notes}`.toLowerCase();
  const regionHints: Array<[RegExp, string, string]> = [
    [/北京|beijing/, "北京", "Beijing"],
    [/上海|shanghai/, "上海", "Shanghai"],
    [/广州|guangzhou/, "广州", "Guangzhou"],
    [/深圳|shenzhen/, "深圳", "Shenzhen"],
    [/杭州|hangzhou/, "杭州", "Hangzhou"],
    [/成都|chengdu/, "成都", "Chengdu"],
    [/香港|hong kong|hk/, "香港", "Hong Kong"],
  ];
  const match = regionHints.find(([pattern]) => pattern.test(text));
  if (match) return isZh ? match[1] : match[2];
  return isZh ? "未记录" : "Unknown";
}

function healthCopy(health: ClientHealth, isZh: boolean): { label: string; tone: CxStatusTone } {
  if (health === "active") return { label: isZh ? "活跃" : "Active", tone: "good" };
  if (health === "watch") return { label: isZh ? "关注" : "Watch", tone: "warn" };
  return { label: isZh ? "沉睡" : "Dormant", tone: "mute" };
}

function matchesClient(client: Client, query: string, isZh: boolean) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    client.name,
    getClientShortName(client.name),
    client.industry,
    inferRegion(client, isZh),
    client.contact,
    client.notes,
    ...client.project_names,
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function sortClients(left: Client, right: Client) {
  const healthRank: Record<ClientHealth, number> = { active: 3, watch: 2, dormant: 1 };
  const healthDiff = healthRank[getClientHealth(right)] - healthRank[getClientHealth(left)];
  if (healthDiff !== 0) return healthDiff;

  const projectDiff = right.project_names.length - left.project_names.length;
  if (projectDiff !== 0) return projectDiff;

  const docDiff = right.document_count - left.document_count;
  if (docDiff !== 0) return docDiff;

  return left.name.localeCompare(right.name);
}

export function Clients() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", industry: "", contact: "", notes: "" });

  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<ClientSuggestion[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const data = await api.get<Client[]>("/clients");
      setClients(data);
    } catch (error) {
      console.error("Failed to fetch clients:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchClients();
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setAiQuery("");
    setAiSuggestions([]);
    setAiError(null);
  };

  const handleAiSuggest = async () => {
    const query = aiQuery.trim();
    if (!query) return;

    setAiLoading(true);
    setAiError(null);
    setAiSuggestions([]);

    try {
      const results = await api.post<ClientSuggestion[]>("/clients/ai-suggest", { query });
      setAiSuggestions(results);
      if (results.length === 0) {
        setAiError(isZh ? "AI 没有返回可用建议。" : "AI returned no suggestions.");
      }
    } catch (error: any) {
      console.error("AI suggest failed:", error);
      setAiError(
        error?.response?.data?.detail ||
          (isZh ? "AI 建议生成失败，请稍后重试。" : "AI suggestion failed. Please try again."),
      );
    } finally {
      setAiLoading(false);
    }
  };

  const stats = useMemo(() => {
    const active = clients.filter((client) => getClientHealth(client) === "active").length;
    const watch = clients.filter((client) => getClientHealth(client) === "watch").length;
    const dormant = clients.filter((client) => getClientHealth(client) === "dormant").length;
    return { total: clients.length, active, watch, dormant };
  }, [clients]);

  const filteredClients = useMemo(
    () => clients.filter((client) => matchesClient(client, searchQuery, isZh)).sort(sortClients),
    [clients, isZh, searchQuery],
  );

  return (
    <>
      <PageTitle title={isZh ? "客户" : "Clients"} />
      <main
        className="theme-codex min-h-full"
        style={{
          background: "var(--color-codex-bg)",
          color: "var(--color-codex-ink)",
          fontSize: 13.5,
          lineHeight: 1.6,
        }}
      >
        {loading ? <ClientsLoading title={isZh ? "客户" : "Clients"} /> : null}
        {!loading ? (
          <div style={{ padding: "32px clamp(24px, 4vw, 56px) 40px", minWidth: 0 }}>
            <header
              className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
              style={{ marginBottom: 28 }}
            >
              <div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 28,
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    color: "var(--color-codex-ink)",
                  }}
                >
                  {isZh ? "客户" : "Clients"}
                </h1>
                <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--color-codex-ink-mute)" }}>
                  {isZh
                    ? `${stats.total} 个客户 · ${stats.active} 活跃 · ${stats.watch} 关注 · ${stats.dormant} 沉睡`
                    : `${stats.total} clients · ${stats.active} active · ${stats.watch} watch · ${stats.dormant} dormant`}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div
                  className="flex items-center gap-2"
                  style={{
                    width: "min(100%, 260px)",
                    padding: "7px 12px",
                    border: "1px solid var(--color-codex-line)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                    background: "var(--color-codex-bg-elev)",
                    color: "var(--color-codex-ink-mute)",
                  }}
                >
                  <Search size={13} strokeWidth={1.5} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={isZh ? "搜索客户" : "Search clients"}
                    className="codex-input min-w-0 flex-1 bg-transparent outline-none"
                    style={{ color: "var(--color-codex-ink)", fontSize: 13 }}
                    aria-label={isZh ? "搜索客户" : "Search clients"}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="cx-no-hover inline-flex items-center"
                      style={{ color: "var(--color-codex-ink-faint)" }}
                      aria-label={isZh ? "清空搜索" : "Clear search"}
                    >
                      <X size={13} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  ) : (
                    <span
                      className="codex-mono"
                      style={{ marginLeft: "auto", color: "var(--color-codex-ink-faint)", fontSize: 11 }}
                    >
                      ⌘F
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center justify-center gap-1.5"
                  style={{
                    padding: "7px 14px",
                    fontSize: 12.5,
                    color: "var(--color-codex-bg-elev)",
                    background: "var(--color-codex-ink)",
                    borderRadius: "var(--codex-r-sm, 3px)",
                  }}
                >
                  <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
                  {isZh ? "新建客户" : "New client"}
                </button>
              </div>
            </header>

            <StatsStrip stats={stats} isZh={isZh} />

            <section aria-label={isZh ? "客户列表" : "Client directory"}>
              {filteredClients.length === 0 ? (
                <EmptyClientsState
                  isZh={isZh}
                  hasSearch={Boolean(searchQuery.trim())}
                  onCreate={() => setShowCreateModal(true)}
                  onClear={() => setSearchQuery("")}
                />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <div
                    className="hidden lg:grid"
                    style={{
                      minWidth: CLIENT_TABLE_MIN_WIDTH,
                      gridTemplateColumns: CLIENT_GRID,
                      gap: 12,
                      padding: "10px 8px",
                      fontSize: 11.5,
                      color: "var(--color-codex-ink-faint)",
                    }}
                  >
                    <span>{isZh ? "客户" : "Client"}</span>
                    <span>{isZh ? "行业" : "Industry"}</span>
                    <span>{isZh ? "地区" : "Region"}</span>
                    <span>{isZh ? "项目数" : "Projects"}</span>
                    <span>{isZh ? "最近联系" : "Last contact"}</span>
                    <span>{isZh ? "状态" : "Status"}</span>
                    <span />
                  </div>
                  <div style={{ minWidth: CLIENT_TABLE_MIN_WIDTH }}>
                    {filteredClients.map((client) => (
                      <ClientTableRow
                        key={client.id}
                        client={client}
                        isZh={isZh}
                        onOpen={() => navigate(`/clients/${client.id}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>

      {showCreateModal && (
        <CreateClientModal
          aiError={aiError}
          aiLoading={aiLoading}
          aiQuery={aiQuery}
          aiSuggestions={aiSuggestions}
          creating={creating}
          form={form}
          isZh={isZh}
          onAiQueryChange={setAiQuery}
          onAiSuggest={() => void handleAiSuggest()}
          onClose={closeCreateModal}
          onFormChange={setForm}
          onSuggestionSelect={(suggestion) => {
            setForm({
              name: suggestion.name,
              industry: suggestion.industry,
              contact: suggestion.contact,
              notes: suggestion.notes,
            });
            setAiSuggestions([]);
          }}
          onSubmit={async () => {
            if (!form.name.trim()) {
              alert(isZh ? "客户名称不能为空。" : "Client name is required.");
              return;
            }
            setCreating(true);
            try {
              await api.post("/clients", {
                name: form.name.trim(),
                industry: form.industry.trim(),
                contact: form.contact.trim(),
                notes: form.notes.trim(),
              });
              setForm({ name: "", industry: "", contact: "", notes: "" });
              closeCreateModal();
              await fetchClients();
            } catch (error) {
              console.error("Failed to create client:", error);
              alert(isZh ? "创建失败，请稍后重试。" : "Failed to create client.");
            } finally {
              setCreating(false);
            }
          }}
        />
      )}
    </>
  );
}

function StatsStrip({
  isZh,
  stats,
}: {
  isZh: boolean;
  stats: { total: number; active: number; watch: number; dormant: number };
}) {
  const items = [
    { label: isZh ? "总数" : "Total", value: stats.total },
    { label: isZh ? "活跃" : "Active", value: stats.active },
    { label: isZh ? "关注" : "Watch", value: stats.watch },
    { label: isZh ? "沉睡" : "Dormant", value: stats.dormant },
  ];

  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4"
      style={{
        padding: "16px 0",
        borderTop: "1px solid var(--color-codex-line)",
        borderBottom: "1px solid var(--color-codex-line)",
        marginBottom: 22,
      }}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          style={{
            padding: "0 22px",
            borderLeft: index > 0 ? "1px solid var(--color-codex-line-soft)" : "none",
          }}
        >
          <div style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)", marginBottom: 6 }}>{item.label}</div>
          <span
            className="codex-mono codex-num"
            style={{ fontSize: 22, color: "var(--color-codex-ink)", fontWeight: 500 }}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ClientTableRow({
  client,
  isZh,
  onOpen,
}: {
  client: Client;
  isZh: boolean;
  onOpen: () => void;
}) {
  const health = getClientHealth(client);
  const status = healthCopy(health, isZh);
  const recentDate = client.client_memory_updated_at || client.created_at;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="row-hov cx-no-hover grid w-full text-left"
      style={{
        minWidth: CLIENT_TABLE_MIN_WIDTH,
        gridTemplateColumns: CLIENT_GRID,
        gap: 12,
        alignItems: "center",
        padding: "14px 8px",
        borderTop: "1px solid var(--color-codex-line-soft)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="inline-flex shrink-0 items-center justify-center"
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--codex-r-pill, 999px)",
            background: "var(--color-codex-accent-bg)",
            color: "var(--color-codex-accent-ink)",
            fontSize: 13,
            fontWeight: 500,
          }}
          aria-hidden="true"
        >
          {getAvatarText(client.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-codex-ink)" }}>
            {client.name}
          </div>
          <div className="truncate" style={{ fontSize: 11.5, color: "var(--color-codex-ink-mute)", marginTop: 2 }}>
            {getClientShortName(client.name)}
          </div>
        </div>
      </div>
      <div className="truncate" style={{ fontSize: 13, color: "var(--color-codex-ink-soft)" }}>
        {client.industry || (isZh ? "未记录" : "Unknown")}
      </div>
      <div className="truncate" style={{ fontSize: 13, color: "var(--color-codex-ink-soft)" }}>
        {inferRegion(client, isZh)}
      </div>
      <div className="codex-mono codex-num" style={{ fontSize: 13, color: "var(--color-codex-ink)" }}>
        {client.project_names.length}
      </div>
      <div style={{ fontSize: 12, color: "var(--color-codex-ink-mute)" }}>{formatRelativeActivity(recentDate, isZh)}</div>
      <div>
        <CxStatus tone={status.tone}>{status.label}</CxStatus>
      </div>
      <ArrowRight size={12} strokeWidth={1.5} style={{ color: "var(--color-codex-ink-faint)" }} aria-hidden="true" />
    </button>
  );
}

function EmptyClientsState({
  hasSearch,
  isZh,
  onClear,
  onCreate,
}: {
  hasSearch: boolean;
  isZh: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  return (
    <div
      className="text-center"
      style={{
        padding: "72px 24px",
        borderTop: "1px solid var(--color-codex-line-soft)",
        color: "var(--color-codex-ink-mute)",
      }}
    >
      <Building2 className="mx-auto mb-3 h-8 w-8" style={{ color: "var(--color-codex-ink-faint)" }} />
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--color-codex-ink)" }}>
        {hasSearch ? (isZh ? "没有匹配的客户" : "No matching clients") : isZh ? "还没有客户" : "No clients yet"}
      </h2>
      <p style={{ margin: "6px auto 0", maxWidth: 420, fontSize: 13 }}>
        {hasSearch
          ? isZh
            ? "试试换一个关键词，或者清空搜索后重新查看客户池。"
            : "Try another keyword, or clear search to review the full client pool."
          : isZh
            ? "新建第一个客户后，就可以把项目、联系人和客户记忆串起来。"
            : "Create your first client to connect projects, contacts, and client memory."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {hasSearch ? (
          <button
            type="button"
            onClick={onClear}
            style={{
              padding: "7px 12px",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-sm, 3px)",
              color: "var(--color-codex-ink-soft)",
            }}
          >
            {isZh ? "清空搜索" : "Clear search"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5"
          style={{
            padding: "7px 12px",
            borderRadius: "var(--codex-r-sm, 3px)",
            background: "var(--color-codex-ink)",
            color: "var(--color-codex-bg-elev)",
          }}
        >
          <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
          {isZh ? "新建客户" : "New client"}
        </button>
      </div>
    </div>
  );
}

function ClientsLoading({ title }: { title: string }) {
  return (
    <>
      <PageTitle title={title} />
      <CxTopProgress />
      <div style={{ padding: "32px clamp(24px, 4vw, 56px) 40px" }}>
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <CxSkeleton w={110} h={30} />
            <div className="mt-3">
              <CxSkeleton w={240} h={13} />
            </div>
          </div>
          <CxSkeleton w={330} h={32} />
        </div>
        <div
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{
            padding: "16px 0",
            borderTop: "1px solid var(--color-codex-line)",
            borderBottom: "1px solid var(--color-codex-line)",
            marginBottom: 22,
          }}
        >
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              style={{ padding: "0 22px", borderLeft: item > 0 ? "1px solid var(--color-codex-line-soft)" : "none" }}
            >
              <CxSkeleton w={48} h={11} />
              <div className="mt-2">
                <CxSkeleton w={32} h={24} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: CLIENT_TABLE_MIN_WIDTH }}>
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div
                key={item}
                className="grid items-center"
                style={{
                  gridTemplateColumns: CLIENT_GRID,
                  gap: 12,
                  padding: "14px 8px",
                  borderTop: "1px solid var(--color-codex-line-soft)",
                }}
              >
                <div className="flex items-center gap-3">
                  <CxSkeleton w={32} h={32} radius={999} />
                  <div className="min-w-0 flex-1">
                    <CxSkeleton w="56%" h={14} />
                    <div className="mt-2">
                      <CxSkeleton w="38%" h={11} />
                    </div>
                  </div>
                </div>
                <CxSkeleton w={72} h={12} />
                <CxSkeleton w={48} h={12} />
                <CxSkeleton w={18} h={12} />
                <CxSkeleton w={58} h={12} />
                <CxSkeleton w={64} h={14} />
                <CxSkeleton w={12} h={12} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function CreateClientModal({
  aiError,
  aiLoading,
  aiQuery,
  aiSuggestions,
  creating,
  form,
  isZh,
  onAiQueryChange,
  onAiSuggest,
  onClose,
  onFormChange,
  onSubmit,
  onSuggestionSelect,
}: {
  aiError: string | null;
  aiLoading: boolean;
  aiQuery: string;
  aiSuggestions: ClientSuggestion[];
  creating: boolean;
  form: { name: string; industry: string; contact: string; notes: string };
  isZh: boolean;
  onAiQueryChange: (value: string) => void;
  onAiSuggest: () => void;
  onClose: () => void;
  onFormChange: (value: { name: string; industry: string; contact: string; notes: string }) => void;
  onSubmit: () => void;
  onSuggestionSelect: (suggestion: ClientSuggestion) => void;
}) {
  return (
    <div className="theme-codex fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(26,24,21,.36)" }}>
      <div
        className="w-full max-w-xl"
        style={{
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 6px)",
          boxShadow: "0 12px 36px -8px rgba(0,0,0,0.18), 0 0 0 1px var(--color-codex-line)",
        }}
      >
        <div
          className="flex items-start justify-between gap-4"
          style={{ padding: "18px 20px", borderBottom: "1px solid var(--color-codex-line-soft)" }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                color: "var(--color-codex-ink)",
              }}
            >
              {isZh ? "新建客户" : "New client"}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--color-codex-ink-mute)" }}>
              {isZh
                ? "先录入基础档案，再逐步补全项目、联系人和客户记忆。"
                : "Start with the basics, then enrich projects, contacts, and memory."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cx-no-hover inline-flex items-center justify-center"
            style={{ width: 28, height: 28, color: "var(--color-codex-ink-mute)", borderRadius: "var(--codex-r-sm, 3px)" }}
            aria-label={isZh ? "关闭" : "Close"}
          >
            <X size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4" style={{ padding: 20 }}>
          <div
            style={{
              padding: 14,
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-sm, 3px)",
              background: "var(--color-codex-bg)",
            }}
          >
            <label style={{ marginBottom: 7, display: "block", fontSize: 12, color: "var(--color-codex-ink-soft)" }}>
              {isZh ? "AI 智能补全" : "AI auto-fill"}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={aiQuery}
                onChange={(event) => onAiQueryChange(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), onAiSuggest())}
                placeholder={isZh ? "输入公司名称或一句业务描述..." : "Company name or short business description..."}
                className="codex-input min-w-0 flex-1"
                style={{
                  padding: "8px 10px",
                  border: "1px solid var(--color-codex-line)",
                  borderRadius: "var(--codex-r-sm, 3px)",
                  background: "var(--color-codex-bg-elev)",
                  color: "var(--color-codex-ink)",
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                onClick={onAiSuggest}
                disabled={aiLoading || !aiQuery.trim()}
                className="inline-flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  padding: "8px 12px",
                  borderRadius: "var(--codex-r-sm, 3px)",
                  background: "var(--color-codex-ink)",
                  color: "var(--color-codex-bg-elev)",
                  fontSize: 12.5,
                }}
              >
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {isZh ? "生成建议" : "Generate"}
              </button>
            </div>
            {aiError ? <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-codex-bad)" }}>{aiError}</p> : null}
            {aiSuggestions.length > 0 ? (
              <div className="mt-3 space-y-2">
                {aiSuggestions.map((suggestion, index) => (
                  <button
                    key={`${suggestion.name}-${index}`}
                    type="button"
                    onClick={() => onSuggestionSelect(suggestion)}
                    className="row-hov cx-no-hover w-full text-left"
                    style={{
                      padding: "10px 12px",
                      border: "1px solid var(--color-codex-line-soft)",
                      borderRadius: "var(--codex-r-sm, 3px)",
                      background: "var(--color-codex-bg-elev)",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--color-codex-ink)" }}>{suggestion.name}</p>
                    <p className="truncate" style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-codex-ink-mute)" }}>
                      {[suggestion.industry, suggestion.notes].filter(Boolean).join(" · ")}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <FormField label={isZh ? "客户名称" : "Client name"} required>
            <TextInput
              value={form.name}
              onChange={(value) => onFormChange({ ...form, name: value })}
              placeholder={isZh ? "请输入客户名称" : "Enter client name"}
            />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={isZh ? "行业" : "Industry"}>
              <TextInput
                value={form.industry}
                onChange={(value) => onFormChange({ ...form, industry: value })}
                placeholder={isZh ? "如：互联网、制造业" : "e.g. SaaS, Manufacturing"}
              />
            </FormField>
            <FormField label={isZh ? "联系人" : "Contact"}>
              <TextInput
                value={form.contact}
                onChange={(value) => onFormChange({ ...form, contact: value })}
                placeholder={isZh ? "如：张三 / 13800000000" : "e.g. Jane Doe / +1 555..."}
              />
            </FormField>
          </div>

          <FormField label={isZh ? "备注" : "Notes"}>
            <textarea
              value={form.notes}
              onChange={(event) => onFormChange({ ...form, notes: event.target.value })}
              placeholder={isZh ? "补充背景、合作目标、关键关系人或风险线索..." : "Add background, goals, stakeholders, or risk signals..."}
              rows={4}
              className="codex-input w-full resize-none"
              style={{
                padding: "8px 10px",
                border: "1px solid var(--color-codex-line)",
                borderRadius: "var(--codex-r-sm, 3px)",
                background: "var(--color-codex-bg-elev)",
                color: "var(--color-codex-ink)",
                fontSize: 13,
              }}
            />
          </FormField>
        </div>

        <div
          className="flex justify-end gap-2"
          style={{ padding: "14px 20px", borderTop: "1px solid var(--color-codex-line-soft)", background: "var(--color-codex-bg)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            style={{
              padding: "7px 12px",
              border: "1px solid var(--color-codex-line)",
              borderRadius: "var(--codex-r-sm, 3px)",
              color: "var(--color-codex-ink-soft)",
              background: "var(--color-codex-bg-elev)",
              fontSize: 12.5,
            }}
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={creating}
            className="inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{
              padding: "7px 12px",
              borderRadius: "var(--codex-r-sm, 3px)",
              background: "var(--color-codex-ink)",
              color: "var(--color-codex-bg-elev)",
              fontSize: 12.5,
            }}
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isZh ? "确认创建" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  children,
  label,
  required = false,
}: {
  children: ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div style={{ marginBottom: 6, fontSize: 12.5, color: "var(--color-codex-ink-soft)" }}>
        {label}
        {required ? <span style={{ marginLeft: 4, color: "var(--color-codex-bad)" }}>*</span> : null}
      </div>
      {children}
    </label>
  );
}

function TextInput({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="codex-input w-full"
      style={{
        padding: "8px 10px",
        border: "1px solid var(--color-codex-line)",
        borderRadius: "var(--codex-r-sm, 3px)",
        background: "var(--color-codex-bg-elev)",
        color: "var(--color-codex-ink)",
        fontSize: 13,
      }}
    />
  );
}
