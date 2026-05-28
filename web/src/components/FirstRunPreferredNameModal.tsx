/**
 * First-run onboarding modal — capture the user's preferred form of address (称呼).
 *
 * Non-dismissible: no backdrop click, no Escape close, no skip button. The user
 * must save a non-empty 称呼 before the rest of the app becomes interactive.
 * The decision behind this is in the V0.0.4 user-memory work: the first thing
 * a new user does on entry is tell us how to address them, so every subsequent
 * chat reply can use the name naturally.
 *
 * On save: PUT /user-memory with the existing preferences merged + new
 * ``personal_info.preferred_name``. The caller (Layout) decides when to mount
 * this — typically after /auth/me and /user-memory both load and we see no
 * preferred_name yet.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, UserRound } from "lucide-react";

import { api } from "../api/client";

interface UserMemoryResponse {
  preferences: Record<string, unknown>;
  version: number;
  updated_at: string;
}

interface Props {
  existingPreferences: Record<string, unknown>;
  onSaved: (next: Record<string, unknown>) => void;
}

function mergePreferredName(
  existing: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };
  const personalRaw = next.personal_info;
  const personal: Record<string, unknown> =
    personalRaw && typeof personalRaw === "object"
      ? { ...(personalRaw as Record<string, unknown>) }
      : {};
  personal.preferred_name = name;
  next.personal_info = personal;
  return next;
}

export function FirstRunPreferredNameModal({ existingPreferences, onSaved }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 40 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const merged = mergePreferredName(existingPreferences, trimmed);
      const response = await api.put<UserMemoryResponse>("/user-memory", {
        preferences: merged,
      });
      onSaved(response.preferences ?? merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试");
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-preferred-name-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="first-run-preferred-name-modal"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-outline/10 bg-surface-container-lowest p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-primary text-white">
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="first-run-preferred-name-title"
              className="text-lg font-semibold text-on-surface"
            >
              请告诉 Aria 怎么称呼你
            </h2>
            <p className="text-xs text-on-surface-muted">
              这是开始使用前的第一步，之后每一轮回复都会用到。
            </p>
          </div>
        </div>

        <label className="mt-4 block text-sm font-medium text-on-surface" htmlFor="preferred-name-input">
          你希望 Aria 怎么称呼你？
        </label>
        <input
          id="preferred-name-input"
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
          placeholder="例如：李总、小李、Liang"
          maxLength={40}
          disabled={saving}
          className="mt-2 w-full rounded-lg border border-outline/20 bg-surface-container px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          autoComplete="off"
          data-testid="preferred-name-input"
        />
        <p className="mt-1.5 text-[11px] text-on-surface-muted">
          最长 40 个字。之后可以在「设置 → AI 个人偏好」中随时修改。
        </p>

        {error ? (
          <p className="mt-3 rounded-md bg-error/10 px-3 py-2 text-xs text-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="preferred-name-save"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "保存中…" : "保存并开始"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const __test__ = { mergePreferredName };
