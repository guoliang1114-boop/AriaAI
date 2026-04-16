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
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-gray-400" />
            <h3 className="font-semibold text-gray-900">
              {isZh ? "椤圭洰寰呭姙" : "Project Todos"}
            </h3>
          </div>
          <span className="text-sm text-gray-500">
            {completedCount} / {todos.length} {isZh ? "宸插畬鎴?" : "done"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {todos.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <ListTodo className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p className="text-sm">{isZh ? "鏆傛棤寰呭姙浜嬮」" : "No todos yet"}</p>
            <p className="mt-1 text-xs opacity-70">
              {isZh ? "鍦ㄤ笂鏂硅緭鍏ュ苟娣诲姞绗竴涓緟鍔?" : "Type above to add your first todo"}
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
