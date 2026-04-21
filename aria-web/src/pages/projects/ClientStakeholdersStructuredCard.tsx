import { Check, Edit3, Loader2, Plus, Trash2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api/client";
import type { ClientStakeholder } from "../../types/api";

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
  relationship_status: "unknown",
  role: "",
  sensitivities: "",
};

const relationshipStyles: Record<string, string> = {
  blocked: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-amber-200 bg-amber-50 text-amber-700",
  supportive: "border-emerald-200 bg-emerald-50 text-emerald-700",
  unknown: "border-gray-200 bg-gray-50 text-gray-600",
};

export function ClientStakeholdersStructuredCard({
  clientId,
  isZh,
  onChanged,
  stakeholders,
}: {
  clientId?: number;
  isZh: boolean;
  onChanged: (stakeholders: ClientStakeholder[]) => void;
  stakeholders: ClientStakeholder[];
}) {
  const [draft, setDraft] = useState<StakeholderDraft>(emptyDraft);
  const [editDraft, setEditDraft] = useState<StakeholderDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  return (
    <section className="rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600" />
            <h2 className="text-lg font-semibold text-gray-950">
              {isZh ? "客户干系人维护" : "Client stakeholders"}
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            {isZh
              ? "维护客户关键人、影响类型、关系状态和关注点。这里的数据会进入 AI 项目总结、客户记忆和 Skill 上下文。"
              : "Maintain client contacts, influence type, relationship status, and concerns. These records feed AI summaries, client memory, and skill context."}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          {stakeholders.length} {isZh ? "人" : "people"}
        </span>
      </div>

      <StakeholderGroups grouped={grouped} isZh={isZh} />

      <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="text-sm font-semibold text-gray-900">{isZh ? "新增干系人" : "Add stakeholder"}</div>
        <StakeholderForm draft={draft} isZh={isZh} onChange={setDraft} />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!clientId || !draft.name.trim() || saving}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:bg-gray-300"
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
              <article key={stakeholder.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                {isEditing ? (
                  <>
                    <StakeholderForm draft={editDraft} isZh={isZh} onChange={setEditDraft} />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void update()}
                        disabled={!editDraft.name.trim() || savingEdit}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:bg-gray-300"
                      >
                        {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {isZh ? "保存修改" : "Save changes"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
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
                        <div className="font-semibold text-gray-950">{stakeholder.name}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {[stakeholder.role, stakeholder.influence_type, stakeholder.organization_level].filter(Boolean).join(" · ") ||
                            (isZh ? "角色待补充" : "Role missing")}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => beginEdit(stakeholder)}
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-white hover:text-emerald-600"
                          aria-label={isZh ? "编辑干系人" : "Edit stakeholder"}
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(stakeholder.id)}
                          disabled={deletingId === stakeholder.id}
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-white hover:text-rose-600 disabled:opacity-50"
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
                    <div className="mt-3 text-sm leading-6 text-gray-600">
                      {stakeholder.concerns || stakeholder.note || stakeholder.last_action || (isZh ? "暂无补充信息" : "No extra detail yet")}
                    </div>
                  </>
                )}
              </article>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
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
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map(([label, count]) => (
          <span
            key={label}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              relationship ? relationshipStyles[label.toLowerCase()] || relationshipStyles.unknown : "border-emerald-200 bg-white text-emerald-700"
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
  const style = muted ? "border-gray-200 bg-white text-gray-600" : relationshipStyles[value.toLowerCase()] || relationshipStyles.unknown;
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${style}`}>{value}</span>;
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
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
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
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}
