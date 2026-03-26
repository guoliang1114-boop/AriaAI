import SwiftUI

struct ProfileView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    
    // Profile
    @State private var displayName = ""
    @State private var email = ""
    @State private var profileSaved = false
    
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                // Profile Card
                profileCard
            }
            .padding(Spacing.xxl)
        }
        .background(.surfaceBase)
        .task {
            displayName = UserDefaults.standard.string(forKey: "profileDisplayName") ?? "Active Profile"
            email = UserDefaults.standard.string(forKey: "profileEmail") ?? ""
        }
    }
    
    // MARK: - Profile Card
    private var profileCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                sectionHeader(
                    icon: "person.fill",
                    title: lang.t("个人信息", "Personal Info"),
                    subtitle: lang.t("管理您的账号信息", "Manage your account information")
                )
                
                Divider().opacity(0.4)
                
                // Avatar Section
                HStack(spacing: Spacing.lg) {
                    AvatarView(
                        initials: String(displayName.prefix(2)).uppercased(),
                        size: 72,
                        gradient: true
                    )
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text(displayName.isEmpty ? lang.t("未设置名称", "No name set") : displayName)
                            .font(TextStyle.headlineSM)
                            .foregroundColor(.onSurface)
                        
                        if !email.isEmpty {
                            Text(email)
                                .font(TextStyle.bodyMD)
                                .foregroundColor(.onSurfaceVariant)
                        }
                        
                        if let user = dataStore.currentUser {
                            HStack(spacing: Spacing.xs) {
                                Text(user.email)
                                    .font(TextStyle.bodySM)
                                    .foregroundColor(.onSurfaceVariant)
                                
                                if user.isAdmin {
                                    Text("Admin")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundColor(.primary500)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(Color.primary500.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                    
                    Spacer()
                }
                .padding(Spacing.lg)
                .background(Color.surfaceContainerHighest.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                
                // Edit Fields
                VStack(alignment: .leading, spacing: Spacing.md) {
                    settingsField(lang.t("显示名称", "Display Name")) {
                        TextField(lang.t("输入您的名字", "Enter your name"), text: $displayName)
                            .textFieldStyle(.plain)
                    }
                    
                    settingsField(lang.t("邮箱地址", "Email")) {
                        TextField("email@example.com", text: $email)
                            .textFieldStyle(.plain)
                            .disabled(true)
                            .foregroundColor(.onSurfaceVariant)
                    }
                }
                
                HStack {
                    Spacer()
                    PrimaryButton(
                        profileSaved ? lang.t("已保存 ✓", "Saved ✓") : lang.t("保存资料", "Save Profile"),
                        icon: "checkmark"
                    ) {
                        saveProfile()
                    }
                    .disabled(profileSaved || displayName.isEmpty)
                }
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Helpers
    private func sectionHeader(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: Spacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.primary500.opacity(0.1))
                    .frame(width: 36, height: 36)
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.primary500)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TextStyle.titleMD)
                    .foregroundColor(.onSurface)
                Text(subtitle)
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
            }
            
            Spacer()
        }
    }
    
    @ViewBuilder
    private func settingsField<V: View>(_ label: String, @ViewBuilder content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
            content()
                .padding(Spacing.md)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
    }
    
    // MARK: - Actions
    private func saveProfile() {
        UserDefaults.standard.set(displayName, forKey: "profileDisplayName")
        UserDefaults.standard.set(email, forKey: "profileEmail")
        profileSaved = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            profileSaved = false
        }
    }
}
