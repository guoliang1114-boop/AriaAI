import SwiftUI
import AppKit

// MARK: - Native AppKit text field (bypasses SwiftUI hit-testing / first-responder issues)

private final class LoginTextFieldNSView: NSTextField {
    override var acceptsFirstResponder: Bool { true }
}

private struct NativeInputField: NSViewRepresentable {
    @Binding var text: String
    let placeholder: String
    var isSecure: Bool = false

    func makeNSView(context: Context) -> NSTextField {
        let field: NSTextField = isSecure ? NSSecureTextField() : LoginTextFieldNSView()
        field.placeholderString = placeholder
        field.stringValue = text
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 14, weight: .regular)
        field.textColor = NSColor(red: 0.1, green: 0.11, blue: 0.12, alpha: 1)
        field.delegate = context.coordinator
        return field
    }

    func updateNSView(_ nsView: NSTextField, context: Context) {
        if nsView.stringValue != text { nsView.stringValue = text }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSTextField, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 300, height: nsView.intrinsicContentSize.height)
    }

    func makeCoordinator() -> Coordinator { Coordinator($text) }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        @Binding var text: String
        init(_ t: Binding<String>) { _text = t }
        func controlTextDidChange(_ n: Notification) {
            text = (n.object as? NSTextField)?.stringValue ?? ""
        }
    }
}

// MARK: - Login View

struct LoginView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @State private var email    = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var validationError: String? = nil
    @State private var showForgotAlert = false
    @State private var footerAlert: String? = nil
    @State private var showServerConfig = false
    @State private var serverURLInput = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "https://aria.d2cgo.co"

    private var canSignIn: Bool {
        !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !password.isEmpty
    }

    var body: some View {
        ZStack {
            Color.surfaceBase.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()
                brandHeader
                Spacer().frame(height: Spacing.xxxl)
                loginCard
                Spacer()
                footer
            }
        }
        .frame(minWidth: 700, minHeight: 600)
    }

    // MARK: - Brand

    private var brandHeader: some View {
        VStack(spacing: Spacing.sm) {
            AILogoView(size: 44, cornerRadius: Radius.md, fontSize: 18)
            VStack(spacing: 2) {
                Text("ARIA AI")
                    .font(.system(size: 16, weight: .bold))
                    .tracking(1.5)
                    .foregroundColor(.onSurface)
                Text(lang.t("精英咨询版", "ELITE CONSULTING EDITION"))
                    .font(TextStyle.labelSM)
                    .tracking(1.0)
                    .foregroundColor(.onSurfaceVariant)
            }
        }
    }

    // MARK: - Card

    private var loginCard: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(lang.t("进入工作台", "Access Your Workspace"))
                        .font(TextStyle.headlineSM)
                        .foregroundColor(.onSurface)
                    Text(lang.t("请输入账号密码以管理您的项目工作流。", "Enter your credentials to manage your workstreams."))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                Spacer()
                Button { showServerConfig = true } label: {
                    Image(systemName: "server.rack")
                        .font(.system(size: 13))
                        .foregroundColor(.onSurfaceVariant.opacity(0.5))
                        .padding(6)
                        .background(RoundedRectangle(cornerRadius: Radius.sm).fill(Color.surfaceContainerLow))
                }
                .buttonStyle(.plain)
                .help(lang.t("配置服务器地址", "Configure Server URL"))
            }

            VStack(alignment: .leading, spacing: Spacing.lg) {
                emailField
                passwordField
            }

            signInButton
            securityNote
        }
        .padding(Spacing.xxl)
        .frame(width: 400)
        .background(
            RoundedRectangle(cornerRadius: Radius.lg)
                .fill(Color.surfaceContainerLowest)
                .shadow(color: Color.primary600.opacity(0.07), radius: 24, x: 0, y: 6)
        )
        .sheet(isPresented: $showServerConfig) { serverConfigSheet }
    }

    // MARK: - Server Config Sheet

    private var serverConfigSheet: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            HStack {
                Image(systemName: "server.rack").foregroundColor(.primary500)
                Text(lang.t("服务器配置", "Server Configuration"))
                    .font(TextStyle.titleMD)
                    .foregroundColor(.onSurface)
                Spacer()
                Button { showServerConfig = false } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .medium))
                        .foregroundColor(.onSurfaceVariant)
                }
                .buttonStyle(.plain)
            }

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("后端服务器地址", "BACKEND SERVER URL"))
                    .font(TextStyle.labelSM).tracking(0.6)
                    .foregroundColor(.onSurfaceVariant)
                TextField("https://aria.d2cgo.co", text: $serverURLInput)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 13, design: .monospaced))
            }

            Text(lang.t("修改后将在下次请求时生效。留空则使用默认地址。", "Changes take effect on the next request. Leave empty to use the default."))
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)

            HStack {
                Button(lang.t("恢复默认", "Reset to Default")) {
                    serverURLInput = "https://aria.d2cgo.co"
                }
                .buttonStyle(.plain)
                .font(TextStyle.bodySM)
                .foregroundColor(.onSurfaceVariant)
                Spacer()
                Button(lang.t("取消", "Cancel")) { showServerConfig = false }
                    .buttonStyle(.plain)
                    .foregroundColor(.onSurfaceVariant)
                    .padding(.trailing, Spacing.sm)
                Button(lang.t("保存", "Save")) {
                    let url = serverURLInput.trimmingCharacters(in: .whitespacesAndNewlines)
                    UserDefaults.standard.set(url.isEmpty ? nil : url, forKey: "apiBaseURL")
                    showServerConfig = false
                }
                .buttonStyle(.plain)
                .font(TextStyle.titleSM)
                .foregroundColor(.white)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .background(RoundedRectangle(cornerRadius: Radius.md).fill(Color.primary500))
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 420)
    }

    // MARK: - Email field

    private var emailField: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(lang.t("邮箱地址", "PROFESSIONAL EMAIL"))
                .font(TextStyle.labelSM).tracking(0.6)
                .foregroundColor(.onSurfaceVariant)

            NativeInputField(text: $email, placeholder: "name@firm.com")
                .padding(Spacing.md)
                .background(
                    RoundedRectangle(cornerRadius: Radius.md).fill(Color.white)
                        .overlay(RoundedRectangle(cornerRadius: Radius.md)
                            .strokeBorder(Color.outlineVariant.opacity(0.6), lineWidth: 1))
                )
        }
    }

    // MARK: - Password field

    private var passwordField: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(lang.t("密码", "PASSWORD"))
                    .font(TextStyle.labelSM).tracking(0.6)
                    .foregroundColor(.onSurfaceVariant)
                Spacer()
                Button(lang.t("忘记密码？", "Forgot?")) { showForgotAlert = true }
                    .buttonStyle(.plain)
                    .font(TextStyle.labelSM)
                    .foregroundColor(.primary500)
                    .alert(lang.t("重置密码", "Reset Password"), isPresented: $showForgotAlert) {
                        Button(lang.t("确定", "OK"), role: .cancel) {}
                    } message: {
                        Text(lang.t("请联系您的系统管理员重置密码。", "Please contact your system administrator to reset your password."))
                    }
            }

            NativeInputField(text: $password, placeholder: "••••••••", isSecure: true)
                .padding(Spacing.md)
                .background(
                    RoundedRectangle(cornerRadius: Radius.md).fill(Color.white)
                        .overlay(RoundedRectangle(cornerRadius: Radius.md)
                            .strokeBorder(Color.outlineVariant.opacity(0.6), lineWidth: 1))
                )
        }
    }

    // MARK: - Sign In

    private var signInButton: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if let err = validationError {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 11))
                    Text(err).font(TextStyle.labelSM)
                }
                .foregroundColor(.statusFailed)
            }

            Button {
                validationError = nil
                guard canSignIn else {
                    if email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        validationError = lang.t("请输入邮箱地址", "Please enter your email address")
                    } else {
                        validationError = lang.t("请输入密码", "Please enter your password")
                    }
                    return
                }
                isLoading = true
                Task {
                    let err = await dataStore.login(email: email, password: password)
                    isLoading = false
                    if let err {
                        validationError = err
                    } else {
                        appState.isAuthenticated = true
                    }
                }
            } label: {
                Group {
                    if isLoading {
                        ProgressView().controlSize(.small).colorScheme(.dark)
                    } else {
                        Text(lang.t("登录 →", "Sign In →")).font(TextStyle.titleSM)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .foregroundColor(.white)
                .background(
                    LinearGradient(
                        colors: canSignIn ? [.primary600, .primary500] : [Color.onSurfaceVariant.opacity(0.4), Color.onSurfaceVariant.opacity(0.3)],
                        startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: Radius.md)
                )
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Security note

    private var securityNote: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Image(systemName: "lock.shield")
                .font(.system(size: 13))
                .foregroundColor(.primary500)
            Text(lang.t("企业级安全保障，所有数据本地处理。", "Enterprise-grade security. All data processed locally."))
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: Radius.md)
                .fill(Color.primaryFixed.opacity(0.35))
        )
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: Spacing.sm) {
            HStack(spacing: Spacing.xl) {
                footerButton(lang.t("隐私政策", "Privacy Policy"),
                             msg: lang.t("隐私政策文档由管理员提供，请联系系统管理员获取详情。", "Privacy policy documents are provided by your administrator. Contact your system admin for details."))
                footerButton(lang.t("安全架构", "Security Architecture"),
                             msg: lang.t("所有数据均在本地处理，不经过第三方服务器。AI 推理通过企业私有部署完成。", "All data is processed locally. No third-party servers are involved. AI inference runs on your private deployment."))
                footerButton(lang.t("联系支持", "Contact Support"),
                             msg: lang.t("如需技术支持，请发送邮件至您的 IT 管理员或企业支持渠道。", "For technical support, contact your IT administrator or enterprise support channel."))
            }
            Text(lang.t("© 2024 CONSULTANT AI · 企业级安全 · 所有数据本地处理", "© 2024 CONSULTANT AI · ENTERPRISE-GRADE SECURITY · ALL DATA PROCESSED LOCALLY"))
                .font(.system(size: 10)).tracking(0.3)
                .foregroundColor(Color.onSurfaceVariant.opacity(0.5))
        }
        .padding(.bottom, Spacing.xl)
        .alert(footerAlert ?? "", isPresented: Binding(
            get: { footerAlert != nil },
            set: { if !$0 { footerAlert = nil } }
        )) {
            Button(lang.t("确定", "OK"), role: .cancel) {}
        }
    }

    @ViewBuilder
    private func footerButton(_ label: String, msg: String) -> some View {
        Button(label) { footerAlert = msg }
            .buttonStyle(.plain)
            .font(TextStyle.labelSM)
            .foregroundColor(.onSurfaceVariant)
    }
}
