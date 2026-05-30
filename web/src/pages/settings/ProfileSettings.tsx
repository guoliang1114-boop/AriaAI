/**
 * Settings → 个人资料 — V0.0.6 Codex redesign.
 *
 * Identity-only after the settings reorg: 头像 / 显示名称 / 邮箱 / 时区 /
 * 密码. 字体大小 moved to 外观 (it's an appearance choice, not an
 * identity field); AI 偏好 graduated to its own ``PreferenceSettings``
 * page under the 个人 group.
 *
 * State machine + API surface for the remaining rows is unchanged:
 * ``/auth/me``, ``/settings/``, ``/auth/users/:id`` (PATCH
 * display_name), ``/settings/timezone``, ``/auth/change-password``.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  Clock3,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  User as UserIcon,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../api/client";
import { CxFormRow } from "../../components/codex";
import type { User as UserType } from "../../types/api";
import {
  BROWSER_TIMEZONE_VALUE,
  DEFAULT_APP_TIMEZONE,
  getBrowserTimeZone,
  setAppTimeZone,
} from "../../utils/timezone";

interface SavedMessage {
  type: "success" | "error";
  text: string;
}

const TIMEZONE_OPTIONS: { value: string; label_zh: string; label_en: string; hint: string }[] = [
  { value: "Asia/Shanghai", label_zh: "中国标准时间", label_en: "China Standard Time", hint: "UTC+08:00" },
  { value: BROWSER_TIMEZONE_VALUE, label_zh: "跟随浏览器", label_en: "Follow browser", hint: "" },
  { value: "UTC", label_zh: "协调世界时", label_en: "Coordinated Universal Time", hint: "UTC+00:00" },
  { value: "Asia/Tokyo", label_zh: "日本标准时间", label_en: "Japan Standard Time", hint: "UTC+09:00" },
  { value: "America/Los_Angeles", label_zh: "洛杉矶时间", label_en: "Los Angeles", hint: "UTC-08:00 / -07:00" },
  { value: "America/New_York", label_zh: "纽约时间", label_en: "New York", hint: "UTC-05:00 / -04:00" },
  { value: "Europe/London", label_zh: "伦敦时间", label_en: "London", hint: "UTC+00:00 / +01:00" },
];

const INPUT_STYLE = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 13.5,
  background: "var(--color-codex-bg)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  color: "var(--color-codex-ink)",
};

const SAVE_BUTTON_STYLE = {
  padding: "8px 16px",
  background: "var(--color-codex-ink)",
  color: "var(--color-codex-bg-elev)",
  borderRadius: "var(--codex-r-sm, 3px)",
  fontSize: 13,
  fontWeight: 500,
};

const GHOST_BUTTON_STYLE = {
  padding: "7px 14px",
  fontSize: 12.5,
  color: "var(--color-codex-ink-soft)",
  border: "1px solid var(--color-codex-line)",
  borderRadius: "var(--codex-r-sm, 3px)",
  background: "var(--color-codex-bg-elev)",
};

export function ProfileSettings() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [user, setUser] = useState<UserType | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<SavedMessage | null>(null);

  const [selectedTimeZone, setSelectedTimeZone] = useState(DEFAULT_APP_TIMEZONE);
  const [savingTimeZone, setSavingTimeZone] = useState(false);
  const [timeZoneMsg, setTimeZoneMsg] = useState<SavedMessage | null>(null);

  // Password dialog
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<SavedMessage | null>(null);

  // Track every auto-clear timer so we cancel them on unmount instead of
  // firing setState on a stale component.
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tzTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pwdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<UserType>("/auth/me"),
      api.get<Record<string, string>>("/settings/").catch(() => ({}) as Record<string, string>),
    ])
      .then(([u, settings]) => {
        setUser(u);
        setDisplayName(u.display_name);
        setSelectedTimeZone(settings.timezone || DEFAULT_APP_TIMEZONE);
      })
      .catch(() => {});
    return () => {
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
      if (tzTimerRef.current) clearTimeout(tzTimerRef.current);
      if (pwdTimerRef.current) clearTimeout(pwdTimerRef.current);
    };
  }, []);

  const handleSaveName = async () => {
    if (!user || !displayName.trim()) return;
    setSavingName(true);
    setNameMsg(null);
    try {
      await api.patch(`/auth/users/${user.id}`, { display_name: displayName.trim() });
      setNameMsg({ type: "success", text: isZh ? "已保存" : "Saved" });
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
      nameTimerRef.current = setTimeout(() => setNameMsg(null), 3000);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setNameMsg({ type: "error", text: detail || (isZh ? "保存失败" : "Save failed") });
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveTimeZone = async () => {
    setSavingTimeZone(true);
    setTimeZoneMsg(null);
    try {
      await api.put("/settings/timezone", { value: selectedTimeZone });
      setAppTimeZone(selectedTimeZone);
      setTimeZoneMsg({ type: "success", text: isZh ? "时区已保存" : "Timezone saved" });
      if (tzTimerRef.current) clearTimeout(tzTimerRef.current);
      tzTimerRef.current = setTimeout(() => setTimeZoneMsg(null), 3000);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setTimeZoneMsg({
        type: "error",
        text: detail || (isZh ? "保存时区失败" : "Failed to save timezone"),
      });
    } finally {
      setSavingTimeZone(false);
    }
  };

  const openPasswordDialog = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPwdMsg(null);
    setShowPasswordDialog(true);
  };

  const closePasswordDialog = () => {
    if (savingPwd) return;
    setShowPasswordDialog(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPwdMsg(null);
  };

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwdMsg({
        type: "error",
        text: isZh ? "两次输入的新密码不一致" : "New passwords don't match",
      });
      return;
    }
    if (newPassword.length < 6) {
      setPwdMsg({
        type: "error",
        text: isZh ? "新密码至少需要 6 位" : "New password must be at least 6 characters",
      });
      return;
    }
    setSavingPwd(true);
    setPwdMsg(null);
    try {
      await api.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwdMsg({
        type: "success",
        text: isZh ? "密码已修改成功" : "Password updated",
      });
      if (pwdTimerRef.current) clearTimeout(pwdTimerRef.current);
      pwdTimerRef.current = setTimeout(() => {
        setShowPasswordDialog(false);
        setPwdMsg(null);
      }, 1500);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPwdMsg({
        type: "error",
        text: detail || (isZh ? "修改密码失败" : "Failed to change password"),
      });
    } finally {
      setSavingPwd(false);
    }
  };

  const initials =
    displayName.trim()
      ?.split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "";

  return (
    <div
      className="theme-codex"
      data-testid="profile-settings"
      style={{
        background: "var(--color-codex-bg)",
        color: "var(--color-codex-ink)",
        padding: "8px 4px 32px",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 500,
            color: "var(--color-codex-ink)",
            letterSpacing: "-0.015em",
          }}
        >
          {isZh ? "个人资料" : "Profile"}
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--color-codex-ink-mute)",
            lineHeight: 1.6,
          }}
        >
          {isZh
            ? "这些信息会出现在团队视图中，以及对话发送者标识。"
            : "These fields appear in team views and as your sender label on conversations."}
        </p>
      </header>

      {/* Avatar row — no CxFormRow because the layout doesn't follow the
          label / control split. Standalone, matches the prototype. */}
      <div
        className="flex items-center gap-5"
        style={{
          padding: "20px 0",
          borderBottom: "1px solid var(--color-codex-line-soft)",
        }}
      >
        <span
          aria-hidden={!initials}
          aria-label={initials ? `${displayName} avatar` : undefined}
          className="inline-flex items-center justify-center"
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            background: "var(--color-codex-accent-bg)",
            color: "var(--color-codex-accent-ink)",
            fontSize: 24,
            fontWeight: 500,
          }}
        >
          {initials || <UserIcon className="h-6 w-6" aria-hidden="true" />}
        </span>
        <div>
          <button
            type="button"
            style={GHOST_BUTTON_STYLE}
            disabled
            title={isZh ? "头像上传暂未开放" : "Avatar upload not yet available"}
          >
            {isZh ? "上传头像" : "Upload avatar"}
          </button>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--color-codex-ink-mute)",
              marginTop: 6,
            }}
          >
            {isZh
              ? "PNG / JPG · 最大 2 MB · 暂未开放"
              : "PNG / JPG · up to 2 MB · not available yet"}
          </div>
        </div>
      </div>

      {/* Display name */}
      <CxFormRow
        label={
          <span className="inline-flex items-center gap-1.5">
            <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {isZh ? "显示名称" : "Display name"}
          </span>
        }
        htmlFor="profile-display-name"
      >
        <div className="flex gap-3">
          <input
            id="profile-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={isZh ? "你的显示名称" : "Your display name"}
            className="codex-input"
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => void handleSaveName()}
            disabled={savingName || displayName.trim() === (user?.display_name ?? "")}
            className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={SAVE_BUTTON_STYLE}
          >
            {savingName ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isZh ? "保存" : "Save"}
          </button>
        </div>
        <InlineMessage message={nameMsg} />
      </CxFormRow>

      {/* Email (read-only) */}
      <CxFormRow
        label={
          <span className="inline-flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            {isZh ? "邮箱地址" : "Email"}
          </span>
        }
        hint={isZh ? "登录用，变更需联系管理员。" : "Used for sign-in; contact an admin to change."}
        htmlFor="profile-email"
      >
        <input
          id="profile-email"
          type="email"
          value={user?.email ?? ""}
          readOnly
          className="codex-input"
          style={{
            ...INPUT_STYLE,
            background: "var(--color-codex-bg-tint)",
            color: "var(--color-codex-ink-mute)",
            cursor: "not-allowed",
          }}
        />
      </CxFormRow>

      {/* Timezone */}
      <CxFormRow
        label={
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            {isZh ? "时区" : "Timezone"}
          </span>
        }
        hint={
          isZh
            ? "默认使用北京时间（UTC+08:00）。对话、项目、知识库和任务记录等时间显示会优先使用这里的时区。"
            : "Defaults to Beijing time (UTC+08:00). Conversations, projects, knowledge base, and task logs render times in this zone."
        }
        htmlFor="profile-timezone"
      >
        <div className="flex gap-3">
          <select
            id="profile-timezone"
            value={selectedTimeZone}
            onChange={(e) => setSelectedTimeZone(e.target.value)}
            className="codex-input"
            style={{ ...INPUT_STYLE, flex: 1 }}
          >
            {TIMEZONE_OPTIONS.map((option) => {
              const hint =
                option.value === BROWSER_TIMEZONE_VALUE
                  ? isZh
                    ? `（当前：${getBrowserTimeZone()}）`
                    : ` (now: ${getBrowserTimeZone()})`
                  : option.hint
                    ? isZh
                      ? `（${option.hint}）`
                      : ` (${option.hint})`
                    : "";
              return (
                <option key={option.value} value={option.value}>
                  {isZh ? option.label_zh : option.label_en}
                  {hint}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={() => void handleSaveTimeZone()}
            disabled={savingTimeZone}
            className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={SAVE_BUTTON_STYLE}
          >
            {savingTimeZone ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isZh ? "保存" : "Save"}
          </button>
        </div>
        <InlineMessage message={timeZoneMsg} />
      </CxFormRow>

      {/* Password */}
      <CxFormRow
        label={
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            {isZh ? "密码" : "Password"}
          </span>
        }
        hint={isZh ? "定期更换密码可以保护你的账户安全。" : "Rotate your password from time to time to keep the account safe."}
        divider={false}
      >
        <button
          type="button"
          onClick={openPasswordDialog}
          className="inline-flex items-center gap-1.5"
          style={GHOST_BUTTON_STYLE}
        >
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          {isZh ? "修改密码" : "Change password"}
        </button>
      </CxFormRow>

      {/* Password dialog */}
      {showPasswordDialog && (
        <PasswordDialog
          isZh={isZh}
          currentPassword={currentPassword}
          newPassword={newPassword}
          confirmPassword={confirmPassword}
          saving={savingPwd}
          message={pwdMsg}
          onChangeCurrent={setCurrentPassword}
          onChangeNew={setNewPassword}
          onChangeConfirm={setConfirmPassword}
          onClose={closePasswordDialog}
          onSubmit={handleChangePassword}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

function InlineMessage({ message }: { message: SavedMessage | null }) {
  if (!message) return null;
  const color =
    message.type === "success" ? "var(--color-codex-good)" : "var(--color-codex-bad)";
  return (
    <p
      role={message.type === "error" ? "alert" : undefined}
      className="mt-1.5 inline-flex items-center gap-1"
      style={{ fontSize: 11.5, color }}
    >
      {message.type === "error" && (
        <AlertCircle className="h-3 w-3" aria-hidden="true" />
      )}
      {message.text}
    </p>
  );
}

interface PasswordDialogProps {
  isZh: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  saving: boolean;
  message: SavedMessage | null;
  onChangeCurrent: (next: string) => void;
  onChangeNew: (next: string) => void;
  onChangeConfirm: (next: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}

function PasswordDialog({
  isZh,
  currentPassword,
  newPassword,
  confirmPassword,
  saving,
  message,
  onChangeCurrent,
  onChangeNew,
  onChangeConfirm,
  onClose,
  onSubmit,
}: PasswordDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-password-title"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.4)", padding: 16 }}
    >
      <div
        className="theme-codex w-full"
        style={{
          maxWidth: 420,
          background: "var(--color-codex-bg-elev)",
          border: "1px solid var(--color-codex-line)",
          borderRadius: "var(--codex-r-md, 6px)",
          overflow: "hidden",
          boxShadow:
            "0 12px 36px -8px rgba(0,0,0,0.18), 0 0 0 1px var(--color-codex-line)",
        }}
      >
        <header
          className="flex items-center justify-between"
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--color-codex-line-soft)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                borderRadius: "var(--codex-r-sm, 3px)",
                background: "var(--color-codex-accent-bg)",
                color: "var(--color-codex-accent-ink)",
              }}
            >
              <Lock className="h-3.5 w-3.5" />
            </span>
            <div>
              <h2
                id="profile-password-title"
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 500,
                  color: "var(--color-codex-ink)",
                }}
              >
                {isZh ? "修改密码" : "Change password"}
              </h2>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 11.5,
                  color: "var(--color-codex-ink-mute)",
                }}
              >
                {isZh ? "请输入当前密码和新密码" : "Enter your current password and a new one"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={isZh ? "关闭" : "Close"}
            className="disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: "var(--color-codex-ink-mute)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={onSubmit} style={{ padding: 18, display: "grid", gap: 12 }}>
          <PasswordField
            id="pwd-current"
            label={isZh ? "当前密码" : "Current password"}
            value={currentPassword}
            onChange={onChangeCurrent}
            autoFocus
          />
          <PasswordField
            id="pwd-new"
            label={isZh ? "新密码" : "New password"}
            placeholder={isZh ? "至少 6 位" : "At least 6 characters"}
            value={newPassword}
            onChange={onChangeNew}
          />
          <PasswordField
            id="pwd-confirm"
            label={isZh ? "确认新密码" : "Confirm new password"}
            value={confirmPassword}
            onChange={onChangeConfirm}
          />

          {message && (
            <div
              role={message.type === "error" ? "alert" : "status"}
              className="flex items-center gap-1.5"
              style={{
                padding: "8px 10px",
                fontSize: 12,
                background:
                  message.type === "success"
                    ? "color-mix(in oklch, var(--color-codex-good) 8%, transparent)"
                    : "color-mix(in oklch, var(--color-codex-bad) 8%, transparent)",
                border: `1px solid color-mix(in oklch, var(${
                  message.type === "success" ? "--color-codex-good" : "--color-codex-bad"
                }) 30%, transparent)`,
                borderRadius: "var(--codex-r-sm, 3px)",
                color:
                  message.type === "success"
                    ? "var(--color-codex-good)"
                    : "var(--color-codex-bad)",
              }}
            >
              {message.type === "error" ? (
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              )}
              {message.text}
            </div>
          )}

          <div className="flex justify-end gap-2" style={{ marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={GHOST_BUTTON_STYLE}
            >
              {isZh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={
                saving || !currentPassword || !newPassword || !confirmPassword
              }
              className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
              style={SAVE_BUTTON_STYLE}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {isZh ? "修改中…" : "Updating…"}
                </>
              ) : (
                <>
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {isZh ? "确认修改" : "Confirm change"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  placeholder,
  autoFocus,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          fontSize: 12.5,
          color: "var(--color-codex-ink-soft)",
          display: "block",
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required
        className="codex-input"
        style={INPUT_STYLE}
      />
    </div>
  );
}
