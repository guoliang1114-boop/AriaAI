import { Calendar, Loader2, Plus } from "lucide-react";
import { UserPicker, type ProjectUserPickerItem as UserItem } from "./ProjectUserPicker";

interface ProjectTodoCreateFormProps {
  isAdding: boolean;
  isZh: boolean;
  loadingUsers: boolean;
  newAssignee: number | null;
  newContent: string;
  newDueDate: string;
  onAssigneeChange: (value: number | null) => void;
  onContentChange: (value: string) => void;
  onCreate: () => void;
  onDueDateChange: (value: string) => void;
  users: UserItem[];
}

export function ProjectTodoCreateForm({
  isAdding,
  isZh,
  loadingUsers,
  newAssignee,
  newContent,
  newDueDate,
  onAssigneeChange,
  onContentChange,
  onCreate,
  onDueDateChange,
  users,
}: ProjectTodoCreateFormProps) {
  return (
    <div className="rounded-xl border border-codex-line bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={newContent}
          onChange={(event) => onContentChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCreate();
          }}
          placeholder={isZh ? "添加新的待办事项..." : "Add a new todo..."}
          className="flex-1 rounded-lg border border-codex-line bg-codex-bg-tint px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="sm:w-44">
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-codex-ink-faint" />
            <input
              type="date"
              value={newDueDate}
              onChange={(event) => onDueDateChange(event.target.value)}
              className="w-full rounded-lg border border-codex-line bg-white py-2.5 pl-9 pr-3 text-sm text-codex-ink-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
        <div className="sm:w-48">
          <UserPicker
            users={users}
            value={newAssignee}
            onChange={onAssigneeChange}
            disabled={loadingUsers}
          />
        </div>
        <button
          onClick={onCreate}
          disabled={isAdding || !newContent.trim()}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-codex-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {isZh ? "添加" : "Add"}
        </button>
      </div>
    </div>
  );
}
