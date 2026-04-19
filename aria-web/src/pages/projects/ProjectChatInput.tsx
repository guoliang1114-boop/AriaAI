import { Loader2, Send } from "lucide-react";

type ProjectChatInputProps = {
  value: string;
  isLoading: boolean;
  isFullscreen?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSend: () => void;
};

export function ProjectChatInput({
  value,
  isLoading,
  isFullscreen = false,
  placeholder,
  onChange,
  onSend,
}: ProjectChatInputProps) {
  return (
    <div className="border-t border-gray-100 bg-white p-4">
      <div className={`mx-auto flex items-end gap-3 ${isFullscreen ? "max-w-5xl" : "max-w-4xl"}`}>
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
            className="min-h-[48px] max-h-[120px] w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 placeholder:text-gray-400 transition-all focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
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
          className="rounded-xl bg-primary p-3 text-white shadow-sm transition-all hover:bg-primary/90 hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
