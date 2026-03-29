import SwiftUI

// MARK: - Block types

private enum MDBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case codeBlock(lang: String, code: String)
    case bulletItem(indent: Int, text: String)
    case numberedItem(n: Int, indent: Int, text: String)
    case table(headers: [String], aligns: [Alignment], rows: [[String]])
    case divider
    case blockquote(String)
}

// MARK: - MarkdownView
// Used for both streaming preview and static AI reply rendering.

struct MarkdownView: View {
    let text: String
    var isStreaming: Bool = false

    var body: some View {
        let blocks = parse(text, isStreaming: isStreaming)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { idx, block in
                blockView(block)
                    .padding(.bottom, spacing(after: block, next: idx + 1 < blocks.count ? blocks[idx + 1] : nil))
            }
        }
    }

    // MARK: Spacing

    private func spacing(after block: MDBlock, next: MDBlock?) -> CGFloat {
        switch block {
        case .heading:   return 10
        case .table:     return 12
        case .divider:   return 12
        case .codeBlock: return 10
        default:
            if case .heading = next { return 14 }
            return 6
        }
    }

    // MARK: Block renderer

    @ViewBuilder
    private func blockView(_ block: MDBlock) -> some View {
        switch block {

        // ── H1 ────────────────────────────────────────────────────────────────
        case .heading(let level, let raw):
            inlineText(raw)
                .font(headingFont(level))
                .foregroundColor(.onSurface)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .padding(.top, level == 1 ? 4 : 2)

        // ── Paragraph ─────────────────────────────────────────────────────────
        case .paragraph(let raw):
            inlineText(raw)
                .font(TextStyle.bodyMD)
                .foregroundColor(.onSurface)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

        // ── Code block ────────────────────────────────────────────────────────
        case .codeBlock(let lang, let code):
            codeBlockView(lang: lang, code: code)

        // ── Bullet ────────────────────────────────────────────────────────────
        case .bulletItem(let indent, let raw):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(indent == 0 ? "•" : "◦")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary500)
                    .frame(width: 12, alignment: .center)
                inlineText(raw)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, CGFloat(indent) * 14)

        // ── Numbered list ─────────────────────────────────────────────────────
        case .numberedItem(let n, let indent, let raw):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(n).")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.primary500)
                    .frame(minWidth: 20, alignment: .trailing)
                inlineText(raw)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, CGFloat(indent) * 14)

        // ── Table ─────────────────────────────────────────────────────────────
        case .table(let headers, let aligns, let rows):
            MarkdownTableView(headers: headers, aligns: aligns, rows: rows)

        // ── Divider ───────────────────────────────────────────────────────────
        case .divider:
            Divider()
                .opacity(0.25)
                .padding(.vertical, 2)

        // ── Blockquote ────────────────────────────────────────────────────────
        case .blockquote(let raw):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.primary500.opacity(0.4))
                    .frame(width: 3)
                inlineText(raw)
                    .font(TextStyle.bodyMD.italic())
                    .foregroundColor(.onSurfaceVariant)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 2)
        }
    }

    // MARK: Heading font

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .system(size: 16, weight: .bold)
        case 2: return .system(size: 14, weight: .semibold)
        default: return .system(size: 13, weight: .semibold)
        }
    }

    // MARK: Code block

    @ViewBuilder
    private func codeBlockView(lang: String, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if !lang.isEmpty {
                HStack {
                    Text(lang.lowercased())
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.onSurfaceVariant.opacity(0.5))
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(Color.surfaceContainerHighest.opacity(0.6))
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(Color(red: 0.15, green: 0.47, blue: 0.28))
                    .lineSpacing(3)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .background(Color.surfaceContainerHighest.opacity(0.35))
        }
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay(
            RoundedRectangle(cornerRadius: 7)
                .strokeBorder(Color.outlineVariant.opacity(0.2), lineWidth: 1)
        )
    }

    // MARK: Inline text

    private func inlineText(_ raw: String) -> Text { mdInlineText(raw) }
}

/// Module-level inline markdown renderer shared by MarkdownView and MarkdownTableView.
private func mdInlineText(_ raw: String) -> Text {
    if let attr = try? AttributedString(
        markdown: raw,
        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    ) { return Text(attr) }
    return Text(raw)
}

// MARK: - Table View

struct MarkdownTableView: View {
    let headers: [String]
    let aligns: [Alignment]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow { ForEach(Array(headers.enumerated()), id: \.offset) { headerCell($0, $1) } }
                GridRow { Divider().frame(height: 1).background(Color.primary500.opacity(0.2)).gridCellColumns(headers.count) }
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    GridRow { ForEach(0..<headers.count, id: \.self) { dataCell(col: $0, row: row, rowIdx: rowIdx) } }
                    if rowIdx < rows.count - 1 {
                        GridRow { Color.outlineVariant.opacity(0.2).frame(height: 0.5).gridCellColumns(headers.count) }
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary500.opacity(0.15), lineWidth: 1))
    }

    @ViewBuilder
    private func headerCell(_ idx: Int, _ text: String) -> some View {
        mdInlineText(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(.onSurface)
            .lineLimit(3)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(minWidth: 72, maxWidth: .infinity, alignment: alignment(for: idx))
            .background(Color.primary500.opacity(0.07))
            .textSelection(.enabled)
            .overlay(alignment: .trailing) {
                if idx < headers.count - 1 { Rectangle().fill(Color.primary500.opacity(0.15)).frame(width: 1) }
            }
    }

    @ViewBuilder
    private func dataCell(col: Int, row: [String], rowIdx: Int) -> some View {
        mdInlineText(col < row.count ? row[col] : "")
            .font(.system(size: 12))
            .foregroundColor(.onSurface)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .frame(minWidth: 72, maxWidth: .infinity, alignment: alignment(for: col))
            .background(rowIdx % 2 == 0 ? Color.clear : Color.onSurface.opacity(0.025))
            .textSelection(.enabled)
            .overlay(alignment: .trailing) {
                if col < headers.count - 1 { Rectangle().fill(Color.outlineVariant.opacity(0.3)).frame(width: 1) }
            }
    }

    private func alignment(for col: Int) -> Alignment {
        guard col < aligns.count else { return .leading }
        return aligns[col]
    }
}

// MARK: - Body view (wraps MarkdownView for AI reply messages)

struct MarkdownBodyView: View {
    let content: String
    var body: some View {
        MarkdownView(text: content)
    }
}

// MARK: - Parser

private func parse(_ input: String, isStreaming: Bool = false) -> [MDBlock] {
    var blocks: [MDBlock] = []
    let lines = input.components(separatedBy: "\n")
    var i = 0
    var pendingLines: [String] = []

    func flushParagraph() {
        let joined = pendingLines
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !joined.isEmpty { blocks.append(.paragraph(joined)) }
        pendingLines = []
    }

    while i < lines.count {
        let line    = lines[i]
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        // ── Code block ────────────────────────────────────────────────────────
        if trimmed.hasPrefix("```") {
            flushParagraph()
            let lang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            var codeLines: [String] = []
            i += 1
            var foundClose = false
            while i < lines.count {
                let codeLine = lines[i]
                if codeLine.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    foundClose = true; i += 1; break
                }
                codeLines.append(codeLine); i += 1
            }
            if isStreaming && !foundClose && i >= lines.count {
                var plainLines = ["```" + lang]
                plainLines.append(contentsOf: codeLines)
                pendingLines.append(contentsOf: plainLines)
            } else {
                blocks.append(.codeBlock(lang: lang, code: codeLines.joined(separator: "\n")))
            }
            continue
        }

        // ── Table ─────────────────────────────────────────────────────────────
        if trimmed.hasPrefix("|") {
            flushParagraph()
            var tableLines: [String] = [trimmed]
            i += 1
            while i < lines.count && lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                tableLines.append(lines[i].trimmingCharacters(in: .whitespaces)); i += 1
            }
            if isStreaming && tableLines.count < 2 {
                pendingLines.append(contentsOf: tableLines)
            } else if let tableBlock = parseTable(tableLines) {
                blocks.append(tableBlock)
            } else {
                pendingLines.append(contentsOf: tableLines)
            }
            continue
        }

        // ── Blockquote ────────────────────────────────────────────────────────
        if trimmed.hasPrefix("> ") {
            flushParagraph()
            blocks.append(.blockquote(String(trimmed.dropFirst(2))))
            i += 1; continue
        }

        // ── Heading ───────────────────────────────────────────────────────────
        if trimmed.hasPrefix("#") {
            flushParagraph()
            var level = 0; var rest = trimmed
            while rest.hasPrefix("#") { level += 1; rest = String(rest.dropFirst()) }
            blocks.append(.heading(level: min(level, 3),
                                   text: rest.trimmingCharacters(in: .whitespaces)))
            i += 1; continue
        }

        // ── Divider ───────────────────────────────────────────────────────────
        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            flushParagraph(); blocks.append(.divider); i += 1; continue
        }

        // ── Bullet list ───────────────────────────────────────────────────────
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        let indent = leadingSpaces / 2
        if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("• ") {
            flushParagraph()
            blocks.append(.bulletItem(indent: indent, text: String(trimmed.dropFirst(2))))
            i += 1; continue
        }

        // ── Numbered list ─────────────────────────────────────────────────────
        if let (n, text) = parseNumberedItem(trimmed) {
            flushParagraph()
            blocks.append(.numberedItem(n: n, indent: indent, text: text))
            i += 1; continue
        }

        // ── Empty line ────────────────────────────────────────────────────────
        if trimmed.isEmpty { flushParagraph(); i += 1; continue }

        pendingLines.append(line); i += 1
    }

    flushParagraph()
    return blocks
}

private func parseTable(_ lines: [String]) -> MDBlock? {
    guard lines.count >= 2 else { return nil }

    func cells(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s = String(s.dropFirst()) }
        if s.hasSuffix("|") { s = String(s.dropLast()) }
        return s.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    let headers = cells(lines[0])
    let sepLine  = lines[1]
    let isSep    = sepLine.allSatisfy { $0 == "|" || $0 == "-" || $0 == ":" || $0 == " " }
    guard isSep else { return nil }

    let sepCells = cells(sepLine)
    let aligns: [Alignment] = sepCells.map { cell in
        let l = cell.hasPrefix(":"), r = cell.hasSuffix(":")
        if l && r { return .center }
        if r      { return .trailing }
        return .leading
    }
    let rows = lines.dropFirst(2).map { cells($0) }
    return .table(headers: headers, aligns: aligns, rows: rows)
}

private func parseNumberedItem(_ line: String) -> (Int, String)? {
    guard let dotIdx = line.firstIndex(of: ".") else { return nil }
    let numStr = String(line[line.startIndex..<dotIdx])
    guard let n = Int(numStr) else { return nil }
    let afterDot = line.index(after: dotIdx)
    guard afterDot < line.endIndex, line[afterDot] == " " else { return nil }
    return (n, String(line[line.index(after: afterDot)...]))
}

// MARK: - Plain text conversion (for clipboard copy button)

func markdownToPlainText(_ markdown: String) -> String {
    let blocks = parse(markdown)
    var lines: [String] = []
    for block in blocks {
        switch block {
        case .heading(_, let text):    lines.append(stripInline(text))
        case .paragraph(let text):     lines.append(stripInline(text))
        case .codeBlock(_, let code):  lines.append(code)
        case .bulletItem(let indent, let text):
            lines.append(String(repeating: "  ", count: indent) + "• " + stripInline(text))
        case .numberedItem(let n, let indent, let text):
            lines.append(String(repeating: "  ", count: indent) + "\(n). " + stripInline(text))
        case .table(let headers, _, let rows):
            lines.append(headers.joined(separator: "\t"))
            for row in rows { lines.append(row.joined(separator: "\t")) }
        case .divider:   lines.append("———")
        case .blockquote(let text): lines.append(stripInline(text))
        }
    }
    return lines.joined(separator: "\n")
}

private func stripInline(_ text: String) -> String {
    var s = text
    s = s.replacingOccurrences(of: #"\*\*(.+?)\*\*"#, with: "$1", options: .regularExpression)
    s = s.replacingOccurrences(of: #"__(.+?)__"#,    with: "$1", options: .regularExpression)
    s = s.replacingOccurrences(of: #"\*(.+?)\*"#,    with: "$1", options: .regularExpression)
    s = s.replacingOccurrences(of: #"_(.+?)_"#,      with: "$1", options: .regularExpression)
    s = s.replacingOccurrences(of: #"`(.+?)`"#,      with: "$1", options: .regularExpression)
    s = s.replacingOccurrences(of: #"\[(.+?)\]\(.+?\)"#, with: "$1", options: .regularExpression)
    return s
}

// MARK: - Legacy helpers (kept for compatibility)

func markdownAsSingleText(_ content: String) -> Text {
    // Kept so existing callers compile; MarkdownBodyView is preferred
    Text(markdownToPlainText(content))
}
