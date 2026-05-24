const DEFAULT_MARKDOWN_LINK_ORIGIN = "http://localhost";

function stripControlCharacters(value: string) {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
}

export function sanitizeMarkdownHref(
  href?: string | null,
  origin = DEFAULT_MARKDOWN_LINK_ORIGIN,
) {
  const trimmed = (href || "").trim();
  if (!trimmed) return null;
  const normalized = stripControlCharacters(trimmed);
  const lower = normalized.toLowerCase();
  if (normalized.startsWith("//")) return null;
  if (normalized.startsWith("/") || normalized.startsWith("#")) return normalized;
  if (lower.startsWith("mailto:") || lower.startsWith("tel:")) return normalized;

  try {
    const parsed = new URL(normalized, origin);
    if (["http:", "https:"].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function stripUnsafeMarkdownHtml(content: string) {
  return content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function findJsonObjectEnd(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return -1;
}

function isToolUseBlock(value: unknown): value is { type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "tool_use"
  );
}

export function stripMarkdownToolUseJson(content: string) {
  const spans: Array<[number, number]> = [];
  let cursor = content.indexOf("{");

  while (cursor !== -1) {
    const end = findJsonObjectEnd(content, cursor);
    if (end === -1) break;

    try {
      const block = JSON.parse(content.slice(cursor, end)) as unknown;
      if (isToolUseBlock(block)) {
        spans.push([cursor, end]);
        cursor = content.indexOf("{", end);
        continue;
      }
    } catch {
      // Not a JSON object; keep scanning.
    }

    cursor = content.indexOf("{", cursor + 1);
  }

  if (!spans.length) return content;

  const parts: string[] = [];
  let start = 0;
  for (const [spanStart, spanEnd] of spans) {
    parts.push(content.slice(start, spanStart));
    start = spanEnd;
  }
  parts.push(content.slice(start));
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}
