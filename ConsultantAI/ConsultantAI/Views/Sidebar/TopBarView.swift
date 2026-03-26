import SwiftUI

// MARK: - Page Top Bar (title + subtitle + trailing actions)
struct TopBarView<Actions: View>: View {
    let title: String
    let subtitle: String?
    let actions: Actions

    init(title: String, subtitle: String? = nil, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.subtitle = subtitle
        self.actions = actions()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(TextStyle.headlineMD)
                        .foregroundColor(.onSurface)
                    if let subtitle {
                        Text(subtitle)
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                    }
                }
                Spacer()
                actions
            }
            .padding(.horizontal, Spacing.xxl)
            .padding(.vertical, Spacing.lg)

            Divider().opacity(0.4)
        }
        .background(.surfaceContainerLowest)
    }
}
