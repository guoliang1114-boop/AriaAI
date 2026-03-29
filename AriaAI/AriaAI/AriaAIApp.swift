import SwiftUI
import AppKit

// SPM executables default to .accessory activation policy — windows never become
// key window, so TextFields receive no keyboard events at all.
// AppDelegate sets .regular before launch so the app behaves like a normal .app bundle.
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct AriaAIApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppStateManager()
    @StateObject private var dataStore = DataStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(dataStore)
                .preferredColorScheme(.light)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 1280, height: 800)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("新建对话") {
                    NotificationCenter.default.post(name: NSNotification.Name("NewConversation"), object: nil)
                }
                .keyboardShortcut("n", modifiers: .command)
            }
        }
    }
}

// MARK: - App State Manager
class AppStateManager: ObservableObject {
    @Published var isAuthenticated: Bool {
        didSet { UserDefaults.standard.set(isAuthenticated, forKey: "isAuthenticated") }
    }
    @Published var selectedScreen: AppScreen = .projects
    @Published var selectedProject: Project? = nil
    /// API skill ID to activate when Chat opens (set by SkillsView)
    @Published var pendingSkillId: Int? = nil
    /// Pre-filled chat input text (set by ProjectSpaceView)
    @Published var pendingChatInput: String? = nil
    /// Triggers ChatView to create a new conversation on appear
    @Published var pendingNewConversation: Bool = false
    /// Conversation ID to select when Chat opens (set by SidebarView for instant new chat)
    @Published var pendingConversationId: Int? = nil
    /// UI language preference, persisted in UserDefaults
    @Published var language: AppLanguage {
        didSet { UserDefaults.standard.set(language.rawValue, forKey: "appLanguage") }
    }

    init() {
        let saved = UserDefaults.standard.string(forKey: "appLanguage") ?? "zh"
        language = AppLanguage(rawValue: saved) ?? .zh
        isAuthenticated = UserDefaults.standard.bool(forKey: "isAuthenticated")
    }
}

// MARK: - Root View
struct RootView: View {
    @EnvironmentObject var appState: AppStateManager

    var body: some View {
        Group {
            if appState.isAuthenticated {
                MainWorkbenchView()
            } else {
                LoginView()
            }
        }
        .environment(\.appLanguage, appState.language)
        .animation(.easeInOut(duration: 0.25), value: appState.isAuthenticated)
        .onReceive(NotificationCenter.default.publisher(for: .sessionExpired)) { _ in
            appState.isAuthenticated = false
            UserDefaults.standard.removeObject(forKey: "authToken")
        }
    }
}

// MARK: - Main Workbench (Sidebar + Content)
struct MainWorkbenchView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang

    private var apiProjectId: Int? {
        guard let p = appState.selectedProject else { return nil }
        return dataStore.apiProjects.first { $0.name == p.name }?.id
    }

    private var profileInitials: String {
        let name = UserDefaults.standard.string(forKey: "profileDisplayName") ?? ""
        let parts = name.split(separator: " ").compactMap { $0.first.map { String($0) } }
        if parts.count >= 2 { return (parts[0] + parts[1]).uppercased() }
        let prefix = String(name.prefix(2)).uppercased()
        return prefix.isEmpty ? "ME" : prefix
    }

    var body: some View {
        VStack(spacing: 0) {
            // ── Full-width project header (project context only) ──
            if let project = appState.selectedProject {
                projectHeader(project: project)
            }

            HStack(spacing: 0) {
                SidebarView()
                    .frame(width: appState.selectedProject != nil ? 260 : Layout.sidebarWidth)

                Divider()
                    .opacity(0)

                ZStack {
                    Color.surfaceBase
                        .ignoresSafeArea()

                    Group {
                        switch appState.selectedScreen {
                        case .chat:
                            ChatView()
                        case .skills:
                            SkillsView()
                        case .projects:
                            if let project = appState.selectedProject {
                                ProjectSpaceView(project: project)
                            } else {
                                ProjectsView()
                            }
                        case .clients:
                            ClientsView()
                        case .knowledgeBase:
                            KnowledgeBaseView()
                        case .schedules:
                            SchedulesView()
                        case .templates:
                            TemplatesView()
                        case .settings:
                            SettingsView()
                        }
                    }
                    .transition(.opacity)
                }
            }
        }
        .frame(minWidth: Layout.minWindowWidth, minHeight: Layout.minWindowHeight)
        .background(.surfaceContainerLow)
        .animation(.easeInOut(duration: 0.2), value: appState.selectedScreen)
        .task { await dataStore.loadAll() }
    }

    @ViewBuilder
    private func projectHeader(project: Project) -> some View {
        let statusAccent = Color(hex: project.status.color)
        ZStack(alignment: .leading) {
            Color.surfaceContainerLowest
            Rectangle()
                .fill(statusAccent)
                .frame(width: 3)
                .frame(maxHeight: .infinity)
            HStack(spacing: 0) {
                HStack(spacing: Spacing.xs) {
                    Button { appState.selectedProject = nil } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 10, weight: .semibold))
                            Text(lang.t("全部项目", "All Projects"))
                                .font(TextStyle.labelSM)
                        }
                        .foregroundColor(.primary500)
                    }
                    .buttonStyle(.plain)
                    Text("/")
                        .font(.system(size: 11))
                        .foregroundColor(.onSurfaceVariant.opacity(0.35))
                    Text(project.name)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.onSurface)
                        .lineLimit(1)
                }
                .padding(.leading, Spacing.lg + 4)

                Spacer()

                HStack(spacing: Spacing.lg) {
                    if let pid = apiProjectId {
                        Menu {
                            Button(lang.t("删除项目", "Delete Project"), role: .destructive) {
                                Task {
                                    await dataStore.deleteProject(apiId: pid)
                                    appState.selectedProject = nil
                                }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 13))
                                .foregroundColor(.onSurfaceVariant)
                        }
                        .menuStyle(.borderlessButton)
                        .fixedSize()
                    }
                    AvatarView(initials: profileInitials, gradient: true)
                }
                .padding(.trailing, Spacing.xxl)
            }
        }
        .frame(height: 44)
        .overlay(Divider().opacity(0.5), alignment: .bottom)
    }
}
