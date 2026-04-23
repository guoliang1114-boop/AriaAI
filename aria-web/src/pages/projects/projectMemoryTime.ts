import { formatDateOnly, formatDateTime, getResolvedAppTimeZone } from "../../utils/timezone";

export function formatProjectMemoryUpdatedAt(
  value: string | null | undefined,
  isZh: boolean,
): string {
  if (!value) return isZh ? '暂无' : 'N/A'

  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
  const date = new Date(normalized)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return formatDateTime(date, isZh ? "zh-CN" : "en-US", undefined, getResolvedAppTimeZone())
}

export function formatProjectMemoryUpdatedAtCompact(
  value: string | null | undefined,
  isZh: boolean,
): string {
  if (!value) return isZh ? "暂无" : "N/A";

  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) return isZh ? "刚刚同步" : "just synced";
  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.floor(diffMs / minuteMs));
    return isZh ? `${minutes} 分钟前` : `${minutes}m ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.floor(diffMs / hourMs));
    return isZh ? `${hours} 小时前` : `${hours}h ago`;
  }
  if (diffMs < dayMs * 7) {
    const days = Math.max(1, Math.floor(diffMs / dayMs));
    return isZh ? `${days} 天前` : `${days}d ago`;
  }

  return formatDateOnly(
    date,
    {
      month: "short",
      day: "numeric",
    },
    getResolvedAppTimeZone(),
  );
}
