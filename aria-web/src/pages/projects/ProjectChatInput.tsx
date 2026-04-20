import { Loader2, Send } from "lucide-react";

type ProjectChatInputProps = {
  value: string;
  isLoading: boolean;
  isFullscreen?: boolean;
  contextControls?: React.ReactNode;
  selectedSkillPanel?: React.ReactNode;
  placeholder: string;
  onChange: (value: string) => void;
  onSend: () => void;
};

export function ProjectChatInput({
  value,
  isLoading,
  isFullscreen = false,
  contextControls,
  selectedSkillPanel,
  placeholder,
  onChange,
  onSend,
}: ProjectChatInputProps) {
  return (
    <div className="relative flex-shrink-0 border-t border-gray-100 bg-[#f5f6f8] px-4 pb-5 pt-3">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 -translate-y-full bg-gradient-to-b from-transparent to-[#f5f6f8]" />
      <div className={`mx-auto ${isFullscreen ? "max-w-5xl" : "max-w-4xl"}`}>
        {contextControls}
        {selectedSkillPanel}
        <div className="flex items-end gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_2px_14px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] transition-all duration-200 focus-within:shadow-[0_4px_20px_rgba(0,63,177,0.09)] focus-within:ring-primary/20">
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
              className="min-h-[36px] max-h-[180px] w-full resize-none bg-transparent py-1.5 text-[15px] leading-relaxed text-gray-700 placeholder:text-gray-300 outline-none"
              rows={1}
              style={{ height: "auto" }}
              onInput={(event) => {
                const target = event.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${target.scrollHeight}px`;
              }}
            />
          </div>
          <button
            onClick={onSend}
            disabled={!value.trim() || isLoading}
            className="mb-0.5 rounded-xl bg-primary p-3 text-white shadow-sm transition-all hover:bg-primary/90 hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
