export type CxPageItem = number | "ellipsis";

export function clampPage(page: number, totalPages: number) {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, totalPages));
}

export function getCxPageItems(page: number, totalPages: number): CxPageItem[] {
  const total = Math.max(1, Math.floor(totalPages));
  const current = clampPage(page, total);

  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);

  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (current >= total - 2) {
    pages.add(total - 3);
    pages.add(total - 2);
    pages.add(total - 1);
  }

  const sorted = Array.from(pages)
    .filter((item) => item >= 1 && item <= total)
    .sort((left, right) => left - right);

  const result: CxPageItem[] = [];
  sorted.forEach((item, index) => {
    const previous = sorted[index - 1];
    if (previous && item - previous > 1) {
      result.push("ellipsis");
    }
    result.push(item);
  });

  return result;
}
