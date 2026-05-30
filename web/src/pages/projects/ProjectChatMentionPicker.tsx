import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Flag, Users } from "lucide-react";
import { api } from "../../api/client";
import type { MentionType } from "./projectChatMentions";

interface MentionableItem {
  id: number;
  name: string;
  role?: string;
  file_type?: string;
  due_date?: string | null;
  is_done?: boolean;
}

interface MentionablesResponse {
  files: MentionableItem[];
  stakeholders: MentionableItem[];
  milestones: MentionableItem[];
}

interface ProjectChatMentionPickerProps {
  projectId: number;
  query: string;
  onSelect: (type: MentionType, id: number, name: string) => void;
  onClose: () => void;
}

export function ProjectChatMentionPicker({
  projectId,
  query,
  onSelect,
  onClose,
}: ProjectChatMentionPickerProps) {
  const [data, setData] = useState<MentionablesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await api.get<MentionablesResponse>(
          `/chat/mentionables?project_id=${projectId}`
        );
        if (!cancelled) setData(result);
      } catch (error) {
        console.error("Failed to load mentionables:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const q = query.toLowerCase().trim();

  const filtered = useMemo(() => {
    if (!data) return [];
    const items: Array<{ type: MentionType; item: MentionableItem }> = [];
    for (const f of data.files) {
      if (!q || f.name.toLowerCase().includes(q)) {
        items.push({ type: "file", item: f });
      }
    }
    for (const s of data.stakeholders) {
      if (!q || s.name.toLowerCase().includes(q) || (s.role && s.role.toLowerCase().includes(q))) {
        items.push({ type: "stakeholder", item: s });
      }
    }
    for (const m of data.milestones) {
      if (!q || m.name.toLowerCase().includes(q)) {
        items.push({ type: "milestone", item: m });
      }
    }
    return items.slice(0, 20);
  }, [data, q]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filtered.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = filtered[selectedIndex];
        if (entry) {
          onSelect(entry.type, entry.item.id, entry.item.name);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-codex-line bg-white p-3 shadow-lg">
        <div className="animate-pulse space-y-2">
          <div className="h-8 rounded-lg bg-codex-bg-tint" />
          <div className="h-8 rounded-lg bg-codex-bg-tint" />
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-codex-line bg-white p-3 shadow-lg">
        <p className="text-xs text-codex-ink-faint">未找到匹配项</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 z-50 mb-2 w-72 max-h-72 overflow-y-auto rounded-xl border border-codex-line bg-white py-1.5 shadow-lg"
    >
      {filtered.map((entry, index) => {
        const Icon =
          entry.type === "file"
            ? FileText
            : entry.type === "stakeholder"
              ? Users
              : Flag;
        const isSelected = index === selectedIndex;
        return (
          <button
            key={`${entry.type}-${entry.item.id}`}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            onClick={() => onSelect(entry.type, entry.item.id, entry.item.name)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
              isSelected ? "bg-primary/5 text-codex-ink" : "text-codex-ink-soft hover:bg-codex-bg-tint"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0 text-codex-ink-faint" />
            <div className="min-w-0">
              <p className="truncate font-medium">{entry.item.name}</p>
              {entry.item.role ? (
                <p className="text-xs text-codex-ink-faint">{entry.item.role}</p>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
