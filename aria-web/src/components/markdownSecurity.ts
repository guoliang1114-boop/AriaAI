const DEFAULT_MARKDOWN_LINK_ORIGIN = "http://localhost";

export function sanitizeMarkdownHref(
  href?: string | null,
  origin = DEFAULT_MARKDOWN_LINK_ORIGIN,
) {
  const trimmed = (href || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;

  try {
    const parsed = new URL(trimmed, origin);
    if (["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}
