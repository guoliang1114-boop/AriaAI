import { Brain, Building2, ExternalLink, Loader2, MessageSquareText, RefreshCw, Save, Users } from "lucide-react";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import type { ClientMemory, Project, ProjectMemory } from "../../types/api";
import { ProjectMemorySlotCard } from "./ProjectMemorySlotCard";

export interface ClientSummary {
  id: number;
  contact?: string;
  industry?: string;
  name: string;
}

export interface VisualContact {
  name: string;
  note: string;
  role: string;
  source: string;
}

export function normalizeClientName(value: string) {
  return value.trim().toLowerCase();
}

export function splitContactLines(value?: string) {
  return (value || "")
    .split(/\r?\n|[;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function BulletList({
  emptyText,
  items,
}: {
  emptyText: string;
  items: string[];
}) {
  if (!items.length) {
    return <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">{emptyText}</div>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm text-gray-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProjectStakeholdersHero({
  client,
  isZh,
  keyContactCount,
  onManageAnchors,
  onOpenClientMemory,
  pinnedCount,
  project,
  stakeholderScore,
}: {
  client: ClientSummary | null;
  isZh: boolean;
  keyContactCount: number;
  onManageAnchors: () => void;
  onOpenClientMemory: () => void;
  pinnedCount: number;
  project: Project;
  stakeholderScore: number;
}) {
  return (
    <section className="rounded-[1.75rem] border border-sky-100 bg-[radial-gradient(circle_at_top_right,#dff4ff_0%,#f8fbff_42%,#ffffff_100%)] p-6 shadow-sm">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-950">{isZh ? "客户侧干系人" : "Client-side Stakeholders"}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
              {isZh
                ? "聚合客户联系人、决策模式、敏感议题和固定沟通提醒，帮助判断下一步应该找谁确认、如何沟通。"
                : "Unifies client contacts, decision patterns, sensitivities, and pinned reminders to guide who to align with next."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onManageAnchors}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50"
          >
            <MessageSquareText className="h-4 w-4" />
            {isZh ? "管理沟通锚点" : "Manage anchors"}
          </button>
          <button
            type="button"
            onClick={onOpenClientMemory}
            disabled={!client}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-primary disabled:bg-gray-300"
          >
            <ExternalLink className="h-4 w-4" />
            {isZh ? "打开客户记忆" : "Open client memory"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {[
          { label: isZh ? "关联客户" : "Linked client", value: client?.name || project.client || (isZh ? "未关联" : "Not linked") },
          { label: isZh ? "关键联系人" : "Key contacts", value: keyContactCount },
          { label: isZh ? "固定提醒" : "Pinned reminders", value: pinnedCount },
          { label: isZh ? "覆盖度" : "Coverage", value: `${stakeholderScore}/4` },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
            <div className="text-xs font-medium text-gray-500">{item.label}</div>
            <div className="mt-2 truncate text-lg font-semibold text-gray-950">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StakeholderMaintenanceSection({
  client,
  contactDraft,
  isZh,
  onContactDraftChange,
  onSave,
  savingContact,
}: {
  client: ClientSummary | null;
  contactDraft: string;
  isZh: boolean;
  onContactDraftChange: (value: string) => void;
  onSave: () => void;
  savingContact: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">{isZh ? "维护客户干系人" : "Maintain client stakeholders"}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {isZh
              ? "在这里直接维护客户侧联系人线索。建议每行一个人，写清角色、影响点、联系方式或备注。"
              : "Maintain client-side contact signals here. One person per line with role, influence, contact, or notes."}
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!client || savingContact}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-primary disabled:bg-gray-300"
        >
          {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isZh ? "保存联系人" : "Save contacts"}
        </button>
      </div>
      <textarea
        value={contactDraft}
        onChange={(event) => onContactDraftChange(event.target.value)}
        rows={8}
        disabled={!client}
        className="mt-4 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:bg-gray-50 disabled:text-gray-400"
        placeholder={
          isZh
            ? "示例：张总 / 业务决策人 / 关注上线周期和预算风险 / 微信 xxx"
            : "Example: Jane / Business decision maker / cares about launch timeline and budget risk / email..."
        }
      />
      <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
        {isZh
          ? "保存后客户记忆会被标记为待刷新；刷新客户记忆后，AI 会把这些线索沉淀成关键联系人、决策模式和敏感议题。"
          : "After saving, client memory is marked stale. Refresh client memory to turn these signals into contacts, decision patterns, and sensitivities."}
      </div>
    </div>
  );
}

export function StakeholderRelationshipMap({
  client,
  isZh,
  project,
  visualContacts,
}: {
  client: ClientSummary | null;
  isZh: boolean;
  project: Project;
  visualContacts: VisualContact[];
}) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-[radial-gradient(circle_at_center,#ecfdf5_0%,#ffffff_55%,#f8fafc_100%)] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-950">{isZh ? "关系网络可视化" : "Relationship map"}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {isZh ? "中间是客户，周围是关键联系人或手动维护线索。" : "Client in the center, contacts and manual signals around it."}
          </p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700">
          {visualContacts.length} {isZh ? "个节点" : "nodes"}
        </span>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="flex min-h-[220px] items-center justify-center rounded-[2rem] border border-emerald-100 bg-white/90 p-5 text-center shadow-sm">
          <div>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-600 text-white">
              <Building2 className="h-8 w-8" />
            </div>
            <div className="mt-4 font-semibold text-gray-950">{client?.name || project.client || (isZh ? "未关联客户" : "No linked client")}</div>
            <div className="mt-1 text-xs text-gray-500">{client?.industry || (isZh ? "行业待补充" : "Industry missing")}</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {visualContacts.length ? (
            visualContacts.slice(0, 6).map((contact, index) => (
              <div
                key={`${contact.name}-${index}`}
                className="relative rounded-2xl border border-gray-100 bg-white/90 p-4 shadow-sm"
              >
                <div className="absolute -left-2 top-6 hidden h-px w-4 bg-emerald-200 lg:block" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-950">{contact.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{contact.role}</div>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                    {contact.source}
                  </span>
                </div>
                <div className="mt-3 line-clamp-3 text-sm leading-6 text-gray-600">{contact.note || (isZh ? "暂无备注" : "No note yet")}</div>
              </div>
            ))
          ) : (
            <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white/70 p-6 text-center text-sm text-gray-500 sm:col-span-2">
              {isZh ? "暂无可视化节点。先在左侧维护客户干系人。" : "No nodes yet. Add stakeholder contacts on the left first."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function StakeholderPinnedReminderEditor({
  isZh,
  memory,
  onSaved,
  projectId,
}: {
  isZh: boolean;
  memory: ProjectMemory | null;
  onSaved: (memory: ProjectMemory) => void;
  projectId: string;
}) {
  return (
    <ProjectMemorySlotCard
      description={
        isZh
          ? "固定客户侧关键人的偏好、敏感点、决策影响和沟通节奏。这里保存后会进入 AI 项目总结和聊天上下文。"
          : "Pin client-side preferences, sensitivities, influence, and cadence. These feed project summaries and chat context."
      }
      isZh={isZh}
      onSaved={onSaved}
      projectId={projectId}
      slotDetail={memory?.stakeholder_notes_detail}
      slotKey="stakeholder_notes"
      title={isZh ? "维护固定干系人提醒" : "Maintain pinned stakeholder reminders"}
    />
  );
}

export function ManualContactSignalsCard({
  isZh,
  manualContactLines,
}: {
  isZh: boolean;
  manualContactLines: string[];
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-950">{isZh ? "当前手动联系人线索" : "Current manual contact signals"}</h2>
      <div className="mt-4">
        <BulletList
          emptyText={isZh ? "还没有手动维护联系人。" : "No manual contacts yet."}
          items={manualContactLines}
        />
      </div>
    </div>
  );
}

export function StakeholderAiAnalysisCard({
  content,
  error,
  isZh,
  loading,
  onRefresh,
}: {
  content: string;
  error: string;
  isZh: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold text-gray-950">{isZh ? "AI 干系人分析" : "AI Stakeholder Analysis"}</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {isZh ? "聚焦关键人、对齐状态、未决问题和建议跟进。" : "Focuses on key people, alignment state, open issues, and follow-ups."}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {isZh ? "重新生成" : "Regenerate"}
        </button>
      </div>
      <div className="mt-4 min-h-[180px] rounded-2xl bg-gray-50 p-4 text-sm leading-7 text-gray-700">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isZh ? "正在整理干系人分析..." : "Preparing stakeholder analysis..."}
          </div>
        ) : error ? (
          <div className="text-red-600">{error}</div>
        ) : content ? (
          <div className="md-root">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <div className="text-gray-500">{isZh ? "暂无分析内容，点击重新生成获取最新判断。" : "No analysis yet. Regenerate to get the latest view."}</div>
        )}
      </div>
    </div>
  );
}

export function ClientRelationshipContextCard({
  decisionPatterns,
  isZh,
  sensitiveTopics,
}: {
  decisionPatterns: string[];
  isZh: boolean;
  sensitiveTopics: string[];
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-emerald-600" />
        <h2 className="text-lg font-semibold text-gray-950">{isZh ? "客户关系上下文" : "Client relationship context"}</h2>
      </div>
      <div className="mt-4 space-y-4">
        <div>
          <div className="text-xs font-medium text-gray-500">{isZh ? "决策模式" : "Decision patterns"}</div>
          <div className="mt-2">
            <BulletList
              emptyText={isZh ? "客户记忆尚未沉淀决策模式。" : "No decision patterns captured yet."}
              items={decisionPatterns.slice(0, 4)}
            />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500">{isZh ? "敏感议题" : "Sensitive topics"}</div>
          <div className="mt-2">
            <BulletList
              emptyText={isZh ? "客户记忆尚未沉淀敏感议题。" : "No sensitive topics captured yet."}
              items={sensitiveTopics.slice(0, 4)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClientKeyContactsCard({
  client,
  contacts,
  isZh,
}: {
  client: ClientSummary | null;
  contacts: ClientMemory["key_contacts"];
  isZh: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
      <h2 className="text-lg font-semibold text-gray-950">{isZh ? "客户关键联系人" : "Client key contacts"}</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {contacts.length ? (
          contacts.map((contact) => (
            <div key={`${contact.name}-${contact.role}`} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="font-medium text-gray-950">{contact.name || (isZh ? "未命名联系人" : "Unnamed contact")}</div>
              <div className="mt-1 text-xs text-gray-500">{contact.role || (isZh ? "角色待补充" : "Role missing")}</div>
              <div className="mt-3 text-sm leading-6 text-gray-700">{contact.note || (isZh ? "暂无备注" : "No note yet")}</div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-gray-50 p-5 text-sm text-gray-500 md:col-span-2">
            {client?.contact || (isZh ? "还没有客户关键联系人。建议先在客户资料或客户记忆中补充。" : "No client key contacts yet. Add them in the client record or client memory.")}
          </div>
        )}
      </div>
    </div>
  );
}

export function PinnedCommunicationRemindersCard({
  isZh,
  pinnedNotes,
}: {
  isZh: boolean;
  pinnedNotes: string[];
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-950">{isZh ? "固定沟通提醒" : "Pinned communication reminders"}</h2>
      <div className="mt-4">
        <BulletList
          emptyText={isZh ? "暂无固定提醒，建议到锚点页补充客户侧关键人的偏好和禁区。" : "No pinned reminders. Add preferences and sensitivities on the anchors page."}
          items={pinnedNotes}
        />
      </div>
    </div>
  );
}

export function StakeholderObservationsCard({
  aiNotes,
  isZh,
}: {
  aiNotes: string[];
  isZh: boolean;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-950">{isZh ? "AI 观察与建议池" : "AI observations and suggestion pool"}</h2>
      <div className="mt-4">
        <BulletList
          emptyText={isZh ? "暂无 AI 干系人观察。刷新项目记忆后会自动补充。" : "No AI stakeholder observations yet. Rebuild project memory to populate them."}
          items={aiNotes}
        />
      </div>
    </section>
  );
}
