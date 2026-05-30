import { ListTodo } from "lucide-react";
import type { ProjectTodo } from "../../types/api";
import type { ProjectUserPickerItem as UserItem } from "./ProjectUserPicker";
import { ProjectTodoItem } from "./ProjectTodoItem";

interface ProjectTodosPanelProps {
  completedCount: number;
  deletingIds: Set<number>;
  editAssignee: number | null;
  editContent: string;
  editDueDate: string;
  editingId: number | null;
  isZh: boolean;
  onCancelEdit: () => void;
  onChangeEditAssignee: (value: number | null) => void;
  onChangeEditContent: (value: string) => void;
  onChangeEditDueDate: (value: string) => void;
  onDelete: (todo: ProjectTodo) => void;
  onSaveEdit: (todoId: number) => void;
  onStartEdit: (todo: ProjectTodo) => void;
  onToggle: (todo: ProjectTodo) => void;
  progress: number;
  savingId: number | null;
  todos: ProjectTodo[];
  users: UserItem[];
}

export function ProjectTodosPanel({
  completedCount,
  deletingIds,
  editAssignee,
  editContent,
  editDueDate,
  editingId,
  isZh,
  onCancelEdit,
  onChangeEditAssignee,
  onChangeEditContent,
  onChangeEditDueDate,
  onDelete,
  onSaveEdit,
  onStartEdit,
  onToggle,
  progress,
  savingId,
  todos,
  users,
}: ProjectTodosPanelProps) {
  return (
    <>
      <div className="rounded-xl border border-codex-line bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-codex-ink-faint" />
            <h3 className="font-semibold text-codex-ink">
              {isZh ? "项目待办" : "Project Todos"}
            </h3>
          </div>
          <span className="text-sm text-codex-ink-mute">
            {completedCount} / {todos.length} {isZh ? "已完成" : "done"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-codex-bg-tint">
          <div
            className="h-full bg-codex-accent transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-codex-line bg-white">
        {todos.length === 0 ? (
          <div className="py-12 text-center text-codex-ink-faint">
            <ListTodo className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p className="text-sm">{isZh ? "暂无待办事项" : "No todos yet"}</p>
            <p className="mt-1 text-xs opacity-70">
              {isZh ? "在上方输入并添加第一个待办" : "Type above to add your first todo"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {todos
              .filter((todo) => !deletingIds.has(todo.id))
              .map((todo) => (
                <ProjectTodoItem
                  key={todo.id}
                  editAssignee={editAssignee}
                  editContent={editContent}
                  editDueDate={editDueDate}
                  editingId={editingId}
                  onCancelEdit={onCancelEdit}
                  onChangeEditAssignee={onChangeEditAssignee}
                  onChangeEditContent={onChangeEditContent}
                  onChangeEditDueDate={onChangeEditDueDate}
                  onDelete={onDelete}
                  onSaveEdit={onSaveEdit}
                  onStartEdit={onStartEdit}
                  onToggle={onToggle}
                  savingId={savingId}
                  todo={todo}
                  users={users}
                />
              ))}
          </div>
        )}
      </div>
    </>
  );
}
