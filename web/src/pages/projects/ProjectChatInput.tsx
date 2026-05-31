import { useRef, useState, useCallback } from "react";
import { ListChecks, Send, Square } from "lucide-react";
import { ProjectChatMentionPicker } from "./ProjectChatMentionPicker";
import { getActiveMentionQuery, type MentionType } from "./projectChatMentions";

type ProjectChatInputProps = {
  value: string;
  isLoading: boolean;
  isFullscreen?: boolean;
  projectId?: number;
  contextControls?: React.ReactNode;
  selectedSkillPanel?: React.ReactNode;
  placeholder: string;
  onChange: (value: string) => void;
  isPlanMode?: boolean;
  onTogglePlanMode?: () => void;
  onSend: () => void;
  onStop?: () => void;
};

export function ProjectChatInput({
  value,
  isLoading,
  isFullscreen,
  projectId,
  contextControls,
  selectedSkillPanel,
  placeholder,
  isPlanMode,
  onTogglePlanMode,
  onChange,
  onSend,
  onStop,
}: ProjectChatInputProps) {
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const checkMention = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !projectId) {
      setMentionQuery(null);
      return;
    }
    const cursorPos = el.selectionStart;
    const active = getActiveMentionQuery(el.value, cursorPos);
    if (active) {
      setMentionQuery(active.query);
    } else {
      setMentionQuery(null);
    }
  }, [projectId]);

  const handleSelectMention = useCallback(
    (type: MentionType, id: number, name: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const cursorPos = el.selectionStart;
      const typeCode = type === "file" ? "f" : type === "stakeholder" ? "s" : "m";
      const before = el.value.slice(0, cursorPos);
      const after = el.value.slice(cursorPos);
      const lastAt = before.lastIndexOf("@");
      const cleanBefore = lastAt >= 0 ? before.slice(0, lastAt) : before;
      const cleanAfter = after.replace(/^\s+/, "");
      const insertedText = `@${typeCode}:${id}:${name}${cleanAfter ? ` ${cleanAfter}` : " "}`;
      const newValue = `${cleanBefore}${insertedText}`;
      onChange(newValue);
      setMentionQuery(null);
      // Restore focus and place cursor after inserted mention
      requestAnimationFrame(() => {
        el.focus();
        const newCursor = cleanBefore.length + `@${typeCode}:${id}:${name} `.length;
        el.setSelectionRange(newCursor, newCursor);
      });
    },
    [onChange],
  );

  const handleCloseMention = useCallback(() => {
    setMentionQuery(null);
  }, []);

  return (
    <div
      className="relative flex-shrink-0 px-4 pb-4 pt-3"
      style={{
        background: "var(--color-codex-bg-elev)",
        borderTop: "1px solid var(--color-codex-line-soft)",
      }}
    >
      <div className={`mx-auto ${isFullscreen ? "max-w-5xl" : "max-w-4xl"}`}>
        {contextControls}
        {selectedSkillPanel}
        <div
          className="relative flex items-end transition-colors focus-within:[border-color:var(--color-codex-accent)]"
          style={{
            gap: 10,
            padding: "10px 12px",
            background: "var(--color-codex-bg-elev)",
            border: "1px solid var(--color-codex-line)",
            borderRadius: "var(--codex-r-md, 8px)",
          }}
        >
          {mentionQuery !== null && projectId ? (
            <ProjectChatMentionPicker
              projectId={projectId}
              query={mentionQuery}
              onSelect={handleSelectMention}
              onClose={handleCloseMention}
            />
          ) : null}
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
                checkMention();
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
                checkMention();
              }}
              onKeyDown={(event) => {
                // Let mention picker handle arrow/enter/escape when active
                if (mentionQuery !== null && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Escape")) {
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  const nativeEvent = event.nativeEvent as KeyboardEvent;
                  if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
                    return;
                  }
                  event.preventDefault();
                  onSend();
                }
              }}
              onClick={checkMention}
              onKeyUp={checkMention}
              placeholder={placeholder}
              disabled={isLoading}
              className="min-h-[34px] max-h-[180px] w-full resize-none overflow-hidden bg-transparent outline-none disabled:opacity-50"
              rows={1}
              style={{
                height: "auto",
                padding: "4px 0",
                fontSize: 13.5,
                lineHeight: 1.6,
                color: "var(--color-codex-ink)",
              }}
              onInput={(event) => {
                const target = event.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${target.scrollHeight}px`;
              }}
            />
          </div>
          {onTogglePlanMode ? (
            <button
              type="button"
              onClick={onTogglePlanMode}
              title={isPlanMode ? "Plan mode: ON" : "Plan mode: OFF"}
              aria-pressed={Boolean(isPlanMode)}
              className="mb-0.5 inline-flex flex-shrink-0 items-center justify-center transition-colors"
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--codex-r-sm, 6px)",
                color: isPlanMode
                  ? "var(--color-codex-accent)"
                  : "var(--color-codex-ink-mute)",
                background: isPlanMode
                  ? "var(--color-codex-accent-bg)"
                  : "transparent",
                border: isPlanMode
                  ? "1px solid color-mix(in oklch, var(--color-codex-accent) 28%, transparent)"
                  : "1px solid var(--color-codex-line)",
              }}
            >
              <ListChecks className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {isLoading ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              className="mb-0.5 inline-flex flex-shrink-0 items-center justify-center transition-colors"
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--codex-r-sm, 6px)",
                color: "var(--color-codex-bg-elev)",
                background: "var(--color-codex-bad)",
                border: "1px solid var(--color-codex-bad)",
              }}
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!value.trim()}
              title="Send"
              className="mb-0.5 inline-flex flex-shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--codex-r-sm, 6px)",
                color: "var(--color-codex-bg-elev)",
                background: "var(--color-codex-ink)",
                border: "1px solid var(--color-codex-ink)",
              }}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
