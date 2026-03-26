// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Aria AI",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Aria AI", targets: ["ConsultantAI"])
    ],
    targets: [
        .executableTarget(
            name: "ConsultantAI",
            path: "ConsultantAI",
            sources: [
                "ConsultantAIApp.swift",
                "Localization.swift",
                "Design/DesignSystem.swift",
                "Models/Models.swift",
                "Services/APIClient.swift",
                "Services/APIModels.swift",
                "Services/DataStore.swift",
                "Views/Auth/LoginView.swift",
                "Views/Sidebar/SidebarView.swift",
                "Views/Sidebar/TopBarView.swift",
                "Views/Sidebar/GlobalStatusBar.swift",
                "Views/Projects/ProjectsView.swift",
                "Views/Chat/ChatView.swift",
                "Views/Chat/ChatTextField.swift",
                "Views/Chat/MarkdownView.swift",
                "Views/ProjectSpace/ProjectSpaceView.swift",
                "Views/KnowledgeBase/KnowledgeBaseView.swift",
                "Views/Skills/SkillsView.swift",
                "Views/Schedules/SchedulesView.swift",
                "Views/Templates/TemplatesView.swift",
                "Views/Settings/SettingsView.swift",
                "Views/Settings/AIConfigView.swift",
                "Views/Settings/ServerConfigView.swift",
                "Views/Settings/ProfileView.swift",
                "Views/Settings/LanguageView.swift",
                "Views/Settings/UserManagementView.swift",
                "Views/Settings/AboutView.swift",
                "Views/Clients/ClientsView.swift"
            ],
            resources: [
                .process("Assets.xcassets")
            ]
        )
    ]
)
