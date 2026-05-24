import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ProjectTodo } from "../../types/api";
import type { ProjectUserPickerItem as UserItem } from "./ProjectUserPicker";

interface UseProjectTodosManagerOptions {
  isZh: boolean;
  onUpdate: () => void;
  projectId: string;
  showError: (message: string) => void;
  todos: ProjectTodo[];
}

export function useProjectTodosManager({
  isZh,
  onUpdate,
  projectId,
  showError,
  todos,
}: UseProjectTodosManagerOptions) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const currentUser = (() => {
    try {
      const raw = localStorage.getItem("user");
      return raw ? (JSON.parse(raw) as { id?: number }) : null;
    } catch {
      return null;
    }
  })();

  const [newContent, setNewContent] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newAssignee, setNewAssignee] = useState<number | null>(currentUser?.id ?? null);
  const [isAdding, setIsAdding] = useState(false);

  const [savingId, setSavingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAssignee, setEditAssignee] = useState<number | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [todoToDelete, setTodoToDelete] = useState<ProjectTodo | null>(null);

  const completedCount = todos.filter((t) => t.is_done).length;
  const progress = todos.length > 0 ? (completedCount / todos.length) * 100 : 0;

  useEffect(() => {
    const fetchUsers = async () => {
      setLoadingUsers(true);
      try {
        const data = await api.get<UserItem[]>("/auth/users/simple");
        setUsers(data);
      } catch (error) {
        console.error("Failed to fetch users:", error);
      } finally {
        setLoadingUsers(false);
      }
    };

    void fetchUsers();
  }, []);

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    setIsAdding(true);
    try {
      await api.post(`/projects/${projectId}/todos`, {
        content: newContent.trim(),
        due_date: newDueDate || null,
        assigned_to_user_id: newAssignee,
      });
      setNewContent("");
      setNewDueDate("");
      setNewAssignee(currentUser?.id ?? null);
      onUpdate();
    } catch (error) {
      console.error("Failed to create todo:", error);
      showError(isZh ? "创建失败" : "Failed to create");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggle = async (todo: ProjectTodo) => {
    setSavingId(todo.id);
    try {
      await api.patch(`/projects/${projectId}/todos/${todo.id}`, {
        is_done: !todo.is_done,
      });
      onUpdate();
    } catch (error) {
      console.error("Failed to toggle todo:", error);
      showError(isZh ? "更新失败" : "Failed to update");
    } finally {
      setSavingId(null);
    }
  };

  const openDeleteDialog = (todo: ProjectTodo) => {
    setTodoToDelete(todo);
    setShowDeleteDialog(true);
  };

  const closeDeleteDialog = () => {
    setShowDeleteDialog(false);
    setTodoToDelete(null);
  };

  const confirmDelete = async () => {
    if (!todoToDelete) return;
    const todoId = todoToDelete.id;
    setShowDeleteDialog(false);
    setDeletingIds((prev) => new Set(prev).add(todoId));
    try {
      await api.delete(`/projects/${projectId}/todos/${todoId}`);
      await onUpdate();
    } catch (error) {
      console.error("Failed to delete todo:", error);
      showError(isZh ? "删除失败" : "Failed to delete");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(todoId);
        return next;
      });
      setTodoToDelete(null);
    }
  };

  const startEdit = (todo: ProjectTodo) => {
    setEditingId(todo.id);
    setEditContent(todo.content);
    setEditDueDate(todo.due_date ?? "");
    setEditAssignee(todo.assigned_to_user_id ?? null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
    setEditDueDate("");
    setEditAssignee(null);
  };

  const handleSaveEdit = async (todoId: number) => {
    if (!editContent.trim()) return;
    setSavingId(todoId);
    try {
      await api.patch(`/projects/${projectId}/todos/${todoId}`, {
        content: editContent.trim(),
        due_date: editDueDate || null,
        assigned_to_user_id: editAssignee,
      });
      setEditingId(null);
      setEditContent("");
      setEditDueDate("");
      setEditAssignee(null);
      onUpdate();
    } catch (error) {
      console.error("Failed to update todo:", error);
      showError(isZh ? "保存失败" : "Failed to save");
    } finally {
      setSavingId(null);
    }
  };

  return {
    cancelEdit,
    closeDeleteDialog,
    completedCount,
    confirmDelete,
    deletingIds,
    editAssignee,
    editContent,
    editDueDate,
    editingId,
    handleCreate,
    handleSaveEdit,
    handleToggle,
    isAdding,
    loadingUsers,
    newAssignee,
    newContent,
    newDueDate,
    openDeleteDialog,
    progress,
    savingId,
    setEditAssignee,
    setEditContent,
    setEditDueDate,
    setNewAssignee,
    setNewContent,
    setNewDueDate,
    showDeleteDialog,
    startEdit,
    todoToDelete,
    users,
  };
}
