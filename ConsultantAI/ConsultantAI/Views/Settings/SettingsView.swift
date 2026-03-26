import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang

    @State private var apiKey = ""
    @State private var showApiKey = false
    @State private var isSavingKey = false
    @State private var saveSuccess = false
    @State private var saveError: String? = nil
    @State private var isSavingURL = false
    @State private var urlSaveSuccess = false
    @State private var selectedModel = UserDefaults.standard.string(forKey: "selectedModel") ?? "Claude Sonnet 4.6 (Fast)"
    @State private var claudeProxyURL = ""
    @State private var backendBaseURL = ""
    @State private var isSavingBackendURL = false
    @State private var backendURLSaveSuccess = false
    
    // HTTP Mode for Claude API
    @State private var claudeHttpMode = "auto"
    @State private var isSavingHttpMode = false
    @State private var httpModeSaveSuccess = false
    let httpModes = [
        ("auto", "自动 (自定义地址时用HTTP)"),
        ("sdk", "SDK 模式 (Anthropic 官方)"),
        ("http", "HTTP 模式 (无 Stainless Headers)")
    ]

    // Profile fields
    @State private var displayName = UserDefaults.standard.string(forKey: "profileDisplayName") ?? "Active Profile"
    @State private var email = UserDefaults.standard.string(forKey: "profileEmail") ?? ""
    @State private var profileSaved = false

    // User management
    @State private var showAddUser = false
    @State private var newUserLogin = ""        // username prefix before @d2cgo.com
    @State private var newUserName = ""
    @State private var newUserPassword = ""
    @State private var newUserIsAdmin = false
    @State private var addUserError: String? = nil
    @State private var isAddingUser = false
    @State private var userActionError: String? = nil
    // Reset password
    @State private var resetTargetUser: DataStore.AppUser? = nil
    @State private var resetNewPassword = ""
    @State private var isResettingPwd = false
    @State private var resetPwdError: String? = nil

    let models = ["Claude Opus 4.6 (Balanced)", "Claude Sonnet 4.6 (Fast)", "Claude Haiku 4.5 (Efficient)"]

    var body: some View {
        VStack(spacing: 0) {
            // Page header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(lang.t("设置", "Settings"))
                        .font(TextStyle.headlineMD)
                        .foregroundColor(.onSurface)
                    Text(lang.t("AI 配置与个人信息", "AI configuration and profile"))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                Spacer()
            }
            .padding(.horizontal, Spacing.xxl)
            .padding(.vertical, Spacing.lg)
            .background(.surfaceContainerLowest)
            .overlay(Divider(), alignment: .bottom)

            // Two-column layout
            ScrollView {
                HStack(alignment: .top, spacing: Spacing.xl) {
                    // Left — AI Configuration
                    aiConfigCard
                        .frame(maxWidth: .infinity)

                    // Right — User Profile + Language + About + User Management (admin)
                    VStack(spacing: Spacing.xl) {
                        profileCard
                        languageCard
                        if dataStore.currentUser?.isAdmin == true {
                            userManagementCard
                        }
                        aboutCard
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(Spacing.xxl)
            }
            .background(.surfaceBase)
        }
    }

    // MARK: - AI Configuration

    private var aiConfigCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                // Card header
                HStack(spacing: Spacing.sm) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary500.opacity(0.1))
                            .frame(width: 32, height: 32)
                        Image(systemName: "cpu")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.primary500)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(lang.t("AI 配置", "AI Configuration")).font(TextStyle.titleMD).foregroundColor(.onSurface)
                        Text(lang.t("Claude API 密钥与模型设置", "Claude API key and model settings")).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    }
                }

                // Status banner
                HStack(spacing: Spacing.sm) {
                    if dataStore.apiKeyConfigured {
                        Image(systemName: "checkmark.seal.fill").foregroundColor(.statusActive)
                        Text(lang.t("API Key 已配置", "API key configured")).font(TextStyle.bodySM).foregroundColor(.statusActive)
                    } else {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.statusOnHold)
                        Text(lang.t("未配置 API Key，对话功能不可用", "API key not set — chat unavailable")).font(TextStyle.bodySM).foregroundColor(.statusOnHold)
                    }
                    Spacer()
                    if saveSuccess {
                        Text(lang.t("已保存 ✓", "Saved ✓")).font(TextStyle.labelSM).foregroundColor(.statusActive)
                    }
                    if let err = saveError {
                        Text(err).font(TextStyle.labelSM).foregroundColor(.statusFailed).lineLimit(1)
                    }
                }
                .padding(Spacing.md)
                .background(dataStore.apiKeyConfigured ? Color.statusActive.opacity(0.06) : Color.statusOnHold.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))

                Divider().opacity(0.4)

                // API Key field
                settingsField(lang.t("ANTHROPIC API 密钥", "ANTHROPIC API KEY")) {
                    HStack {
                        if showApiKey {
                            TextField("SK-...", text: $apiKey)
                                .textFieldStyle(.plain).font(TextStyle.bodyMD)
                        } else {
                            SecureField("SK-...", text: $apiKey)
                                .textFieldStyle(.plain).font(TextStyle.bodyMD)
                        }
                        Button {
                            showApiKey.toggle()
                        } label: {
                            Image(systemName: showApiKey ? "eye.slash" : "eye")
                                .font(.system(size: 13)).foregroundColor(.onSurfaceVariant)
                        }
                        .buttonStyle(.plain)
                    }
                }

                // Model picker
                settingsField(lang.t("默认模型", "DEFAULT MODEL")) {
                    Picker("", selection: $selectedModel) {
                        ForEach(models, id: \.self) { Text($0) }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onChange(of: selectedModel) { _, newValue in
                        UserDefaults.standard.set(newValue, forKey: "selectedModel")
                    }
                }

                PrimaryButton(isSavingKey ? lang.t("保存中…", "Saving…") : lang.t("保存 API Key", "Save API Key"), icon: "key") {
                    saveError = nil
                    saveSuccess = false
                    isSavingKey = true
                    Task {
                        let ok = await dataStore.saveApiKey(apiKey)
                        isSavingKey = false
                        if ok {
                            saveSuccess = true
                            apiKey = ""
                            try? await Task.sleep(nanoseconds: 3_000_000_000)
                            saveSuccess = false
                        } else {
                            saveError = dataStore.error ?? lang.t("保存失败，请确认后端是否运行", "Save failed. Check backend is running.")
                        }
                    }
                }
                .disabled(apiKey.isEmpty || isSavingKey)

                Divider().opacity(0.4)

                // Claude Proxy URL
                settingsField(lang.t("CLAUDE 代理地址（留空用官方 API）", "CLAUDE PROXY URL (leave blank for official API)")) {
                    TextField("https://api.anthropic.com", text: $claudeProxyURL)
                        .textFieldStyle(.plain).font(TextStyle.bodyMD)
                }

                SecondaryButton(urlSaveSuccess ? lang.t("已保存 ✓", "Saved ✓") : (isSavingURL ? lang.t("保存中…", "Saving…") : lang.t("保存代理地址", "Save Proxy URL")), icon: "link") {
                    isSavingURL = true
                    urlSaveSuccess = false
                    Task {
                        await dataStore.saveClaudeProxyURL(claudeProxyURL)
                        isSavingURL = false
                        urlSaveSuccess = true
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        urlSaveSuccess = false
                    }
                }
                .disabled(isSavingURL)

                // HTTP Mode selector
                settingsField(lang.t("调用方式", "API CALL MODE")) {
                    Picker("", selection: $claudeHttpMode) {
                        ForEach(httpModes, id: \.0) { mode, label in
                            Text(label).tag(mode)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                SecondaryButton(
                    httpModeSaveSuccess
                        ? lang.t("已保存 ✓", "Saved ✓")
                        : (isSavingHttpMode ? lang.t("保存中…", "Saving…") : lang.t("保存调用方式", "Save Call Mode")),
                    icon: "arrow.left.arrow.right"
                ) {
                    isSavingHttpMode = true
                    httpModeSaveSuccess = false
                    Task {
                        await dataStore.saveClaudeHttpMode(claudeHttpMode)
                        isSavingHttpMode = false
                        httpModeSaveSuccess = true
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        httpModeSaveSuccess = false
                    }
                }
                .disabled(isSavingHttpMode)

                Divider().opacity(0.4)

                // Backend Server URL
                settingsField(lang.t("后端服务器地址", "BACKEND SERVER URL")) {
                    TextField("https://aria.d2cgo.co", text: $backendBaseURL)
                        .textFieldStyle(.plain).font(TextStyle.bodyMD)
                }

                SecondaryButton(
                    backendURLSaveSuccess
                        ? lang.t("已保存 ✓", "Saved ✓")
                        : (isSavingBackendURL ? lang.t("保存中…", "Saving…") : lang.t("保存服务器地址", "Save Server URL")),
                    icon: "server.rack"
                ) {
                    isSavingBackendURL = true
                    backendURLSaveSuccess = false
                    Task {
                        await dataStore.saveApiBaseURL(backendBaseURL)
                        isSavingBackendURL = false
                        backendURLSaveSuccess = true
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        backendURLSaveSuccess = false
                    }
                }
                .disabled(backendBaseURL.isEmpty || isSavingBackendURL)
            }
            .padding(Spacing.xl)
        }
        .task {
            claudeProxyURL = await dataStore.loadClaudeProxyURL()
            claudeHttpMode = await dataStore.loadClaudeHttpMode()
            backendBaseURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "https://aria.d2cgo.co"
        }
    }

    // MARK: - User Profile

    private var profileCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                // Card header
                HStack(spacing: Spacing.sm) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary500.opacity(0.1))
                            .frame(width: 32, height: 32)
                        Image(systemName: "person.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.primary500)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(lang.t("个人 Profile", "User Profile")).font(TextStyle.titleMD).foregroundColor(.onSurface)
                        Text(lang.t("账号信息与偏好设置", "Account info & preferences")).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    }
                }

                Divider().opacity(0.4)

                // Avatar
                HStack(spacing: Spacing.lg) {
                    AvatarView(initials: String(displayName.prefix(2)).uppercased(), size: 56, gradient: true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(displayName).font(TextStyle.titleSM).foregroundColor(.onSurface)
                        Text(email).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    }
                    Spacer()
                }
                .padding(Spacing.md)
                .background(Color.surfaceContainerHighest.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))

                // Name field
                settingsField(lang.t("显示名称", "Display Name")) {
                    TextField(lang.t("你的名字", "Your name"), text: $displayName)
                        .textFieldStyle(.plain).font(TextStyle.bodyMD)
                }

                // Email field
                settingsField(lang.t("邮箱地址", "Email")) {
                    TextField("email@example.com", text: $email)
                        .textFieldStyle(.plain).font(TextStyle.bodyMD)
                }

                HStack {
                    PrimaryButton(profileSaved ? lang.t("已保存 ✓", "Saved ✓") : lang.t("保存 Profile", "Save Profile"), icon: "checkmark") {
                        UserDefaults.standard.set(displayName, forKey: "profileDisplayName")
                        UserDefaults.standard.set(email, forKey: "profileEmail")
                        profileSaved = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { profileSaved = false }
                    }
                    .disabled(profileSaved)
                }
            }
            .padding(Spacing.xl)
        }
    }

    // MARK: - Language Card

    private var languageCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                HStack(spacing: Spacing.sm) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary500.opacity(0.1))
                            .frame(width: 32, height: 32)
                        Image(systemName: "globe")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.primary500)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(lang.t("界面语言", "Interface Language")).font(TextStyle.titleMD).foregroundColor(.onSurface)
                        Text(lang.t("切换全局显示语言", "Switch the UI display language")).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    }
                }

                Divider().opacity(0.4)

                HStack(spacing: Spacing.md) {
                    ForEach(AppLanguage.allCases, id: \.self) { option in
                        Button {
                            appState.language = option
                        } label: {
                            HStack(spacing: Spacing.sm) {
                                Image(systemName: option == .zh ? "character.chinese" : "character")
                                    .font(.system(size: 14))
                                Text(option.displayName)
                                    .font(TextStyle.labelMD)
                                if appState.language == option {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 11, weight: .bold))
                                }
                            }
                            .foregroundColor(appState.language == option ? .white : .onSurface)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Spacing.md)
                            .background(appState.language == option
                                ? AnyShapeStyle(LinearGradient(colors: [.primary600, .primary500], startPoint: .leading, endPoint: .trailing))
                                : AnyShapeStyle(Color.surfaceContainerHigh))
                            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(Spacing.xl)
        }
    }

    // MARK: - About Card

    private var aboutCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                HStack(spacing: Spacing.sm) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary500.opacity(0.1))
                            .frame(width: 32, height: 32)
                        Image(systemName: "info.circle")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.primary500)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(lang.t("关于", "About")).font(TextStyle.titleMD).foregroundColor(.onSurface)
                        Text(lang.t("应用信息与版本", "App info and version")).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    }
                }

                Divider().opacity(0.4)

                // App Icon and Info
                VStack(spacing: Spacing.lg) {
                    // App Icon
                    if let iconImage = NSImage(named: "AppIcon") {
                        Image(nsImage: iconImage)
                            .resizable()
                            .frame(width: 80, height: 80)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .shadow(color: Color.black.opacity(0.1), radius: 8, x: 0, y: 4)
                    } else {
                        ZStack {
                            RoundedRectangle(cornerRadius: 16)
                                .fill(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                                .frame(width: 80, height: 80)
                            Image(systemName: "sparkles")
                                .font(.system(size: 32, weight: .semibold))
                                .foregroundColor(.white)
                        }
                        .shadow(color: Color.black.opacity(0.1), radius: 8, x: 0, y: 4)
                    }

                    VStack(spacing: Spacing.xs) {
                        Text("Aria AI")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.onSurface)
                        Text(lang.t("版本 1.0.0", "Version 1.0.0"))
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                    }

                    Text(lang.t("智能咨询助手", "Intelligent Consulting Assistant"))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Spacing.lg)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.md)
            }
            .padding(Spacing.xl)
        }
    }

    // MARK: - User Management

    private var userManagementCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                // Card header
                HStack(spacing: Spacing.sm) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary500.opacity(0.1))
                            .frame(width: 32, height: 32)
                        Image(systemName: "person.2.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.primary500)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(lang.t("用户管理", "User Management")).font(TextStyle.titleMD).foregroundColor(.onSurface)
                        Text(lang.t("管理系统账号与权限", "Manage accounts and permissions")).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    }
                    Spacer()
                    Button {
                        showAddUser = true
                        newUserLogin = ""; newUserName = ""; newUserPassword = ""; newUserIsAdmin = false; addUserError = nil
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                            Text(lang.t("添加用户", "Add User")).font(TextStyle.labelSM)
                        }
                        .foregroundColor(.primary500)
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.xs)
                        .background(Color.primary500.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                    }
                    .buttonStyle(.plain)
                }

                Divider().opacity(0.4)

                if let err = userActionError {
                    Text(err).font(TextStyle.labelSM).foregroundColor(.statusFailed)
                }

                if dataStore.allUsers.isEmpty {
                    Text(lang.t("加载中…", "Loading…")).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                } else {
                    VStack(spacing: Spacing.sm) {
                        ForEach(dataStore.allUsers) { user in
                            userRow(user)
                        }
                    }
                }
            }
            .padding(Spacing.xl)
        }
        .task { await dataStore.loadUsers() }
        .sheet(isPresented: $showAddUser) {
            addUserSheet
        }
        .sheet(item: $resetTargetUser) { target in
            resetPasswordSheet(for: target)
        }
    }

    private func userRow(_ user: DataStore.AppUser) -> some View {
        HStack(spacing: Spacing.md) {
            AvatarView(initials: String(user.displayName.prefix(2)).uppercased(), size: 36, gradient: false)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    Text(user.displayName).font(TextStyle.labelMD).foregroundColor(.onSurface)
                    if user.isAdmin {
                        Text("Admin").font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.primary500)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.primary500.opacity(0.1))
                            .clipShape(Capsule())
                    }
                    if !user.isActive {
                        Text(lang.t("已禁用", "Disabled")).font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.statusFailed)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.statusFailed.opacity(0.1))
                            .clipShape(Capsule())
                    }
                }
                Text(user.email).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
            }
            Spacer()
            // Don't show actions for self
            if user.id != dataStore.currentUser?.id {
                Menu {
                    Button(user.isActive ? lang.t("禁用账号", "Disable Account") : lang.t("启用账号", "Enable Account")) {
                        Task {
                            let err = await dataStore.toggleUserActive(userId: user.id, isActive: !user.isActive)
                            userActionError = err
                        }
                    }
                    Button(lang.t("重置密码", "Reset Password")) {
                        resetTargetUser = user
                        resetNewPassword = ""
                        resetPwdError = nil
                    }
                    Divider()
                    Button(lang.t("删除用户", "Delete User"), role: .destructive) {
                        Task {
                            let err = await dataStore.deleteUser(userId: user.id)
                            userActionError = err
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 13)).foregroundColor(.onSurfaceVariant)
                        .frame(width: 28, height: 28)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
            }
        }
        .padding(Spacing.md)
        .background(Color.surfaceContainerHighest.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }

    private var addUserSheet: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            // Header
            HStack(spacing: Spacing.sm) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8).fill(Color.primary500.opacity(0.1)).frame(width: 32, height: 32)
                    Image(systemName: "person.badge.plus").font(.system(size: 14, weight: .semibold)).foregroundColor(.primary500)
                }
                Text(lang.t("添加新用户", "Add New User")).font(TextStyle.titleMD).foregroundColor(.onSurface)
            }

            Divider().opacity(0.4)

            // Username + domain
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("登录账号", "LOGIN ACCOUNT"))
                    .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                HStack(spacing: 0) {
                    TextField("zhang.wei", text: $newUserLogin)
                        .textFieldStyle(.plain).font(TextStyle.bodyMD)
                        .onChange(of: newUserLogin) { _, v in
                            // strip @ if user typed it
                            newUserLogin = v.replacingOccurrences(of: "@", with: "")
                        }
                    Text("@d2cgo.com")
                        .font(TextStyle.bodyMD)
                        .foregroundColor(.onSurfaceVariant)
                        .padding(.leading, 2)
                }
                .padding(Spacing.md)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                .frame(maxWidth: .infinity)
            }

            settingsField(lang.t("显示名称", "DISPLAY NAME")) {
                TextField(lang.t("姓名", "Full name"), text: $newUserName)
                    .textFieldStyle(.plain).font(TextStyle.bodyMD)
            }
            settingsField(lang.t("初始密码（至少6位）", "PASSWORD (min 6 chars)")) {
                SecureField("••••••••", text: $newUserPassword)
                    .textFieldStyle(.plain).font(TextStyle.bodyMD)
            }

            Toggle(lang.t("设为管理员", "Set as Admin"), isOn: $newUserIsAdmin)
                .font(TextStyle.bodyMD).foregroundColor(.onSurface)

            if let err = addUserError {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 11))
                    Text(err)
                }
                .font(TextStyle.labelSM).foregroundColor(.statusFailed)
            }

            HStack(spacing: Spacing.md) {
                SecondaryButton(lang.t("取消", "Cancel"), icon: "xmark") { showAddUser = false }
                PrimaryButton(
                    isAddingUser ? lang.t("创建中…", "Creating…") : lang.t("创建用户", "Create User"),
                    icon: "person.badge.plus"
                ) {
                    addUserError = nil
                    isAddingUser = true
                    let fullEmail = newUserLogin.trimmingCharacters(in: .whitespaces) + "@d2cgo.com"
                    let displayName = newUserName.isEmpty ? newUserLogin : newUserName
                    Task {
                        let err = await dataStore.createUser(
                            email: fullEmail,
                            password: newUserPassword,
                            displayName: displayName,
                            isAdmin: newUserIsAdmin
                        )
                        isAddingUser = false
                        if let err { addUserError = err } else { showAddUser = false }
                    }
                }
                .disabled(newUserLogin.trimmingCharacters(in: .whitespaces).isEmpty || newUserPassword.isEmpty || isAddingUser)
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 420)
    }

    private func resetPasswordSheet(for user: DataStore.AppUser) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            HStack(spacing: Spacing.sm) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8).fill(Color.statusOnHold.opacity(0.1)).frame(width: 32, height: 32)
                    Image(systemName: "key.fill").font(.system(size: 13, weight: .semibold)).foregroundColor(.statusOnHold)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(lang.t("重置密码", "Reset Password")).font(TextStyle.titleMD).foregroundColor(.onSurface)
                    Text(user.email).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                }
            }

            Divider().opacity(0.4)

            settingsField(lang.t("新密码（至少6位）", "NEW PASSWORD (min 6 chars)")) {
                SecureField("••••••••", text: $resetNewPassword)
                    .textFieldStyle(.plain).font(TextStyle.bodyMD)
            }

            if let err = resetPwdError {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 11))
                    Text(err)
                }
                .font(TextStyle.labelSM).foregroundColor(.statusFailed)
            }

            HStack(spacing: Spacing.md) {
                SecondaryButton(lang.t("取消", "Cancel"), icon: "xmark") { resetTargetUser = nil }
                PrimaryButton(
                    isResettingPwd ? lang.t("重置中…", "Resetting…") : lang.t("确认重置", "Confirm Reset"),
                    icon: "checkmark.shield"
                ) {
                    resetPwdError = nil
                    isResettingPwd = true
                    Task {
                        let err = await dataStore.resetUserPassword(userId: user.id, newPassword: resetNewPassword)
                        isResettingPwd = false
                        if let err { resetPwdError = err } else { resetTargetUser = nil }
                    }
                }
                .disabled(resetNewPassword.count < 6 || isResettingPwd)
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 380)
    }

    // MARK: - Helpers

    @ViewBuilder
    private func settingsField<V: View>(_ label: String, @ViewBuilder content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
                .tracking(0.4)
            content()
                .padding(Spacing.md)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                .frame(maxWidth: .infinity)
        }
    }
}
