import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CxPagination, getCxPageItems } from "./CxPagination";

describe("CxPagination", () => {
  it("builds a compact page model with ellipses", () => {
    expect(getCxPageItems(6, 12)).toEqual([1, "ellipsis", 5, 6, 7, "ellipsis", 12]);
    expect(getCxPageItems(2, 12)).toEqual([1, 2, 3, 4, "ellipsis", 12]);
    expect(getCxPageItems(11, 12)).toEqual([1, "ellipsis", 9, 10, 11, 12]);
  });

  it("renders summary, navigation, and page-size controls", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();

    render(
      <div className="theme-codex">
        <CxPagination
          page={2}
          pageSize={10}
          totalItems={42}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          isZh
        />
      </div>,
    );

    expect(screen.getByText(/共/)).toBeInTheDocument();
    expect(screen.getByText("11-20")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.change(screen.getByLabelText("每页条数"), { target: { value: "20" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(20);
  });
});
