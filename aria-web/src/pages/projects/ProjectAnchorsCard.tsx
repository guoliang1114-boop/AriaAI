import { AlertTriangle, HelpCircle, MessageSquareText, Users } from "lucide-react";
import type { ProjectMemory, ProjectMember } from "../../types/api";

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
      tone: "border-rose-100 bg-rose-50 text-rose-700",
    },
    {
      title: isZh ? "待确认问题" : "Open Questions",
      description: isZh ? "会影响推进的未决事项" : "Unresolved questions affecting progress",
      items: uniqueItems(memory?.open_questions_detail?.pinned || []),
      tone: "border-amber-100 bg-amber-50 text-amber-700",
    },
    {
      title: isZh ? "干系人提示" : "Stakeholder Notes",
      description: isZh ? "沟通偏好、敏感点和跟进提醒" : "Communication preferences and reminders",
      items: uniqueItems(memory?.stakeholder_notes_detail?.pinned || []),
      tone: "border-sky-100 bg-sky-50 text-sky-700",
    },
  ];
}

function totalAnchors(groups: AnchorGroup[]) {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

export function ProjectAnchorsCard({
  isZh,
  memory,
  members = [],
  onManage,
  compact = false,
}: {
  isZh: boolean;
  memory: ProjectMemory | null;
  members?: ProjectMember[];
  onManage: () => void;
  compact?: boolean;
}) {
  const groups = anchorGroups(memory, isZh);
  const anchorCount = totalAnchors(groups);
  const stakeholderPinnedCount = groups[2]?.items.length || 0;
  const hasMembers = members.length > 0;

  if (compact && anchorCount === 0 && !hasMembers) return null;

  return (
    <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-950">{isZh ? "项目关注锚点" : "Project Anchors"}</h3>
              <p className="mt-0.5 text-xs text-gray-500">
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
          className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
        >
          {isZh ? "管理固定项" : "Manage Anchors"}
        </button>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-3"}`}>
        {groups.map((group) => (
          <div key={group.title} className="rounded-xl border border-gray-100 bg-white/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-gray-900">{group.title}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">{group.description}</div>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${group.tone}`}>
                {group.items.length}
              </span>
            </div>
            {group.items.length ? (
              <ul className="mt-3 space-y-2">
                {group.items.slice(0, compact ? 2 : 3).map((item, index) => (
                  <li key={`${group.title}-${index}`} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="line-clamp-2">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-gray-400">
                {isZh ? "暂无固定内容" : "No pinned items yet"}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-gray-100 bg-white/80 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Users className="h-4 w-4 text-sky-600" />
          {isZh ? "干系人管理与分析" : "Stakeholder Management & Analysis"}
        </div>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-xs text-gray-500">{isZh ? "项目成员" : "Project Members"}</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{members.length}</div>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-xs text-gray-500">{isZh ? "固定干系人提示" : "Pinned Stakeholder Notes"}</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{stakeholderPinnedCount}</div>
          </div>
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-xs text-gray-500">{isZh ? "建议动作" : "Suggested Action"}</div>
            <div className="mt-1 flex items-start gap-2 text-gray-700">
              {hasMembers && stakeholderPinnedCount ? (
                <>
                  <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{isZh ? "按固定提示安排下一次沟通。" : "Plan the next touchpoint from pinned notes."}</span>
                </>
              ) : hasMembers ? (
                <>
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>{isZh ? "补充干系人偏好和敏感点。" : "Add stakeholder preferences and sensitivities."}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>{isZh ? "先添加项目成员和关键联系人。" : "Add project members and key contacts first."}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
