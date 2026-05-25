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
    <div className="relative flex-shrink-0 border-t border-gray-100 bg-slate-50 px-4 pb-4 pt-3">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 -translate-y-full bg-gradient-to-b from-transparent to-slate-50" />
      <div className={`mx-auto ${isFullscreen ? "max-w-5xl" : "max-w-4xl"}`}>
        {contextControls}
        {selectedSkillPanel}
        <div className="relative flex items-end gap-2.5 rounded-xl bg-white px-3.5 py-2.5 shadow-[0_2px_14px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] transition-all duration-200 focus-within:shadow-[0_4px_20px_rgba(0,63,177,0.09)] focus-within:ring-primary/20">
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
              className="min-h-[34px] max-h-[180px] w-full resize-none overflow-hidden bg-transparent py-1.5 text-[13.5px] leading-6 text-gray-700 outline-none placeholder:text-gray-300 disabled:opacity-50"
              rows={1}
              style={{ height: "auto" }}
              onInput={(event) => {
                const target = event.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${target.scrollHeight}px`;
              }}
            />
          </div>
          {onTogglePlanMode ? (
            <button
              onClick={onTogglePlanMode}
              title={isPlanMode ? "Plan mode: ON" : "Plan mode: OFF"}
              className={`mb-0.5 flex-shrink-0 rounded-lg p-2.5 transition-all ${
                isPlanMode
                  ? "bg-indigo-100 text-indigo-600 shadow-sm shadow-indigo-500/20"
                  : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
              }`}
            >
              <ListChecks className="h-4 w-4" />
            </button>
          ) : null}
          {isLoading ? (
            <button
              onClick={onStop}
              className="mb-0.5 flex-shrink-0 rounded-lg bg-red-500 p-2.5 text-white shadow-sm shadow-red-500/20 transition-all hover:opacity-90 active:scale-95"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!value.trim()}
              className="mb-0.5 flex-shrink-0 rounded-lg bg-gradient-to-br from-primary to-indigo-500 p-2.5 text-white shadow-sm shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
