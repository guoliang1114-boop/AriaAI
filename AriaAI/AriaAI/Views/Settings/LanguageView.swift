import SwiftUI

struct LanguageView: View {
    @EnvironmentObject var appState: AppStateManager
    @Environment(\.appLanguage) var lang
    
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                // Language Selection Card
                CardContainer {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        sectionHeader(
                            icon: "globe",
                            title: lang.t("界面语言", "Interface Language"),
                            subtitle: lang.t("选择您偏好的显示语言", "Choose your preferred display language")
                        )
                        
                        Divider().opacity(0.4)
                        
                        VStack(spacing: Spacing.md) {
                            LanguageOption(
                                flag: "🇨🇳",
                                name: "简体中文",
                                englishName: "Simplified Chinese",
                                isSelected: appState.language == .zh
                            ) {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    appState.language = .zh
                                }
                            }
                            
                            LanguageOption(
                                flag: "🇺🇸",
                                name: "English",
                                englishName: "English",
                                isSelected: appState.language == .en
                            ) {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    appState.language = .en
                                }
                            }
                        }
                    }
                    .padding(Spacing.xl)
                }
                
                // Preview Card
                CardContainer {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        HStack(spacing: Spacing.md) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.primary500.opacity(0.1))
                                    .frame(width: 36, height: 36)
                                Image(systemName: "eye.fill")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.primary500)
                            }
                            
                            VStack(alignment: .leading, spacing: 2) {
                                Text(lang.t("预览", "Preview"))
                                    .font(TextStyle.titleMD)
                                    .foregroundColor(.onSurface)
                                Text(lang.t("当前语言的界面预览", "Interface preview in current language"))
                                    .font(TextStyle.bodySM)
                                    .foregroundColor(.onSurfaceVariant)
                            }
                            
                            Spacer()
                        }
                        
                        Divider().opacity(0.4)
                        
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            PreviewRow(
                                icon: "bubble.left.fill",
                                title: lang.t("对话", "Chat"),
                                subtitle: lang.t("开始新的对话", "Start a new conversation")
                            )
                            PreviewRow(
                                icon: "folder.fill",
                                title: lang.t("项目", "Projects"),
                                subtitle: lang.t("管理您的项目", "Manage your projects")
                            )
                            PreviewRow(
                                icon: "checklist",
                                title: lang.t("任务", "Tasks"),
                                subtitle: lang.t("查看待办任务", "View your tasks")
                            )
                            PreviewRow(
                                icon: "gearshape.fill",
                                title: lang.t("设置", "Settings"),
                                subtitle: lang.t("配置应用选项", "Configure app settings")
                            )
                        }
                    }
                    .padding(Spacing.xl)
                }
            }
            .padding(Spacing.xxl)
        }
        .background(.surfaceBase)
    }
    
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
}

// MARK: - Language Option
struct LanguageOption: View {
    let flag: String
    let name: String
    let englishName: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.lg) {
                Text(flag)
                    .font(.system(size: 32))
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(TextStyle.titleSM)
                        .foregroundColor(.onSurface)
                    Text(englishName)
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                
                Spacer()
                
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(.primary500)
                } else {
                    Circle()
                        .stroke(Color.onSurfaceVariant.opacity(0.3), lineWidth: 2)
                        .frame(width: 24, height: 24)
                }
            }
            .padding(Spacing.lg)
            .background(isSelected ? Color.primary500.opacity(0.05) : Color.surfaceContainerHigh.opacity(0.3))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.md)
                    .stroke(isSelected ? Color.primary500 : Color.clear, lineWidth: 2)
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Preview Row
struct PreviewRow: View {
    let icon: String
    let title: String
    let subtitle: String
    
    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(.primary500)
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                Text(subtitle)
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
            }
            
            Spacer()
        }
        .padding(Spacing.md)
        .background(Color.surfaceContainerHighest.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }
}
