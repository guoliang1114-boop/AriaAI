import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CxFormRow } from "./CxFormRow";

describe("CxFormRow", () => {
  it("renders label and the wrapped control", () => {
    render(
      <CxFormRow label="姓名">
        <input data-testid="name" />
      </CxFormRow>,
    );
    expect(screen.getByText("姓名")).toBeInTheDocument();
    expect(screen.getByTestId("name")).toBeInTheDocument();
  });

  it("renders hint copy when provided", () => {
    render(
      <CxFormRow label="邮箱" hint="登录用,变更需邮件验证">
        <input />
      </CxFormRow>,
    );
    expect(screen.getByText("登录用,变更需邮件验证")).toBeInTheDocument();
  });

  it("associates the label with the control via htmlFor", () => {
    render(
      <CxFormRow label="姓名" htmlFor="name-input">
        <input id="name-input" />
      </CxFormRow>,
    );
    const label = screen.getByText("姓名").closest("label");
    expect(label).toHaveAttribute("for", "name-input");
  });

  it("suppresses the bottom hairline when divider=false (last row)", () => {
    render(
      <CxFormRow label="对话签名" divider={false}>
        <textarea />
      </CxFormRow>,
    );
    const row = screen.getByTestId("cx-form-row");
    expect(row.style.borderBottom).toBe("");
  });
});
