import SwiftUI
import AppKit

/// Multiline text input that correctly ignores Enter/Return during IME composition
/// (Chinese Pinyin, Japanese Kana, etc.).
///
/// SwiftUI's `.onKeyPress` fires BEFORE the input method handles the event,
/// causing IME candidate-confirmation Enter to accidentally send messages.
/// NSTextView's `textView(_:doCommandBy:)` fires AFTER the IME decides not to
/// handle the keystroke, so `hasMarkedText()` reliably detects composition state.
struct ChatTextField: NSViewRepresentable {

    @Binding var text: String
    @Binding var dynamicHeight: CGFloat
    let placeholder: String
    let isDisabled: Bool
    let onSubmit: () -> Void
    let onChange: (String) -> Void

    // Single-line height baseline (system font 14pt)
    static let lineH: CGFloat = 19
    static let minH:  CGFloat = lineH + 10
    static let maxH:  CGFloat = lineH * 5 + 10

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let sv = NSScrollView()
        sv.hasVerticalScroller   = false
        sv.hasHorizontalScroller = false
        sv.drawsBackground = false
        sv.borderType      = .noBorder
        sv.autohidesScrollers = true

        let tv = context.coordinator.textView
        tv.delegate = context.coordinator
        sv.documentView = tv
        return sv
    }

    func updateNSView(_ sv: NSScrollView, context: Context) {
        let tv = context.coordinator.textView
        if tv.string != text { tv.string = text }
        tv.isEditable = !isDisabled
        tv.alphaValue = isDisabled ? 0.4 : 1
        context.coordinator.parent = self
        tv.needsDisplay = true
        context.coordinator.recalcHeight()
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ChatTextField

        lazy var textView: PlaceholderTextView = {
            let tv = PlaceholderTextView()
            tv.isRichText   = false
            tv.drawsBackground = false
            tv.isVerticallyResizable   = true
            tv.isHorizontallyResizable = false
            tv.autoresizingMask = .width
            tv.textContainer?.widthTracksTextView = true
            tv.textContainer?.lineFragmentPadding = 0
            tv.font      = .systemFont(ofSize: 14)
            tv.textColor = .labelColor
            tv.coordinator = self
            return tv
        }()

        init(_ p: ChatTextField) { parent = p }

        func textDidChange(_ n: Notification) {
            guard let tv = n.object as? NSTextView else { return }
            parent.text = tv.string
            parent.onChange(tv.string)
            tv.needsDisplay = true
            recalcHeight()
        }

        /// Called after the IME has decided NOT to handle the command.
        /// When composing, the IME swallows insertNewline: itself — so if we
        /// reach here it is a real "send" Enter (not a candidate-confirm Enter).
        func textView(_ tv: NSTextView, doCommandBy sel: Selector) -> Bool {
            guard sel == #selector(NSResponder.insertNewline(_:)) else { return false }
            // Safety-net: if marked text still exists, let the system handle it
            if tv.hasMarkedText() { return false }
            // Shift+Enter → insert a real newline
            if NSApp.currentEvent?.modifierFlags.contains(.shift) == true { return false }
            parent.onSubmit()
            return true
        }

        func recalcHeight() {
            guard let container = textView.textContainer,
                  let manager   = textView.layoutManager else { return }
            manager.ensureLayout(for: container)
            let used = manager.usedRect(for: container).height
            let new  = min(max(used + 10, ChatTextField.minH), ChatTextField.maxH)
            if abs(new - parent.dynamicHeight) > 0.5 {
                DispatchQueue.main.async { self.parent.dynamicHeight = new }
            }
        }
    }
}

// MARK: - NSTextView subclass that draws placeholder text

final class PlaceholderTextView: NSTextView {
    weak var coordinator: ChatTextField.Coordinator?

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty,
              let ph = coordinator?.parent.placeholder,
              !ph.isEmpty else { return }
        let attrs: [NSAttributedString.Key: Any] = [
            .font:            font ?? NSFont.systemFont(ofSize: 14),
            .foregroundColor: NSColor.placeholderTextColor
        ]
        ph.draw(at: NSPoint(x: 2, y: 1), withAttributes: attrs)
    }
}
