import SwiftUI

enum Theme {
    static let ink = Color(red: 41.0/255, green: 41.0/255, blue: 45.0/255)
    static let secondary = Color(red: 104.0/255, green: 104.0/255, blue: 110.0/255)
    static let background = Color(red: 247.0/255, green: 247.0/255, blue: 248.0/255)
    static let line = Color(red: 0.90, green: 0.91, blue: 0.93)
    static let accent = Color(red: 15.0/255, green: 143.0/255, blue: 114.0/255)
}

struct AriaMark: View {
    var size: CGFloat = 44
    var circular = false
    var body: some View {
        Text("A")
            .font(.system(size: size * 0.58, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Theme.ink, in: RoundedRectangle(cornerRadius: circular ? size / 2 : size * 0.28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: circular ? size / 2 : size * 0.28, style: .continuous).stroke(Theme.line.opacity(0.75), lineWidth: 1))
            .accessibilityLabel("Aria")
    }
}

struct SurfaceCard<Content: View>: View {
    private let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        content.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line.opacity(0.7), lineWidth: 0.7))
    }
}

struct SectionEyebrow: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View {
        Text(title).font(.caption.weight(.medium)).foregroundStyle(Theme.secondary).tracking(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Pill: View {
    let text: String
    var systemImage: String? = nil
    var selected = false
    var body: some View {
        HStack(spacing: 6) {
            if let systemImage { Image(systemName: systemImage) }
            Text(text)
        }
        .font(.subheadline.weight(selected ? .semibold : .regular))
        .foregroundStyle(selected ? Color.white : Theme.secondary)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(selected ? Theme.ink : Color.white, in: Capsule())
        .overlay(Capsule().stroke(selected ? Color.clear : Theme.line, lineWidth: 0.7))
    }
}

struct PrimaryButton: View {
    let title: String
    let action: () -> Void
    init(_ title: String, action: @escaping () -> Void) { self.title = title; self.action = action }
    var body: some View {
        Button(action: action) {
            Text(title).font(.body.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 14)
        }
        .buttonStyle(.plain).foregroundStyle(.white)
        .background(Theme.ink, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct IconButton: View {
    let symbol: String
    let label: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 19, weight: .regular))
                .frame(width: 44, height: 44).contentShape(Circle())
        }.buttonStyle(.plain).foregroundStyle(Theme.ink).accessibilityLabel(label)
    }
}

struct EmptyState: View {
    var symbol: String
    var title: String
    var detail: String
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 31, weight: .light))
                .foregroundStyle(Theme.secondary).frame(width: 76, height: 76)
                .background(.white, in: RoundedRectangle(cornerRadius: 24))
            Text(title).font(.headline).foregroundStyle(Theme.ink)
            Text(detail).font(.subheadline).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 56).padding(.horizontal, 24)
    }
}
