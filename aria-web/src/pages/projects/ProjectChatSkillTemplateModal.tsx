import { Send, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Skill } from "../../types/api";

type SkillTemplateVariable = {
  name: string;
  value: string;
};

type ProjectChatSkillTemplateModalProps = {
  skill: Skill;
  variables: SkillTemplateVariable[];
  onApply: (filledTemplate: string) => void | Promise<void>;
  onCancel: () => void;
};

export function extractSkillTemplateVariables(template: string) {
  const variableNames: string[] = [];
  const varRegex = /\[([^\]]+)\]|\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = varRegex.exec(template)) !== null) {
    const varName = (match[1] || match[2] || "").trim();
    if (varName && !variableNames.includes(varName)) {
      variableNames.push(varName);
    }
  }

  if (variableNames.length === 0) {
    const lines = template.split("\n");
    lines.forEach((line) => {
      const trimmed = line.trim();
      const colonMatch =
        trimmed.match(/^(?:[-•]\s*)?(.+?)：\s*$/) ||
        trimmed.match(/^(?:[-•]\s*)?(.+?):\s*$/);
      if (!colonMatch) return;
      const varName = colonMatch[1]?.trim();
      if (varName && !variableNames.includes(varName) && varName.length < 50) {
        variableNames.push(varName);
      }
    });
  }

  return variableNames.map((name) => ({ name, value: "" }));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ProjectChatSkillTemplateModal({
  skill,
  variables,
  onApply,
  onCancel,
}: ProjectChatSkillTemplateModalProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    variables.forEach((variable) => {
      initial[variable.name] = variable.value;
    });
    return initial;
  });

  const preview = useMemo(() => {
    let result = skill.user_template || "";

    Object.entries(values).forEach(([name, value]) => {
      if (!value) return;

      const placeholderRegex = new RegExp(
        `\\[${escapeRegex(name)}\\]|\\{\\{${escapeRegex(name)}\\}\\}`,
        "g",
      );
      result = result.replace(placeholderRegex, value);

      const lines = result.split("\n");
      result = lines
        .map((line) => {
          const trimmed = line.trim();
          const colonMatch =
            trimmed.match(/^(?:[-•]\s*)?(.+?)(：|:)\s*$/);
          if (!colonMatch) return line;
          const label = colonMatch[1]?.trim();
          if (!label || (label !== name && !label.includes(name))) {
            return line;
          }
          return `${line}${value}`;
        })
        .join("\n");
    });

    return result;
  }, [skill.user_template, values]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Wrench className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{skill.name}</h3>
              <p className="text-xs text-gray-500">
                {isZh ? "先补齐模板变量，再直接发到项目对话里" : "Fill in the template, then send it to the project chat"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-auto px-6 py-4">
          {skill.description ? (
            <p className="mb-4 text-sm text-gray-500">{skill.description}</p>
          ) : null}

          {variables.length > 0 ? (
            <div className="mb-5 space-y-3">
              {variables.map((variable, index) => (
                <div key={variable.name}>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    {variable.name}
                  </label>
                  <input
                    type="text"
                    value={values[variable.name] || ""}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [variable.name]: event.target.value,
                      }))
                    }
                    autoFocus={index === 0}
                    placeholder={isZh ? `请输入 ${variable.name}` : `Enter ${variable.name}`}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-primary/50"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
              {isZh ? "这个模板没有需要补充的字段，可以直接发送。" : "This template has no fields to fill. You can send it directly."}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-gray-500">
              {isZh ? "发送预览" : "Preview"}
            </p>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{preview}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-gray-500 transition-colors hover:bg-gray-100"
          >
            {isZh ? "取消" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void onApply(preview)}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/90"
          >
            <Send className="h-4 w-4" />
            {isZh ? "应用并发送" : "Apply and send"}
          </button>
        </div>
      </div>
    </div>
  );
}
