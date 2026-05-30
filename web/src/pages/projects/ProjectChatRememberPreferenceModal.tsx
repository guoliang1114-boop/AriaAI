/**
 * "记住为偏好" mini-modal — saves the suggested preference into UserMemory.
 *
 * Triggered from ``ProjectChatMessageBubble`` when ``detectPreferenceSuggestion``
 * matches the user's message. Reads the current preferences, merges the
 * suggested key/value, and writes them back via the existing /user-memory API.
 */
import { useState } from "react";
import { Brain, Check, Loader2, X } from "lucide-react";

import { api } from "../../api/client";
import {
  applyPreferenceSuggestion,
  type PreferenceSuggestion,
} from "../../utils/preferenceHints";

interface Props {
  suggestion: PreferenceSuggestion;
  onClose: () => void;
  onSaved?: () => void;
}

export function ProjectChatRememberPreferenceModal({ suggestion, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const current = await api
        .get<{ preferences: Record<string, unknown> }>("/user-memory")
        .catch(() => ({ preferences: {} }));
      const merged = applyPreferenceSuggestion(current.preferences || {}, suggestion);
      await api.put("/user-memory", { preferences: merged });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || "保存失败,请稍后再试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-outline/10 bg-codex-bg-tint-lowest shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-outline/10 px-5 py-3.5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Brain className="h-4 w-4 text-codex-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-codex-ink">记住为我的 AI 偏好</h3>
              <p className="mt-0.5 text-xs text-codex-ink-mute">
                跨项目生效,可随时在「设置 → 个人信息 → AI 个人偏好」修改。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-codex-ink-mute hover:bg-codex-bg-tint disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 px-5 py-4 text-sm">
          <p className="text-codex-ink font-medium">{suggestion.label}</p>
          <p className="text-xs text-codex-ink-mute">{suggestion.hint}</p>
          {error && (
            <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-outline/10 bg-codex-bg-tint-low/50 px-5 py-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-3 py-1.5 text-sm text-codex-ink-mute hover:bg-codex-bg-tint disabled:opacity-50"
          >
            不用
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            记住
          </button>
        </div>
      </div>
    </div>
  );
}
