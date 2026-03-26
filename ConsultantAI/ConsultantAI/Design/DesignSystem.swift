import SwiftUI

// MARK: - Color Tokens
// MARK: - ShapeStyle convenience (allows .background(.surfaceBase) syntax)
extension ShapeStyle where Self == Color {
    static var primary600: Color { Color(hex: "#003fb1") }
    static var primary500: Color { Color(hex: "#1a56db") }
    static var primaryFixed: Color { Color(hex: "#dce1ff") }
    static var onPrimaryFixed: Color { Color(hex: "#001258") }
    static var surfaceBase: Color { Color(hex: "#f9f9fb") }
    static var surfaceContainerLow: Color { Color(hex: "#f3f3f5") }
    static var surfaceContainerLowest: Color { Color(hex: "#ffffff") }
    static var surfaceContainerHigh: Color { Color(hex: "#e8e8ea") }
    static var surfaceContainerHighest: Color { Color(hex: "#e2e2e4") }
    static var surfaceBright: Color { Color(hex: "#f5f5f7") }
    static var surfaceDim: Color { Color(hex: "#dadadc") }
    static var onSurface: Color { Color(hex: "#1a1c1d") }
    static var onSurfaceVariant: Color { Color(hex: "#44474a") }
    static var outlineVariant: Color { Color(hex: "#c4c7ca") }
    static var secondaryContainer: Color { Color(hex: "#dde3ea") }
    static var onSecondaryContainer: Color { Color(hex: "#131c27") }
    static var statusActive: Color { Color(hex: "#1a8a4a") }
    static var statusOnHold: Color { Color(hex: "#c4760a") }
    static var statusCompleted: Color { Color(hex: "#44474a") }
    static var statusFailed: Color { Color(hex: "#b3261e") }
    static var tagDeepTask: Color { Color(hex: "#dce1ff") }
    static var tagQuickTool: Color { Color(hex: "#dde3ea") }
    static var tagArchival: Color { Color(hex: "#f0e6d3") }
}

extension Color {
    // Primary
    static let primary600 = Color(hex: "#003fb1")
    static let primary500 = Color(hex: "#1a56db")
    static let primaryFixed = Color(hex: "#dce1ff")
    static let onPrimaryFixed = Color(hex: "#001258")
    static let primaryContainer = Color(hex: "#b8c4ff")

    // Surface Hierarchy (The "No-Line" Rule)
    static let surfaceBase = Color(hex: "#f9f9fb")          // Main canvas
    static let surfaceContainerLow = Color(hex: "#f3f3f5")  // Sidebar
    static let surfaceContainerLowest = Color(hex: "#ffffff") // Cards
    static let surfaceContainerHigh = Color(hex: "#e8e8ea")  // User chat bubble
    static let surfaceContainerHighest = Color(hex: "#e2e2e4") // Search bars
    static let surfaceBright = Color(hex: "#f5f5f7")         // Hover state
    static let surfaceDim = Color(hex: "#dadadc")

    // On Surface
    static let onSurface = Color(hex: "#1a1c1d")
    static let onSurfaceVariant = Color(hex: "#44474a")
    static let outlineVariant = Color(hex: "#c4c7ca")

    // Secondary
    static let secondaryContainer = Color(hex: "#dde3ea")
    static let onSecondaryContainer = Color(hex: "#131c27")

    // Status
    static let statusActive = Color(hex: "#1a8a4a")
    static let statusOnHold = Color(hex: "#c4760a")
    static let statusCompleted = Color(hex: "#44474a")
    static let statusFailed = Color(hex: "#b3261e")

    // Tag backgrounds
    static let tagDeepTask = Color(hex: "#dce1ff")
    static let tagQuickTool = Color(hex: "#dde3ea")
    static let tagArchival = Color(hex: "#f0e6d3")
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(.sRGB,
                  red: Double(r) / 255,
                  green: Double(g) / 255,
                  blue: Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}

// MARK: - Spacing
enum Spacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
}

// MARK: - Corner Radius
enum Radius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let xl: CGFloat = 16
    static let pill: CGFloat = 100
}

// MARK: - Typography
enum TextStyle {
    static let displayLG = Font.system(size: 36, weight: .bold, design: .default)
    static let headlineLG = Font.system(size: 24, weight: .semibold, design: .default)
    static let headlineMD = Font.system(size: 20, weight: .semibold, design: .default)
    static let headlineSM = Font.system(size: 18, weight: .semibold, design: .default)
    static let titleMD = Font.system(size: 15, weight: .semibold, design: .default)
    static let titleSM = Font.system(size: 13, weight: .semibold, design: .default)
    static let bodyMD = Font.system(size: 14, weight: .regular, design: .default)
    static let bodySM = Font.system(size: 13, weight: .regular, design: .default)
    static let labelMD = Font.system(size: 12, weight: .medium, design: .default)
    static let labelSM = Font.system(size: 11, weight: .medium, design: .default)
}

// MARK: - Sidebar Width
enum Layout {
    static let sidebarWidth: CGFloat = 220
    static let rightPanelWidth: CGFloat = 280
    static let minWindowWidth: CGFloat = 1100
    static let minWindowHeight: CGFloat = 700
}

// MARK: - Shared Components

struct TagView: View {
    let label: String
    let style: TagStyle

    enum TagStyle {
        case deepTask, quickTool, archival, success, warning, error, neutral

        var bg: Color {
            switch self {
            case .deepTask: return .tagDeepTask
            case .quickTool: return .tagQuickTool
            case .archival: return .tagArchival
            case .success: return Color(hex: "#d4edda")
            case .warning: return Color(hex: "#fff3cd")
            case .error: return Color(hex: "#f8d7da")
            case .neutral: return .surfaceContainerHigh
            }
        }
        var fg: Color {
            switch self {
            case .deepTask: return .onPrimaryFixed
            case .quickTool: return .onSecondaryContainer
            case .archival: return Color(hex: "#5c3d11")
            case .success: return Color(hex: "#155724")
            case .warning: return Color(hex: "#856404")
            case .error: return Color(hex: "#721c24")
            case .neutral: return .onSurfaceVariant
            }
        }
    }

    var body: some View {
        Text(label.uppercased())
            .font(TextStyle.labelSM)
            .tracking(0.5)
            .foregroundColor(style.fg)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, 3)
            .background(style.bg)
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
    }
}

struct PrimaryButton: View {
    let label: String
    let icon: String?
    let action: () -> Void

    init(_ label: String, icon: String? = nil, action: @escaping () -> Void) {
        self.label = label
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.xs) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .semibold))
                }
                Text(label)
                    .font(TextStyle.titleSM)
            }
            .foregroundColor(.white)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm + 2)
            .background(
                LinearGradient(
                    colors: [.primary600, .primary500],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }
}

struct SecondaryButton: View {
    let label: String
    let icon: String?
    let action: () -> Void

    init(_ label: String, icon: String? = nil, action: @escaping () -> Void) {
        self.label = label
        self.icon = icon
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.xs) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 12, weight: .medium))
                }
                Text(label)
                    .font(TextStyle.labelMD)
            }
            .foregroundColor(.onSurface)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(.surfaceContainerHigh)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }
}

struct SearchBar: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.onSurfaceVariant)
                .font(.system(size: 13))
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(TextStyle.bodyMD)
                .foregroundColor(.onSurface)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm + 1)
        .background(.surfaceContainerHighest)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }
}

struct SectionHeader: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(TextStyle.labelSM)
            .tracking(0.8)
            .foregroundColor(.onSurfaceVariant)
    }
}

struct StatusDot: View {
    let status: DotStatus

    enum DotStatus {
        case active, onHold, completed, failed, synced, processing

        var color: Color {
            switch self {
            case .active: return .statusActive
            case .onHold: return .statusOnHold
            case .completed: return .statusCompleted
            case .failed: return .statusFailed
            case .synced: return .statusActive
            case .processing: return .statusOnHold
            }
        }
        var label: String {
            switch self {
            case .active: return "Active"
            case .onHold: return "On Hold"
            case .completed: return "Completed"
            case .failed: return "Failed"
            case .synced: return "Synced"
            case .processing: return "Processing"
            }
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(status.color)
                .frame(width: 7, height: 7)
            Text(status.label)
                .font(TextStyle.labelSM)
                .foregroundColor(status.color)
        }
    }
}

struct CardContainer<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(.surfaceContainerLowest)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
            .shadow(
                color: Color.primary600.opacity(0.06),
                radius: 20,
                x: 0,
                y: 4
            )
    }
}

// MARK: - Progress Bar
struct ProgressBar: View {
    let progress: Double      // 0.0 – 1.0
    var height: CGFloat = 6
    var color: Color = .primary500
    var trackColor: Color = .surfaceContainerHigh

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(trackColor).frame(height: height)
                Capsule()
                    .fill(color)
                    .frame(width: geo.size.width * min(max(progress, 0), 1), height: height)
            }
        }
        .frame(height: height)
    }
}

// MARK: - AI Logo View
struct AILogoView: View {
    var size: CGFloat = 32
    var cornerRadius: CGFloat = 7
    var fontSize: CGFloat = 13

    var body: some View {
        Group {
            if let iconImage = NSImage(named: "AppIcon") {
                Image(nsImage: iconImage)
                    .resizable()
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .fill(LinearGradient(
                            colors: [.primary600, .primary500],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ))
                        .frame(width: size, height: size)
                    Text("A")
                        .font(.system(size: fontSize, weight: .bold))
                        .foregroundColor(.white)
                }
            }
        }
    }
}

// MARK: - Avatar View
struct AvatarView: View {
    let initials: String
    var size: CGFloat = 28
    var background: Color = .primary500
    var gradient: Bool = false

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    gradient
                    ? AnyShapeStyle(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                    : AnyShapeStyle(background)
                )
                .frame(width: size, height: size)
            Text(initials)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundColor(.white)
        }
    }
}

// MARK: - Workbench Nav Bar (shared top bar with DRAFTS/SHARED/ARCHIVED tabs)
struct WorkbenchNavBar: View {
    @Binding var selectedTab: String
    var tabs: [String] = ["DRAFTS", "SHARED", "ARCHIVED"]
    var trailing: AnyView?

    init(selectedTab: Binding<String>, tabs: [String] = ["DRAFTS", "SHARED", "ARCHIVED"], @ViewBuilder trailing: () -> some View) {
        self._selectedTab = selectedTab
        self.tabs = tabs
        self.trailing = AnyView(trailing())
    }

    var body: some View {
        HStack(spacing: 0) {
            Text("Aria AI")
                .font(TextStyle.titleSM)
                .foregroundColor(.onSurfaceVariant)
                .padding(.leading, Spacing.xxl)

            HStack(spacing: 0) {
                ForEach(tabs, id: \.self) { tab in
                    Button { selectedTab = tab } label: {
                        Text(tab)
                            .font(TextStyle.labelMD)
                            .foregroundColor(selectedTab == tab ? .primary500 : .onSurfaceVariant)
                            .padding(.horizontal, Spacing.lg)
                            .padding(.vertical, Spacing.md)
                            .overlay(
                                Rectangle()
                                    .frame(height: 2)
                                    .foregroundColor(selectedTab == tab ? .primary500 : .clear),
                                alignment: .bottom
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer()
            trailing
        }
        .frame(height: 44)
        .background(.surfaceContainerLowest)
        .overlay(Divider(), alignment: .bottom)
    }
}

// MARK: - Separated List (divider between rows, no leading/trailing dividers)
struct SeparatedList<Data: RandomAccessCollection, Row: View>: View where Data.Element: Identifiable {
    let items: Data
    let row: (Data.Element) -> Row

    init(_ items: Data, @ViewBuilder row: @escaping (Data.Element) -> Row) {
        self.items = items
        self.row = row
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                row(item)
                if idx < items.count - 1 {
                    Color.surfaceContainerHigh.frame(height: 1).opacity(0.5)
                }
            }
        }
        .background(.surfaceContainerLowest)
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
    }
}
