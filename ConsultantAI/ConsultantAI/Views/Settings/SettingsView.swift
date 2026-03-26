import SwiftUI

enum SettingsTab: String, CaseIterable {
    case aiConfig = "AI 配置"
    case server = "服务器配置"
    case profile = "个人资料"
    case language = "语言"
    case users = "用户管理"
    case about = "关于"
    
    var icon: String {
        switch self {
        case .aiConfig: return "cpu"
        case .server: return "server.rack"
        case .profile: return "person.fill"
        case .language: return "globe"
        case .users: return "person.2.fill"
        case .about: return "info.circle.fill"
        }
    }
    
    func localized(_ lang: AppLanguage) -> String {
        switch self {
        case .aiConfig: return lang.t("AI 配置", "AI Config")
        case .server: return lang.t("服务器配置", "Server")
        case .profile: return lang.t("个人资料", "Profile")
        case .language: return lang.t("语言", "Language")
        case .users: return lang.t("用户管理", "Users")
        case .about: return lang.t("关于", "About")
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    
    @State private var selectedTab: SettingsTab = .aiConfig
    
    var body: some View {
        HStack(spacing: 0) {
            // Sidebar
            sidebar
                .frame(width: 220)
                .background(Color.surfaceContainerLow)

            Divider()

            // Content
            contentView
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.surfaceBase)
        }
    }
    
    // MARK: - Sidebar
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("设置", "Settings"))
                    .font(TextStyle.headlineMD)
                    .foregroundColor(.onSurface)
                Text(lang.t("配置与偏好", "Configuration"))
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.xl)
            .padding(.bottom, Spacing.lg)
            
            Divider()
            
            // Navigation Items
            ScrollView {
                VStack(spacing: Spacing.xs) {
                    ForEach(SettingsTab.allCases, id: \.self) { tab in
                        if tab == .users && dataStore.currentUser?.isAdmin != true {
                            // Only show users tab for admins
                            EmptyView()
                        } else {
                            SidebarItem(
                                icon: tab.icon,
                                title: tab.localized(lang),
                                isSelected: selectedTab == tab
                            ) {
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    selectedTab = tab
                                }
                            }
                        }
                    }
                }
                .padding(Spacing.sm)
            }
            
            Spacer()
        }
    }
    
    // MARK: - Content View
    @ViewBuilder
    private var contentView: some View {
        switch selectedTab {
        case .aiConfig:
            AIConfigView()
        case .server:
            ServerConfigView()
        case .profile:
            ProfileView()
        case .language:
            LanguageView()
        case .users:
            UserManagementView()
        case .about:
            AboutView()
        }
    }
}

// MARK: - Sidebar Item
struct SidebarItem: View {
    let icon: String
    let title: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: isSelected ? .semibold : .regular))
                    .foregroundColor(isSelected ? .primary500 : .onSurfaceVariant)
                    .frame(width: 20)
                
                Text(title)
                    .font(TextStyle.bodyMD)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundColor(isSelected ? .onSurface : .onSurfaceVariant)
                
                Spacer()
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(isSelected ? Color.primary500.opacity(0.1) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }
}
