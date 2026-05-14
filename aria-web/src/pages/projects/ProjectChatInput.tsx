import { Loader2, Send, Square } from "lucide-react";

type ProjectChatInputProps = {
  value: string;
  isLoading: boolean;
  isFullscreen?: boolean;
  contextControls?: React.ReactNode;
  selectedSkillPanel?: React.ReactNode;
  placeholder: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
};

export function ProjectChatInput({
  value,
  isLoading,
  contextControls,
  selectedSkillPanel,
  placeholder,
  onChange,
  onSend,
  onStop,
}: ProjectChatInputProps) {
  return (
    <div className="relative flex-shrink-0 border-t border-gray-100 bg-slate-50 px-4 pb-4 pt-3">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 -translate-y-full bg-gradient-to-b from-transparent to-slate-50" />
      <div className="mx-auto max-w-4xl">
        {contextControls}
        {selectedSkillPanel}
        <div className="flex items-end gap-3 rounded-xl bg-white px-4 py-3 shadow-[0_2px_14px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] transition-all duration-200 focus-within:shadow-[0_4px_20px_rgba(0,63,177,0.09)] focus-within:ring-primary/20">
          <div className="relative flex-1">
            <textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder={placeholder}
              disabled={isLoading}
              className="min-h-[36px] max-h-[180px] w-full resize-none overflow-hidden bg-transparent py-1.5 text-[15px] leading-relaxed text-gray-700 placeholder:text-gray-300 outline-none disabled:opacity-50"
              rows={1}
              style={{ height: "auto" }}
              onInput={(event) => {
                const target = event.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${target.scrollHeight}px`;
              }}
            />
          </div>
          {isLoading ? (
            <button
              onClick={onStop}
              className="mb-0.5 flex-shrink-0 rounded-xl bg-red-500 p-2.5 text-white shadow-sm shadow-red-500/20 transition-all hover:opacity-90 active:scale-95"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!value.trim()}
              className="mb-0.5 flex-shrink-0 rounded-xl bg-gradient-to-br from-primary to-indigo-500 p-2.5 text-white shadow-sm shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
