import SwiftUI

struct AboutView: View {
    @Environment(\.appLanguage) var lang
    
    // Get version info from Bundle
    var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }
    
    var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
    
    var buildDate: String {
        // Get build timestamp from Info.plist if available, otherwise use current date
        if let timestamp = Bundle.main.infoDictionary?["BuildTimestamp"] as? String {
            return timestamp
        }
        // Format current date
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy.MM.dd"
        return formatter.string(from: Date())
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                // App Info Card
                appInfoCard
                
                // Features Card
                featuresCard
                
                // Credits Card
                creditsCard
            }
            .padding(Spacing.xxl)
        }
        .background(.surfaceBase)
    }
    
    // MARK: - App Info Card
    private var appInfoCard: some View {
        CardContainer {
            VStack(spacing: Spacing.xl) {
                // App Icon
                ZStack {
                    RoundedRectangle(cornerRadius: 24)
                        .fill(LinearGradient(
                            colors: [.primary600, .primary500],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ))
                        .frame(width: 120, height: 120)
                        .shadow(color: Color.primary500.opacity(0.3), radius: 20, x: 0, y: 10)
                    
                    Image(systemName: "sparkles")
                        .font(.system(size: 48, weight: .semibold))
                        .foregroundColor(.white)
                }
                
                VStack(spacing: Spacing.xs) {
                    Text("Aria AI")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(.onSurface)
                    
                    Text(lang.t("智能咨询助手", "Intelligent Consulting Assistant"))
                        .font(TextStyle.bodyMD)
                        .foregroundColor(.onSurfaceVariant)
                }
                
                // Version Info
                HStack(spacing: Spacing.xl) {
                    VersionInfoItem(
                        label: lang.t("版本", "Version"),
                        value: appVersion
                    )
                    
                    Divider().frame(height: 30)
                    
                    VersionInfoItem(
                        label: lang.t("构建号", "Build"),
                        value: buildNumber
                    )
                    
                    Divider().frame(height: 30)
                    
                    VersionInfoItem(
                        label: lang.t("构建日期", "Date"),
                        value: buildDate
                    )
                }
                .padding(.top, Spacing.md)
            }
            .padding(Spacing.xxl)
            .frame(maxWidth: .infinity)
        }
    }
    
    // MARK: - Features Card
    private var featuresCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                sectionHeader(
                    icon: "star.fill",
                    title: lang.t("功能特性", "Features"),
                    subtitle: lang.t("Aria AI 的核心能力", "Core capabilities of Aria AI")
                )
                
                Divider().opacity(0.4)
                
                VStack(spacing: Spacing.md) {
                    FeatureRow(
                        icon: "bubble.left.and.bubble.right.fill",
                        title: lang.t("智能对话", "Smart Chat"),
                        description: lang.t("基于 Claude 和 Kimi 的多轮对话", "Multi-turn chat powered by Claude & Kimi")
                    )
                    
                    FeatureRow(
                        icon: "folder.fill",
                        title: lang.t("项目管理", "Project Management"),
                        description: lang.t("组织和管理您的咨询项目", "Organize and manage your consulting projects")
                    )
                    
                    FeatureRow(
                        icon: "checklist",
                        title: lang.t("任务追踪", "Task Tracking"),
                        description: lang.t("AI 生成的任务清单和进度跟踪", "AI-generated task lists with progress tracking")
                    )
                    
                    FeatureRow(
                        icon: "brain.fill",
                        title: lang.t("专家角色", "Expert Roles"),
                        description: lang.t("切换不同领域的专家视角", "Switch between domain expert perspectives")
                    )
                    
                    FeatureRow(
                        icon: "doc.text.fill",
                        title: lang.t("文档导出", "Document Export"),
                        description: lang.t("导出 Markdown 和 Word 格式报告", "Export reports in Markdown and Word formats")
                    )
                }
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Credits Card
    private var creditsCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                sectionHeader(
                    icon: "heart.fill",
                    title: lang.t("技术支持", "Powered By"),
                    subtitle: lang.t("构建此应用的优秀技术", "Technologies that power this app")
                )
                
                Divider().opacity(0.4)
                
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Spacing.md) {
                    CreditItem(name: "SwiftUI", description: "Apple")
                    CreditItem(name: "FastAPI", description: "Python")
                    CreditItem(name: "PostgreSQL", description: "Database")
                    CreditItem(name: "Claude", description: "Anthropic")
                    CreditItem(name: "Kimi", description: "Moonshot AI")
                    CreditItem(name: "OpenAI", description: "GPT Models")
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
}

// MARK: - Version Info Item
struct VersionInfoItem: View {
    let label: String
    let value: String
    
    var body: some View {
        VStack(spacing: 4) {
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
            Text(value)
                .font(TextStyle.bodyMD)
                .foregroundColor(.onSurface)
        }
    }
}

// MARK: - Feature Row
struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String
    
    var body: some View {
        HStack(spacing: Spacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.primary500.opacity(0.1))
                    .frame(width: 44, height: 44)
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(.primary500)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TextStyle.titleSM)
                    .foregroundColor(.onSurface)
                Text(description)
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

// MARK: - Credit Item
struct CreditItem: View {
    let name: String
    let description: String
    
    var body: some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                Text(description)
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
