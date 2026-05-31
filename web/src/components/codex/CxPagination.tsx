import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CxPaginationVariant = "full" | "basic" | "mini";
export type CxPageItem = number | "ellipsis";

interface CxPaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  variant?: CxPaginationVariant;
  showSummary?: boolean;
  showPageSize?: boolean;
  isZh?: boolean;
  className?: string;
  style?: CSSProperties;
}

function clampPage(page: number, totalPages: number) {
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

export function CxPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  variant = "full",
  showSummary,
  showPageSize,
  isZh = true,
  className,
  style,
}: CxPaginationProps) {
  if (totalItems <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = clampPage(page, totalPages);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const shouldShowSummary = showSummary ?? variant !== "mini";
  const shouldShowPageSize = showPageSize ?? (variant === "full" && Boolean(onPageSizeChange));
  const pageItems = getCxPageItems(currentPage, totalPages);
  const rootClassName = [
    "cx-pagination",
    variant === "mini" ? "cx-pagination--mini" : "",
    className ?? "",
  ]
    .join(" ")
    .trim();

  const goToPage = (nextPage: number) => {
    const clamped = clampPage(nextPage, totalPages);
    if (clamped !== currentPage) onPageChange(clamped);
  };

  if (variant === "mini") {
    return (
      <nav
        className={rootClassName}
        style={style}
        aria-label={isZh ? "分页" : "Pagination"}
        data-testid="cx-pagination"
      >
        <div className="cx-pagination__pages">
          <PageButton
            label={isZh ? "上一页" : "Previous"}
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
          >
            <ChevronLeft size={13} strokeWidth={1.7} aria-hidden="true" />
          </PageButton>
          <span className="cx-pagination__mini-label">
            {isZh ? `第 ${currentPage} / ${totalPages} 页` : `Page ${currentPage} / ${totalPages}`}
          </span>
          <PageButton
            label={isZh ? "下一页" : "Next"}
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
          >
            <ChevronRight size={13} strokeWidth={1.7} aria-hidden="true" />
          </PageButton>
        </div>
      </nav>
    );
  }

  return (
    <nav
      className={rootClassName}
      style={style}
      aria-label={isZh ? "分页" : "Pagination"}
      data-testid="cx-pagination"
    >
      {shouldShowSummary ? (
        <div className="cx-pagination__summary">
          {isZh ? (
            <>
              共 <strong>{totalItems}</strong> 条 · 第 <strong>{start}-{end}</strong> 条
            </>
          ) : (
            <>
              <strong>{totalItems}</strong> total · showing <strong>{start}-{end}</strong>
            </>
          )}
        </div>
      ) : (
        <span />
      )}

      <div className="cx-pagination__controls">
        <div className="cx-pagination__pages">
          <PageButton
            label={isZh ? "上一页" : "Previous page"}
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
          >
            <ChevronLeft size={13} strokeWidth={1.7} aria-hidden="true" />
            <span>{isZh ? "上一页" : "Prev"}</span>
          </PageButton>

          {pageItems.map((item, index) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="cx-pagination__ellipsis" aria-hidden="true">
                ...
              </span>
            ) : (
              <PageButton
                key={item}
                active={item === currentPage}
                label={isZh ? `第 ${item} 页` : `Page ${item}`}
                onClick={() => goToPage(item)}
              >
                {item}
              </PageButton>
            ),
          )}

          <PageButton
            label={isZh ? "下一页" : "Next page"}
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
          >
            <span>{isZh ? "下一页" : "Next"}</span>
            <ChevronRight size={13} strokeWidth={1.7} aria-hidden="true" />
          </PageButton>
        </div>

        {shouldShowPageSize && onPageSizeChange ? (
          <label className="cx-pagination__size">
            <span>{isZh ? "每页" : "Rows"}</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              aria-label={isZh ? "每页条数" : "Rows per page"}
              className="cx-pagination__select"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span>{isZh ? "条" : "/ page"}</span>
          </label>
        ) : null}
      </div>
    </nav>
  );
}

function PageButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      disabled={disabled || active}
      onClick={onClick}
      className={[
        "cx-no-hover",
        "cx-pagination__button",
        active ? "cx-pagination__button--active" : "",
      ]
        .join(" ")
        .trim()}
    >
      {children}
    </button>
  );
}
