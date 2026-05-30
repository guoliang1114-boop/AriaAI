import { AlertTriangle, Building2, HelpCircle, MessageSquareText, Users } from "lucide-react";
import type { ProjectMemory } from "../../types/api";

type AnchorGroup = {
  description: string;
  items: string[];
  title: string;
  tone: string;
};

function uniqueItems(items: Array<string | undefined>) {
  return Array.from(new Set(items.map((item) => item?.trim()).filter(Boolean) as string[]));
}

function anchorGroups(memory: ProjectMemory | null, isZh: boolean): AnchorGroup[] {
  return [
    {
      title: isZh ? "风险锚点" : "Risk Anchors",
      description: isZh ? "长期需要盯住的风险判断" : "Risk calls that should stay visible",
      items: uniqueItems(memory?.key_risks_detail?.pinned || []),
      tone: "border-codex-line-soft bg-codex-bg-tint text-codex-bad",
    },
    {
      title: isZh ? "待确认问题" : "Open Questions",
      description: isZh ? "会影响推进的未决事项" : "Unresolved questions affecting progress",
      items: uniqueItems(memory?.open_questions_detail?.pinned || []),
      tone: "border-codex-line-soft bg-codex-bg-tint text-codex-warn",
    },
    {
      title: isZh ? "干系人提示" : "Stakeholder Notes",
      description: isZh ? "沟通偏好、敏感点和跟进提醒" : "Communication preferences and reminders",
      items: uniqueItems(memory?.stakeholder_notes_detail?.pinned || []),
      tone: "border-codex-line-soft bg-codex-accent-bg text-codex-accent-ink",
    },
  ];
}

function totalAnchors(groups: AnchorGroup[]) {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

export function ProjectAnchorsCard({
  clientContactsCount = 0,
  clientName,
  isZh,
  memory,
  onManage,
  compact = false,
}: {
  clientContactsCount?: number;
  clientName?: string;
  isZh: boolean;
  memory: ProjectMemory | null;
  onManage: () => void;
  compact?: boolean;
}) {
  const groups = anchorGroups(memory, isZh);
  const anchorCount = totalAnchors(groups);
  const stakeholderPinnedCount = groups[2]?.items.length || 0;
  const hasClient = Boolean(clientName?.trim());
  const hasClientContacts = clientContactsCount > 0;

  if (compact && anchorCount === 0 && !hasClient) return null;

  return (
    <section className="rounded-2xl border border-codex-line-soft bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-codex-good text-white shadow-sm">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-codex-ink">{isZh ? "项目关注锚点" : "Project Anchors"}</h3>
              <p className="mt-0.5 text-xs text-codex-ink-mute">
                {isZh
                  ? "固定内容会优先参与 AI 总结、风险判断和项目沟通。"
                  : "Pinned content is prioritized in AI summaries, risk judgment, and communication."}
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onManage}
          className="rounded-xl border border-codex-line bg-white px-3 py-2 text-xs font-medium text-codex-good hover:bg-codex-accent-bg"
        >
          {isZh ? "管理固定项" : "Manage Anchors"}
        </button>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-3"}`}>
        {groups.map((group) => (
          <div key={group.title} className="rounded-xl border border-codex-line-soft bg-white/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-codex-ink">{group.title}</div>
                <div className="mt-0.5 text-xs text-codex-ink-mute">{group.description}</div>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${group.tone}`}>
                {group.items.length}
              </span>
            </div>
            {group.items.length ? (
              <ul className="mt-3 space-y-2">
                {group.items.slice(0, compact ? 2 : 3).map((item, index) => (
                  <li key={`${group.title}-${index}`} className="flex items-start gap-2 text-sm text-codex-ink-soft">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-codex-accent-bg0" />
                    <span className="line-clamp-2">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-codex-ink-faint">
                {isZh ? "暂无固定内容" : "No pinned items yet"}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-codex-line-soft bg-white/80 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-codex-ink">
          <Users className="h-4 w-4 text-codex-accent" />
          {isZh ? "客户侧干系人分析" : "Client-side Stakeholder Analysis"}
        </div>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg bg-codex-bg-tint p-3">
            <div className="text-xs text-codex-ink-mute">{isZh ? "关联客户" : "Linked Client"}</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-codex-ink">
              <Building2 className="h-4 w-4 text-codex-good" />
              <span className="truncate">{clientName || (isZh ? "未关联" : "Not linked")}</span>
            </div>
          </div>
          <div className="rounded-lg bg-codex-bg-tint p-3">
            <div className="text-xs text-codex-ink-mute">{isZh ? "客户联系人线索" : "Client Contact Signals"}</div>
            <div className="mt-1 text-lg font-semibold text-codex-ink">{clientContactsCount}</div>
            <div className="mt-1 text-xs text-codex-ink-mute">
              {isZh ? "来自客户记忆关键联系人" : "From client memory key contacts"}
            </div>
          </div>
          <div className="rounded-lg bg-codex-bg-tint p-3">
            <div className="text-xs text-codex-ink-mute">{isZh ? "建议动作" : "Suggested Action"}</div>
            <div className="mt-1 flex items-start gap-2 text-codex-ink-soft">
              {hasClientContacts && stakeholderPinnedCount ? (
                <>
                  <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-codex-good" />
                  <span>{isZh ? "围绕客户关键人和固定提示安排下一次沟通。" : "Plan the next touchpoint around client contacts and pinned notes."}</span>
                </>
              ) : stakeholderPinnedCount ? (
                <>
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-codex-warn" />
                  <span>{isZh ? "已有沟通提醒，建议到客户空间补齐联系人和角色。" : "Pinned reminders exist. Add client contacts and roles next."}</span>
                </>
              ) : hasClient ? (
                <>
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-codex-warn" />
                  <span>{isZh ? "从客户资料和 AI 观察中固定关键人偏好。" : "Pin key stakeholder preferences from client context and AI observations."}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-codex-bad" />
                  <span>{isZh ? "先关联客户，再补齐客户侧关键联系人。" : "Link a client, then capture client-side key contacts."}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
