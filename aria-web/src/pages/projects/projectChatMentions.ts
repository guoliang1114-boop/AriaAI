const MENTION_PATTERN = /@[fsm]:(\d+):([^\s]+)/g;

export type MentionType = "file" | "stakeholder" | "milestone";

export interface ParsedMention {
  type: MentionType;
  id: number;
  name: string;
  raw: string;
}

export function parseMentions(text: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex to handle repeated calls
  MENTION_PATTERN.lastIndex = 0;
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const typeCode = match[0].charAt(1); // f, s, m, h
    const type: MentionType =
      typeCode === "f"
        ? "file"
        : typeCode === "s"
          ? "stakeholder"
          : typeCode === "m" || typeCode === "h"
            ? "milestone"
            : "file";
    const id = parseInt(match[1], 10);
    const name = match[2];
    if (Number.isFinite(id)) {
      mentions.push({ type, id, name, raw: match[0] });
    }
  }
  return mentions;
}

export function stripMentionMarkers(text: string): string {
  return text.replace(MENTION_PATTERN, (match, _id, name) => `@${name}`);
}

export function insertMention(
  text: string,
  cursorPos: number,
  type: MentionType,
  id: number,
  name: string,
): string {
  const typeCode = type === "file" ? "f" : type === "stakeholder" ? "s" : "m";
  const before = text.slice(0, cursorPos);
  const after = text.slice(cursorPos);
  // Remove the partial @query before cursor
  const lastAt = before.lastIndexOf("@");
  const cleanBefore = lastAt >= 0 ? before.slice(0, lastAt) : before;
  const cleanAfter = after.replace(/^\s+/, "");
  return `${cleanBefore}@${typeCode}:${id}:${name}${cleanAfter ? ` ${cleanAfter}` : " "}`;
}

export function getActiveMentionQuery(
  text: string,
  cursorPos: number,
): { query: string; startPos: number } | null {
  const beforeCursor = text.slice(0, cursorPos);
  const lastAt = beforeCursor.lastIndexOf("@");
  if (lastAt < 0) return null;
  // Ensure @ is at the start of a word (preceded by whitespace or start of string)
  if (lastAt > 0 && !/\s/.test(beforeCursor[lastAt - 1])) return null;
  // Make sure there is no whitespace between @ and cursor
  const between = beforeCursor.slice(lastAt + 1);
  if (/\s/.test(between)) return null;
  return { query: between, startPos: lastAt };
}

export function mentionsToContext(mentions: ParsedMention[]) {
  const fileIds: number[] = [];
  const stakeholderIds: number[] = [];
  const milestoneIds: number[] = [];
  for (const m of mentions) {
    if (m.type === "file") fileIds.push(m.id);
    else if (m.type === "stakeholder") stakeholderIds.push(m.id);
    else if (m.type === "milestone") milestoneIds.push(m.id);
  }
  return { file_ids: fileIds, stakeholder_ids: stakeholderIds, milestone_ids: milestoneIds };
}
