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

function countTableCells(row: string): number {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").length;
}

function isTableDelimiterRow(row: string): boolean {
  let s = row.trim();
  if (!s.includes("-") || !s.includes("|")) return false;
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

function delimiterCellFor(cell: string | undefined): string {
  const c = (cell || "").trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return ":---:";
  if (right) return "---:";
  if (left) return ":---";
  return "---";
}

// GitHub-Flavored-Markdown only recognizes a table when the delimiter row has
// exactly as many cells as the header row. LLMs sometimes emit a delimiter row
// with an extra/missing column, which makes remark-gfm drop the whole table and
// render it as literal text. Rebuild any mismatched delimiter row to the
// header's column count (preserving per-column alignment) so the table renders.
export function normalizeMarkdownTables(content: string): string {
  if (!content.includes("|") || !content.includes("-")) return content;

  const lines = content.split("\n");
  let inFence = false;
  let fenceMarker = "";

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    const fenceMatch = /^(```|~~~)/.exec(trimmed);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1];
      } else if (trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence || i === 0) continue;

    if (!isTableDelimiterRow(lines[i])) continue;

    const header = lines[i - 1];
    if (!header || !header.includes("|") || isTableDelimiterRow(header)) continue;

    const headerCols = countTableCells(header);
    if (headerCols < 1 || headerCols === countTableCells(lines[i])) continue;

    let body = lines[i].trim();
    if (body.startsWith("|")) body = body.slice(1);
    if (body.endsWith("|")) body = body.slice(0, -1);
    const existing = body.split("|");
    const indent = lines[i].slice(0, lines[i].length - lines[i].trimStart().length);

    const cells: string[] = [];
    for (let j = 0; j < headerCols; j += 1) {
      cells.push(delimiterCellFor(existing[j]));
    }
    lines[i] = `${indent}| ${cells.join(" | ")} |`;
  }

  return lines.join("\n");
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
