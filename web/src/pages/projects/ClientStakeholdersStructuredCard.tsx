import { Brain, Check, Clock, Edit3, Loader2, Plus, Trash2, Users, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { ClientStakeholder } from "../../types/api";
import { formatDateOnly } from "../../utils/timezone";

type StakeholderDraft = Pick<
  ClientStakeholder,
  | "communication_preference"
  | "concerns"
  | "contact"
  | "influence_type"
  | "last_action"
  | "name"
  | "note"
  | "organization_level"
  | "personality_profile"
  | "decision_style"
  | "communication_strategy"
  | "trust_signals"
  | "relationship_status"
  | "role"
  | "sensitivities"
>;

const emptyDraft: StakeholderDraft = {
  communication_preference: "",
  concerns: "",
  contact: "",
  influence_type: "",
  last_action: "",
  name: "",
  note: "",
  organization_level: "",
  personality_profile: "",
  decision_style: "",
  communication_strategy: "",
  trust_signals: "",
  relationship_status: "unknown",
  role: "",
  sensitivities: "",
};

const relationshipStyles: Record<string, string> = {
  blocked: "border-codex-line bg-codex-bg-tint text-codex-bad",
  neutral: "border-codex-line bg-codex-bg-tint text-codex-warn",
  supportive: "border-codex-line bg-codex-accent-bg text-codex-good",
  unknown: "border-codex-line bg-codex-bg-tint text-codex-ink-soft",
};

export function ClientStakeholdersStructuredCard({
  clientId,
  isZh,
  onChanged,
  projectId,
  stakeholders,
}: {
  clientId?: number;
  isZh: boolean;
  onChanged: (stakeholders: ClientStakeholder[]) => void;
  projectId?: number | string;
  stakeholders: ClientStakeholder[];
}) {
  const [draft, setDraft] = useState<StakeholderDraft>(emptyDraft);
  const [editDraft, setEditDraft] = useState<StakeholderDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<Array<{field_name: string; old_value: string; new_value: string; trigger: string; changed_at: string}>>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchHistory = useCallback(async (stakeholderId: number) => {
    if (historyId === stakeholderId) { setHistoryId(null); return; }
    setHistoryId(stakeholderId);
    setLoadingHistory(true);
    try {
      const data = await api.get(`/clients/${clientId}/stakeholders/${stakeholderId}/history`);
      setHistoryData(data as typeof historyData);
    } catch {
      setHistoryData([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [clientId, historyId]);

  const grouped = useMemo(() => {
    const byInfluence = new Map<string, number>();
    const byRelationship = new Map<string, number>();
    stakeholders.forEach((stakeholder) => {
      const influence = stakeholder.influence_type?.trim() || (isZh ? "未分类" : "Uncategorized");
      const relationship = stakeholder.relationship_status?.trim() || "unknown";
      byInfluence.set(influence, (byInfluence.get(influence) || 0) + 1);
      byRelationship.set(relationship, (byRelationship.get(relationship) || 0) + 1);
    });
    return {
      influence: Array.from(byInfluence.entries()),
      relationship: Array.from(byRelationship.entries()),
    };
  }, [isZh, stakeholders]);

  const refresh = async () => {
    if (!clientId) return;
    const data = await api.get<ClientStakeholder[]>(`/clients/${clientId}/stakeholders`);
    onChanged(data);
  };

  const save = async () => {
    if (!clientId || !draft.name.trim()) return;
    setSaving(true);
    try {
      await api.post<ClientStakeholder>(`/clients/${clientId}/stakeholders`, {
        ...draft,
        name: draft.name.trim(),
      });
      setDraft(emptyDraft);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (stakeholder: ClientStakeholder) => {
    setEditingId(stakeholder.id);
    setEditDraft({
      communication_preference: stakeholder.communication_preference || "",
      concerns: stakeholder.concerns || "",
      contact: stakeholder.contact || "",
      influence_type: stakeholder.influence_type || "",
      last_action: stakeholder.last_action || "",
      name: stakeholder.name || "",
      note: stakeholder.note || "",
      organization_level: stakeholder.organization_level || "",
      personality_profile: stakeholder.personality_profile || "",
      decision_style: stakeholder.decision_style || "",
      communication_strategy: stakeholder.communication_strategy || "",
      trust_signals: stakeholder.trust_signals || "",
      relationship_status: stakeholder.relationship_status || "unknown",
      role: stakeholder.role || "",
      sensitivities: stakeholder.sensitivities || "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(emptyDraft);
  };

  const update = async () => {
    if (!clientId || !editingId || !editDraft.name.trim()) return;
    setSavingEdit(true);
    try {
      await api.put<ClientStakeholder>(`/clients/${clientId}/stakeholders/${editingId}`, {
        ...editDraft,
        name: editDraft.name.trim(),
      });
      cancelEdit();
      await refresh();
    } finally {
      setSavingEdit(false);
    }
  };

  const remove = async (stakeholderId: number) => {
    if (!clientId) return;
    setDeletingId(stakeholderId);
    try {
      await api.delete(`/clients/${clientId}/stakeholders/${stakeholderId}`);
      await refresh();
      if (editingId === stakeholderId) cancelEdit();
    } finally {
      setDeletingId(null);
    }
  };

  const analyze = async (stakeholderId: number) => {
    if (!projectId) return;
    setAnalyzingId(stakeholderId);
    try {
      await api.post<ClientStakeholder>(`/projects/${projectId}/stakeholders/${stakeholderId}/analyze`, {});
      await refresh();
    } finally {
      setAnalyzingId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-codex-line-soft bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-codex-good" />
            <h2 className="text-lg font-semibold text-codex-ink">
              {isZh ? "客户干系人维护" : "Client stakeholders"}
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-codex-ink-mute">
            {isZh
              ? "维护客户关键人、影响类型、关系状态和关注点。这里的数据会进入 AI 项目总结、客户记忆和 Skill 上下文。"
              : "Maintain client contacts, influence type, relationship status, and concerns. These records feed AI summaries, client memory, and skill context."}
          </p>
        </div>
        <span className="rounded-full bg-codex-accent-bg px-3 py-1 text-xs font-medium text-codex-good">
          {stakeholders.length} {isZh ? "人" : "people"}
        </span>
      </div>

      <StakeholderGroups grouped={grouped} isZh={isZh} />

      <div className="mt-5 rounded-2xl border border-codex-line-soft bg-codex-bg-tint p-4">
        <div className="text-sm font-semibold text-codex-ink">{isZh ? "新增干系人" : "Add stakeholder"}</div>
        <StakeholderForm draft={draft} isZh={isZh} onChange={setDraft} />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!clientId || !draft.name.trim() || saving}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-codex-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-codex-good disabled:bg-codex-bg-tint"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {isZh ? "新增干系人" : "Add stakeholder"}
        </button>
      </div>

      <div className="mt-5 grid gap-3">
        {stakeholders.length ? (
          stakeholders.map((stakeholder) => {
            const isEditing = editingId === stakeholder.id;
            return (
              <article key={stakeholder.id} className="rounded-2xl border border-codex-line-soft bg-codex-bg-tint p-4">
                {isEditing ? (
                  <>
                    <StakeholderForm draft={editDraft} isZh={isZh} onChange={setEditDraft} />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void update()}
                        disabled={!editDraft.name.trim() || savingEdit}
                        className="inline-flex items-center gap-2 rounded-xl bg-codex-good px-4 py-2 text-sm font-medium text-white transition hover:bg-codex-good disabled:bg-codex-bg-tint"
                      >
                        {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {isZh ? "保存修改" : "Save changes"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        className="inline-flex items-center gap-2 rounded-xl border border-codex-line bg-white px-4 py-2 text-sm font-medium text-codex-ink-soft transition hover:bg-codex-bg-tint disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        {isZh ? "取消" : "Cancel"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-codex-ink">{stakeholder.name}</div>
                        <div className="mt-1 text-xs text-codex-ink-mute">
                          {[stakeholder.role, stakeholder.influence_type, stakeholder.organization_level].filter(Boolean).join(" · ") ||
                            (isZh ? "角色待补充" : "Role missing")}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {projectId ? (
                          <button
                            type="button"
                            onClick={() => void analyze(stakeholder.id)}
                            disabled={analyzingId === stakeholder.id}
                            className="rounded-lg p-1.5 text-codex-ink-faint transition hover:bg-white hover:text-codex-accent disabled:opacity-50"
                            aria-label={isZh ? "AI 分析联系人" : "Analyze contact"}
                            title={isZh ? "AI 分析联系人性格与沟通方式" : "Analyze personality and communication"}
                          >
                            {analyzingId === stakeholder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void fetchHistory(stakeholder.id)}
                          className={`rounded-lg p-1.5 transition hover:bg-white ${historyId === stakeholder.id ? 'text-codex-accent bg-white' : 'text-codex-ink-faint hover:text-codex-accent'}`}
                          aria-label={isZh ? "变更历史" : "Change history"}
                          title={isZh ? "查看变更历史" : "View change history"}
                        >
                          <Clock className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => beginEdit(stakeholder)}
                          className="rounded-lg p-1.5 text-codex-ink-faint transition hover:bg-white hover:text-codex-good"
                          aria-label={isZh ? "编辑干系人" : "Edit stakeholder"}
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(stakeholder.id)}
                          disabled={deletingId === stakeholder.id}
                          className="rounded-lg p-1.5 text-codex-ink-faint transition hover:bg-white hover:text-codex-bad disabled:opacity-50"
                          aria-label={isZh ? "删除干系人" : "Delete stakeholder"}
                        >
                          {deletingId === stakeholder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge value={stakeholder.relationship_status || "unknown"} />
                      {stakeholder.communication_preference ? <Badge value={stakeholder.communication_preference} muted /> : null}
                    </div>
                    <div className="mt-3 text-sm leading-6 text-codex-ink-soft">
                      {stakeholder.concerns || stakeholder.note || stakeholder.last_action || (isZh ? "暂无补充信息" : "No extra detail yet")}
                    </div>
                    {stakeholder.personality_profile || stakeholder.decision_style || stakeholder.communication_strategy || stakeholder.trust_signals ? (
                      <div className="mt-4 grid gap-2 rounded-xl border border-codex-line-soft bg-codex-accent-bg/60 p-3 text-sm leading-6 text-codex-ink-soft md:grid-cols-2">
                        <Insight label={isZh ? "性格画像" : "Personality"} value={stakeholder.personality_profile} />
                        <Insight label={isZh ? "决策风格" : "Decision style"} value={stakeholder.decision_style} />
                        <Insight label={isZh ? "沟通策略" : "Communication strategy"} value={stakeholder.communication_strategy} />
                        <Insight label={isZh ? "信任信号" : "Trust signals"} value={stakeholder.trust_signals} />
                      </div>
                    ) : null}
                    {historyId === stakeholder.id && (
                      <div className="mt-3 rounded-xl border border-codex-line bg-white p-3">
                        <div className="text-xs font-semibold text-codex-ink-mute mb-2">
                          {isZh ? "变更历史" : "Change History"}
                        </div>
                        {loadingHistory ? (
                          <div className="flex items-center gap-2 py-2 text-xs text-codex-ink-faint">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {isZh ? "加载中..." : "Loading..."}
                          </div>
                        ) : historyData.length === 0 ? (
                          <div className="py-2 text-xs text-codex-ink-faint">{isZh ? "暂无变更记录" : "No changes recorded yet"}</div>
                        ) : (
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {historyData.map((h, i) => (
                              <div key={i} className="flex gap-2 text-xs">
                                <div className="flex-shrink-0 w-1 rounded-full bg-primary/20" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-codex-ink-soft">{h.field_name}</span>
                                    <span className={`rounded px-1 py-0.5 text-[9px] ${h.trigger === 'ai_analyze' ? 'bg-codex-accent-bg text-codex-accent' : 'bg-codex-bg-tint text-codex-ink-mute'}`}>
                                      {h.trigger === 'ai_analyze' ? 'AI' : h.trigger}
                                    </span>
                                    <span className="ml-auto text-codex-ink-faint flex-shrink-0">{formatDateOnly(h.changed_at)}</span>
                                  </div>
                                  {h.old_value && <div className="text-codex-ink-faint line-clamp-1">{isZh ? "原" : "was"}: {h.old_value}</div>}
                                  <div className="text-codex-ink-soft line-clamp-1">{isZh ? "改为" : "now"}: {h.new_value}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-codex-line bg-codex-bg-tint p-5 text-sm text-codex-ink-mute">
            {isZh ? "还没有结构化干系人。先新增一位客户关键人。" : "No structured stakeholders yet. Add the first client contact above."}
          </div>
        )}
      </div>
    </section>
  );
}

function StakeholderGroups({
  grouped,
  isZh,
}: {
  grouped: {
    influence: Array<[string, number]>;
    relationship: Array<[string, number]>;
  };
  isZh: boolean;
}) {
  if (!grouped.influence.length && !grouped.relationship.length) return null;
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <GroupPanel title={isZh ? "按影响类型" : "By influence"} items={grouped.influence} />
      <GroupPanel title={isZh ? "按关系状态" : "By relationship"} items={grouped.relationship} relationship />
    </div>
  );
}

function GroupPanel({
  items,
  relationship,
  title,
}: {
  items: Array<[string, number]>;
  relationship?: boolean;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-codex-line-soft bg-codex-accent-bg/50 p-4">
      <div className="text-xs font-semibold text-codex-good">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map(([label, count]) => (
          <span
            key={label}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              relationship ? relationshipStyles[label.toLowerCase()] || relationshipStyles.unknown : "border-codex-line bg-white text-codex-good"
            }`}
          >
            {label} · {count}
          </span>
        ))}
      </div>
    </div>
  );
}

function StakeholderForm({
  draft,
  isZh,
  onChange,
}: {
  draft: StakeholderDraft;
  isZh: boolean;
  onChange: (draft: StakeholderDraft) => void;
}) {
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <Input
        label={isZh ? "姓名" : "Name"}
        onChange={(value) => onChange({ ...draft, name: value })}
        placeholder={isZh ? "例如：张总" : "e.g. Jane"}
        value={draft.name}
      />
      <Input
        label={isZh ? "角色" : "Role"}
        onChange={(value) => onChange({ ...draft, role: value })}
        placeholder={isZh ? "业务决策人 / 财务 / IT" : "Decision maker / Finance / IT"}
        value={draft.role}
      />
      <Input
        label={isZh ? "组织层级" : "Org level"}
        onChange={(value) => onChange({ ...draft, organization_level: value })}
        placeholder={isZh ? "集团 / 部门 / 项目组" : "Group / department / project team"}
        value={draft.organization_level}
      />
      <Input
        label={isZh ? "影响类型" : "Influence type"}
        onChange={(value) => onChange({ ...draft, influence_type: value })}
        placeholder={isZh ? "决策 / 使用 / 采购 / 安全" : "Decision / User / Procurement / Security"}
        value={draft.influence_type}
      />
      <Input
        label={isZh ? "关系状态" : "Relationship"}
        onChange={(value) => onChange({ ...draft, relationship_status: value })}
        placeholder={isZh ? "supportive / neutral / blocked / unknown" : "supportive / neutral / blocked / unknown"}
        value={draft.relationship_status}
      />
      <Input
        label={isZh ? "沟通偏好" : "Communication preference"}
        onChange={(value) => onChange({ ...draft, communication_preference: value })}
        placeholder={isZh ? "微信短消息 / 周会 / 邮件确认" : "WeChat / weekly sync / email confirmation"}
        value={draft.communication_preference}
      />
      <Input
        label={isZh ? "联系方式" : "Contact"}
        onChange={(value) => onChange({ ...draft, contact: value })}
        placeholder={isZh ? "电话、邮箱或微信" : "Phone, email, or handle"}
        value={draft.contact}
      />
      <Input
        label={isZh ? "最近动作" : "Last action"}
        onChange={(value) => onChange({ ...draft, last_action: value })}
        placeholder={isZh ? "上次沟通、待确认事项" : "Last touch or pending ask"}
        value={draft.last_action}
      />
      <Textarea
        label={isZh ? "性格画像" : "Personality profile"}
        onChange={(value) => onChange({ ...draft, personality_profile: value })}
        placeholder={isZh ? "例如：谨慎、重视证据、偏好先小范围验证" : "e.g. cautious, evidence-driven, prefers pilots"}
        value={draft.personality_profile}
      />
      <Textarea
        label={isZh ? "决策风格" : "Decision style"}
        onChange={(value) => onChange({ ...draft, decision_style: value })}
        placeholder={isZh ? "谁影响 TA、TA 如何判断风险和价值" : "How this person weighs risk, value, and influence"}
        value={draft.decision_style}
      />
      <Textarea
        label={isZh ? "沟通策略" : "Communication strategy"}
        onChange={(value) => onChange({ ...draft, communication_strategy: value })}
        placeholder={isZh ? "建议话术、节奏、材料形态和下一步推进方式" : "Recommended tone, cadence, materials, and next move"}
        value={draft.communication_strategy}
      />
      <Textarea
        label={isZh ? "信任信号 / 风险信号" : "Trust / risk signals"}
        onChange={(value) => onChange({ ...draft, trust_signals: value })}
        placeholder={isZh ? "哪些行为代表认可，哪些信号代表阻力" : "Signals of trust, resistance, or escalation"}
        value={draft.trust_signals}
      />
      <Textarea
        label={isZh ? "关注点" : "Concerns"}
        onChange={(value) => onChange({ ...draft, concerns: value })}
        placeholder={isZh ? "预算、上线周期、内部协同..." : "Budget, launch timeline, internal alignment..."}
        value={draft.concerns}
      />
      <Textarea
        label={isZh ? "敏感点 / 备注" : "Sensitivities / notes"}
        onChange={(value) => onChange({ ...draft, note: value })}
        placeholder={isZh ? "禁区、偏好、下一步建议" : "Watch-outs, preferences, next action"}
        value={draft.note}
      />
    </div>
  );
}

function Badge({ muted, value }: { muted?: boolean; value: string }) {
  const style = muted ? "border-codex-line bg-white text-codex-ink-soft" : relationshipStyles[value.toLowerCase()] || relationshipStyles.unknown;
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}>{value}</span>;
}

function Insight({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-codex-accent-ink">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-codex-ink-soft">{value}</div>
    </div>
  );
}

function Input({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-codex-ink-mute">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-codex-line bg-white px-3 py-2 text-sm outline-none transition focus:border-codex-line focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function Textarea({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-codex-ink-mute">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full resize-none rounded-xl border border-codex-line bg-white px-3 py-2 text-sm outline-none transition focus:border-codex-line focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}
