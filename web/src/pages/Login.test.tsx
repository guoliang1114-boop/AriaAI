import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { Login } from "./Login";

const mockNavigate = vi.fn();
const mockLogin = vi.fn();
const mockPost = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  // i18n stubs the t() function to return the key, so label-based
  // selectors below match on the key string ("login.email", etc.)
  // rather than the resolved translation.
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ login: mockLogin }),
}));

vi.mock("../api/client", () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

describe("Login (Codex layout)", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockLogin.mockClear();
    mockPost.mockClear();
  });

  it("renders the email + password inputs and the sign-in button", () => {
    render(<Login />);
    // Codex layout has no placeholders — labels above the inputs.
    expect(screen.getByLabelText("login.email")).toBeInTheDocument();
    expect(screen.getByLabelText("login.password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "login.signIn" })).toBeInTheDocument();
  });

  it("renders the hero copy on the left panel", () => {
    render(<Login />);
    expect(screen.getByText("login.heroHeadline")).toBeInTheDocument();
    expect(screen.getByText("login.heroBody")).toBeInTheDocument();
    expect(screen.getByText("login.heroBadge")).toBeInTheDocument();
  });

  it("does NOT render the legacy 'remember me' / 'no account' affordances", () => {
    // Part of the redesign: the form is email + password + 登录, nothing else.
    render(<Login />);
    expect(screen.queryByText("login.rememberMe")).not.toBeInTheDocument();
    expect(screen.queryByText("login.noAccount")).not.toBeInTheDocument();
    expect(screen.queryByText("login.contactAdmin")).not.toBeInTheDocument();
  });

  it("surfaces backend detail on failed login", async () => {
    mockPost.mockRejectedValue({ response: { data: { detail: "Invalid credentials" } } });
    render(<Login />);

    fireEvent.change(screen.getByLabelText("login.email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("login.password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "login.signIn" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("calls login() and navigates home on success", async () => {
    mockPost.mockResolvedValue({
      token: "abc123",
      user: { id: 1, email: "test@example.com" },
    });
    render(<Login />);

    fireEvent.change(screen.getByLabelText("login.email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("login.password"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "login.signIn" }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("abc123", {
        id: 1,
        email: "test@example.com",
      });
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  it("falls back to err.message when the response has no detail", async () => {
    mockPost.mockResolvedValue({ token: null });
    render(<Login />);

    fireEvent.change(screen.getByLabelText("login.email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("login.password"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "login.signIn" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no token received/i);
  });

  it("lowercases and trims the email before posting", async () => {
    mockPost.mockResolvedValue({
      token: "tok",
      user: { id: 2, email: "user@example.com" },
    });
    render(<Login />);

    fireEvent.change(screen.getByLabelText("login.email"), {
      target: { value: "  USER@Example.com  " },
    });
    fireEvent.change(screen.getByLabelText("login.password"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "login.signIn" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/auth/login", {
        email: "user@example.com",
        password: "pw",
      });
    });
  });
});
