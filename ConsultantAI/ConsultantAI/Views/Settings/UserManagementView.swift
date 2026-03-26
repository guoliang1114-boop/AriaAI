import SwiftUI

struct UserManagementView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    
    @State private var showAddUser = false
    @State private var newUserLogin = ""
    @State private var newUserName = ""
    @State private var newUserPassword = ""
    @State private var newUserIsAdmin = false
    @State private var addUserError: String? = nil
    @State private var isAddingUser = false
    @State private var userActionError: String? = nil
    
    @State private var resetTargetUser: DataStore.AppUser? = nil
    @State private var resetNewPassword = ""
    @State private var isResettingPwd = false
    @State private var resetPwdError: String? = nil
    
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                // Stats Card
                statsCard
                
                // Users List Card
                usersListCard
            }
            .padding(Spacing.xxl)
        }
        .background(.surfaceBase)
        .task {
            await dataStore.loadUsers()
        }
        .sheet(isPresented: $showAddUser) {
            addUserSheet
        }
        .sheet(item: $resetTargetUser) { target in
            resetPasswordSheet(for: target)
        }
    }
    
    // MARK: - Stats Card
    private var statsCard: some View {
        CardContainer {
            HStack(spacing: Spacing.xl) {
                StatItem(
                    icon: "person.2.fill",
                    value: "\(dataStore.allUsers.count)",
                    label: lang.t("总用户", "Total Users")
                )
                
                Divider().frame(height: 50)
                
                StatItem(
                    icon: "checkmark.circle.fill",
                    value: "\(dataStore.allUsers.filter(\.isActive).count)",
                    label: lang.t("活跃用户", "Active")
                )
                
                Divider().frame(height: 50)
                
                StatItem(
                    icon: "shield.fill",
                    value: "\(dataStore.allUsers.filter(\.isAdmin).count)",
                    label: lang.t("管理员", "Admins")
                )
                
                Spacer()
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Users List Card
    private var usersListCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Header
                HStack(spacing: Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.primary500.opacity(0.1))
                            .frame(width: 36, height: 36)
                        Image(systemName: "person.2.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.primary500)
                    }
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(lang.t("用户管理", "User Management"))
                            .font(TextStyle.titleMD)
                            .foregroundColor(.onSurface)
                        Text(lang.t("管理系统账号与权限", "Manage accounts and permissions"))
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                    }
                    
                    Spacer()
                    
                    PrimaryButton(lang.t("添加用户", "Add User"), icon: "plus") {
                        showAddUser = true
                        newUserLogin = ""
                        newUserName = ""
                        newUserPassword = ""
                        newUserIsAdmin = false
                        addUserError = nil
                    }
                }
                
                Divider().opacity(0.4)
                
                if let err = userActionError {
                    HStack(spacing: Spacing.xs) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.statusFailed)
                        Text(err)
                            .font(TextStyle.bodySM)
                    }
                    .foregroundColor(.statusFailed)
                    .padding(Spacing.md)
                    .background(Color.statusFailed.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                
                if dataStore.allUsers.isEmpty {
                    VStack(spacing: Spacing.lg) {
                        Image(systemName: "person.2.slash")
                            .font(.system(size: 48))
                            .foregroundColor(.onSurfaceVariant.opacity(0.5))
                        Text(lang.t("暂无用户数据", "No users yet"))
                            .font(TextStyle.bodyMD)
                            .foregroundColor(.onSurfaceVariant)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.xxl)
                } else {
                    VStack(spacing: Spacing.md) {
                        ForEach(dataStore.allUsers) { user in
                            UserRow(
                                user: user,
                                isCurrentUser: user.id == dataStore.currentUser?.id,
                                onToggleActive: { toggleUserActive(user) },
                                onResetPassword: { resetTargetUser = user },
                                onDelete: { deleteUser(user) }
                            )
                        }
                    }
                }
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Add User Sheet
    private var addUserSheet: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            HStack(spacing: Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.primary500.opacity(0.1))
                        .frame(width: 36, height: 36)
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.primary500)
                }
                
                Text(lang.t("添加新用户", "Add New User"))
                    .font(TextStyle.titleMD)
                    .foregroundColor(.onSurface)
                
                Spacer()
            }
            
            Divider().opacity(0.4)
            
            // Username
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("登录账号", "Login Account"))
                    .font(TextStyle.labelSM)
                    .foregroundColor(.onSurfaceVariant)
                
                HStack(spacing: 0) {
                    TextField("zhang.wei", text: $newUserLogin)
                        .textFieldStyle(.plain)
                        .onChange(of: newUserLogin) { _, v in
                            newUserLogin = v.replacingOccurrences(of: "@", with: "")
                        }
                    
                    Text("@d2cgo.com")
                        .foregroundColor(.onSurfaceVariant)
                }
                .padding(Spacing.md)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            }
            
            // Display Name
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("显示名称", "Display Name"))
                    .font(TextStyle.labelSM)
                    .foregroundColor(.onSurfaceVariant)
                
                TextField(lang.t("姓名", "Full name"), text: $newUserName)
                    .textFieldStyle(.plain)
                    .padding(Spacing.md)
                    .background(Color.surfaceContainerHighest)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            }
            
            // Password
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("初始密码（至少6位）", "Password (min 6 chars)"))
                    .font(TextStyle.labelSM)
                    .foregroundColor(.onSurfaceVariant)
                
                SecureField("••••••••", text: $newUserPassword)
                    .textFieldStyle(.plain)
                    .padding(Spacing.md)
                    .background(Color.surfaceContainerHighest)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            }
            
            // Admin Toggle
            Toggle(lang.t("设为管理员", "Set as Admin"), isOn: $newUserIsAdmin)
                .font(TextStyle.bodyMD)
            
            if let err = addUserError {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundColor(.statusFailed)
                    Text(err)
                }
                .font(TextStyle.labelSM)
                .foregroundColor(.statusFailed)
            }
            
            HStack(spacing: Spacing.md) {
                SecondaryButton(lang.t("取消", "Cancel"), icon: "xmark") {
                    showAddUser = false
                }
                
                Spacer()
                
                PrimaryButton(
                    isAddingUser ? lang.t("创建中...", "Creating...") : lang.t("创建用户", "Create User"),
                    icon: "person.badge.plus"
                ) {
                    createUser()
                }
                .disabled(newUserLogin.trimmingCharacters(in: .whitespaces).isEmpty || newUserPassword.count < 6 || isAddingUser)
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 420)
    }
    
    // MARK: - Reset Password Sheet
    private func resetPasswordSheet(for user: DataStore.AppUser) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            HStack(spacing: Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.statusOnHold.opacity(0.1))
                        .frame(width: 36, height: 36)
                    Image(systemName: "key.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.statusOnHold)
                }
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(lang.t("重置密码", "Reset Password"))
                        .font(TextStyle.titleMD)
                        .foregroundColor(.onSurface)
                    Text(user.email)
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                
                Spacer()
            }
            
            Divider().opacity(0.4)
            
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("新密码（至少6位）", "New Password (min 6 chars)"))
                    .font(TextStyle.labelSM)
                    .foregroundColor(.onSurfaceVariant)
                
                SecureField("••••••••", text: $resetNewPassword)
                    .textFieldStyle(.plain)
                    .padding(Spacing.md)
                    .background(Color.surfaceContainerHighest)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            }
            
            if let err = resetPwdError {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundColor(.statusFailed)
                    Text(err)
                }
                .font(TextStyle.labelSM)
                .foregroundColor(.statusFailed)
            }
            
            HStack(spacing: Spacing.md) {
                SecondaryButton(lang.t("取消", "Cancel"), icon: "xmark") {
                    resetTargetUser = nil
                }
                
                Spacer()
                
                PrimaryButton(
                    isResettingPwd ? lang.t("重置中...", "Resetting...") : lang.t("确认重置", "Confirm Reset"),
                    icon: "checkmark.shield"
                ) {
                    resetPassword(for: user)
                }
                .disabled(resetNewPassword.count < 6 || isResettingPwd)
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 380)
    }
    
    // MARK: - Actions
    private func createUser() {
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
            if let err {
                addUserError = err
            } else {
                showAddUser = false
            }
        }
    }
    
    private func toggleUserActive(_ user: DataStore.AppUser) {
        Task {
            let err = await dataStore.toggleUserActive(userId: user.id, isActive: !user.isActive)
            userActionError = err
        }
    }
    
    private func resetPassword(for user: DataStore.AppUser) {
        resetPwdError = nil
        isResettingPwd = true
        Task {
            let err = await dataStore.resetUserPassword(userId: user.id, newPassword: resetNewPassword)
            isResettingPwd = false
            if let err {
                resetPwdError = err
            } else {
                resetTargetUser = nil
            }
        }
    }
    
    private func deleteUser(_ user: DataStore.AppUser) {
        Task {
            let err = await dataStore.deleteUser(userId: user.id)
            userActionError = err
        }
    }
}

// MARK: - Stat Item
struct StatItem: View {
    let icon: String
    let value: String
    let label: String
    
    var body: some View {
        HStack(spacing: Spacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.primary500.opacity(0.1))
                    .frame(width: 48, height: 48)
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(.primary500)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.onSurface)
                Text(label)
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
            }
        }
    }
}

// MARK: - User Row
struct UserRow: View {
    let user: DataStore.AppUser
    let isCurrentUser: Bool
    let onToggleActive: () -> Void
    let onResetPassword: () -> Void
    let onDelete: () -> Void
    
    @Environment(\.appLanguage) var lang
    
    var body: some View {
        HStack(spacing: Spacing.md) {
            AvatarView(
                initials: String(user.displayName.prefix(2)).uppercased(),
                size: 44,
                gradient: false
            )
            
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Spacing.xs) {
                    Text(user.displayName)
                        .font(TextStyle.bodyMD)
                        .foregroundColor(.onSurface)
                    
                    if user.isAdmin {
                        Text("Admin")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.primary500)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.primary500.opacity(0.12))
                            .clipShape(Capsule())
                    }
                    
                    if !user.isActive {
                        Text(lang.t("已禁用", "Disabled"))
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.statusFailed)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.statusFailed.opacity(0.12))
                            .clipShape(Capsule())
                    }
                    
                    if isCurrentUser {
                        Text(lang.t("我", "Me"))
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.statusActive)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.statusActive.opacity(0.12))
                            .clipShape(Capsule())
                    }
                }
                
                Text(user.email)
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
            }
            
            Spacer()
            
            if !isCurrentUser {
                Menu {
                    Button(user.isActive ? lang.t("禁用账号", "Disable Account") : lang.t("启用账号", "Enable Account")) {
                        onToggleActive()
                    }
                    
                    Button(lang.t("重置密码", "Reset Password")) {
                        onResetPassword()
                    }
                    
                    Divider()
                    
                    Button(lang.t("删除用户", "Delete User"), role: .destructive) {
                        onDelete()
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14))
                        .foregroundColor(.onSurfaceVariant)
                        .frame(width: 32, height: 32)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
            }
        }
        .padding(Spacing.md)
        .background(Color.surfaceContainerHighest.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }
}
