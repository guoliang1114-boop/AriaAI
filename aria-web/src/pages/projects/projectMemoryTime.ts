export function formatProjectMemoryUpdatedAt(
  value: string | null | undefined,
  isZh: boolean,
): string {
  if (!value) return isZh ? "暂无" : "N/A";

  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : `${value}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
