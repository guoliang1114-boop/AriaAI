import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
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
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  const remove = async (stakeholderId: number) => {
    if (!clientId) return;
    setDeletingId(stakeholderId);
    try {
      await api.delete(`/clients/${clientId}/stakeholders/${stakeholderId}`);
      await refresh();
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
              ? "把客户关键人从自由文本升级为可维护对象，后续 AI 总结和客户记忆都可以稳定读取。"
              : "Turn free-form contact notes into maintainable records that summaries and client memory can reuse."}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          {stakeholders.length} {isZh ? "人" : "people"}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Input
          label={isZh ? "姓名" : "Name"}
          onChange={(value) => setDraft({ ...draft, name: value })}
          placeholder={isZh ? "例如：张总" : "e.g. Jane"}
          value={draft.name}
        />
        <Input
          label={isZh ? "角色" : "Role"}
          onChange={(value) => setDraft({ ...draft, role: value })}
          placeholder={isZh ? "业务决策人 / 财务 / IT" : "Decision maker / Finance / IT"}
          value={draft.role}
        />
        <Input
          label={isZh ? "影响类型" : "Influence type"}
          onChange={(value) => setDraft({ ...draft, influence_type: value })}
          placeholder={isZh ? "决策 / 使用 / 采购 / 安全" : "Decision / User / Procurement / Security"}
          value={draft.influence_type}
        />
        <Input
          label={isZh ? "关系状态" : "Relationship"}
          onChange={(value) => setDraft({ ...draft, relationship_status: value })}
          placeholder={isZh ? "支持 / 中立 / 阻力 / 未知" : "Supportive / Neutral / Blocked / Unknown"}
          value={draft.relationship_status}
        />
        <Input
          label={isZh ? "沟通偏好" : "Communication preference"}
          onChange={(value) => setDraft({ ...draft, communication_preference: value })}
          placeholder={isZh ? "微信短消息 / 周会 / 邮件确认" : "WeChat / weekly sync / email confirmation"}
          value={draft.communication_preference}
        />
        <Input
          label={isZh ? "联系方式" : "Contact"}
          onChange={(value) => setDraft({ ...draft, contact: value })}
          placeholder={isZh ? "电话、邮箱或微信" : "Phone, email, or handle"}
          value={draft.contact}
        />
        <Textarea
          label={isZh ? "关注点" : "Concerns"}
          onChange={(value) => setDraft({ ...draft, concerns: value })}
          placeholder={isZh ? "预算、上线周期、内部协同..." : "Budget, launch timeline, internal alignment..."}
          value={draft.concerns}
        />
        <Textarea
          label={isZh ? "备注 / 下一步" : "Notes / next action"}
          onChange={(value) => setDraft({ ...draft, note: value })}
          placeholder={isZh ? "需要确认的问题、最近动作或禁区" : "Questions to confirm, recent actions, or watch-outs"}
          value={draft.note}
        />
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={!clientId || !draft.name.trim() || saving}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:bg-gray-300"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {isZh ? "新增干系人" : "Add stakeholder"}
      </button>

      <div className="mt-5 grid gap-3">
        {stakeholders.length ? (
          stakeholders.map((stakeholder) => (
            <article key={stakeholder.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-gray-950">{stakeholder.name}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {[stakeholder.role, stakeholder.influence_type, stakeholder.relationship_status].filter(Boolean).join(" · ") ||
                      (isZh ? "角色待补充" : "Role missing")}
                  </div>
                </div>
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
              <div className="mt-3 text-sm leading-6 text-gray-600">
                {stakeholder.concerns || stakeholder.note || stakeholder.communication_preference || (isZh ? "暂无补充信息" : "No extra detail yet")}
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
            {isZh ? "还没有结构化干系人。先新增一位客户关键人。" : "No structured stakeholders yet. Add the first client contact above."}
          </div>
        )}
      </div>
    </section>
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
