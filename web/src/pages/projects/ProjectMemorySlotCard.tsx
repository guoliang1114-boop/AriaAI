import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api } from "../../api/client";
import type { ProjectMemory, ProjectMemoryEditableSlot, ProjectMemoryResponse } from "../../types/api";

export type ProjectMemorySlotKey = "key_risks" | "open_questions" | "stakeholder_notes";

export function ProjectMemorySlotCard({
  title,
  description,
  slotKey,
  slotDetail,
  isZh,
  projectId,
  onSaved,
}: {
  title: string;
  description: string;
  slotKey: ProjectMemorySlotKey;
  slotDetail?: ProjectMemoryEditableSlot;
  isZh: boolean;
  projectId: string;
  onSaved: (memory: ProjectMemoryResponse["memory"]) => void;
}) {
  const [value, setValue] = useState((slotDetail?.pinned || []).join("\n"));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue((slotDetail?.pinned || []).join("\n"));
  }, [slotDetail?.pinned]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const response = await api.patch<{ memory: ProjectMemory }>(`/projects/${projectId}/memory/slots/${slotKey}`, {
        pinned: value
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      onSaved(response.memory);
    } catch (error) {
      console.error(`Failed to update ${slotKey}:`, error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isZh ? "保存" : "Save"}
        </button>
      </div>

      {slotDetail?.ai?.length ? (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {isZh ? "AI 建议" : "AI suggestions"}
          </div>
          <ul className="mt-2 space-y-2 text-sm text-gray-700">
            {slotDetail.ai.map((item, index) => (
              <li key={`${item}-${index}`} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          {isZh ? "固定内容（每行一条）" : "Pinned items (one per line)"}
        </div>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={6}
          className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          placeholder={isZh ? "输入希望长期保留的要点，每行一条。" : "Add the items that should stay pinned, one per line."}
        />
      </div>
    </div>
  );
}
