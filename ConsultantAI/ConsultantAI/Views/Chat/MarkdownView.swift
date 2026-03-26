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

struct MarkdownView: View {
    let text: String
    var isStreaming: Bool = false  // 流式模式：容错处理未闭合结构

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            let blocks = parse(text, isStreaming: isStreaming)
            ForEach(Array(blocks.enumerated()), id: \.offset) { idx, block in
                blockView(block)
                    .padding(.bottom, blockSpacing(block, next: idx + 1 < blocks.count ? blocks[idx + 1] : nil))
            }
        }
        .textSelection(.enabled)
    }

    private func blockSpacing(_ block: MDBlock, next: MDBlock?) -> CGFloat {
        switch block {
        case .heading: return 10
        case .table:   return 14
        case .divider: return 12
        default:
            switch next {
            case .heading: return 14
            default:       return 7
            }
        }
    }

    // MARK: - Block renderer

    @ViewBuilder
    private func blockView(_ block: MDBlock) -> some View {
        switch block {

        // ── Headings ────────────────────────────────────────────────────────
        case .heading(let level, let raw):
            headingView(level: level, text: raw)

        // ── Paragraph ───────────────────────────────────────────────────────
        case .paragraph(let raw):
            inlineText(raw)
                .font(TextStyle.bodyMD)
                .foregroundColor(.onSurface)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)

        // ── Code block ──────────────────────────────────────────────────────
        case .codeBlock(let lang, let code):
            codeBlockView(lang: lang, code: code)

        // ── Bullet ──────────────────────────────────────────────────────────
        case .bulletItem(let indent, let raw):
            HStack(alignment: .top, spacing: 8) {
                Text(indent == 0 ? "•" : "◦")
                    .font(.system(size: 13))
                    .foregroundColor(.primary500)
                    .frame(width: 14)
                    .padding(.top, 1)
                inlineText(raw)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, CGFloat(indent) * 16)

        // ── Numbered ────────────────────────────────────────────────────────
        case .numberedItem(let n, let indent, let raw):
            HStack(alignment: .top, spacing: 8) {
                Text("\(n).")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.primary500)
                    .frame(minWidth: 18, alignment: .trailing)
                    .padding(.top, 1)
                inlineText(raw)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, CGFloat(indent) * 16)

        // ── Table ────────────────────────────────────────────────────────────
        case .table(let headers, let aligns, let rows):
            MarkdownTableView(headers: headers, aligns: aligns, rows: rows)

        // ── Divider ──────────────────────────────────────────────────────────
        case .divider:
            Divider().opacity(0.35)

        // ── Blockquote ───────────────────────────────────────────────────────
        case .blockquote(let raw):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.primary400)
                    .frame(width: 3)
                inlineText(raw)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurfaceVariant)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 2)
        }
    }

    // MARK: - Heading view

    @ViewBuilder
    private func headingView(level: Int, text: String) -> some View {
        switch level {
        case 1:
            VStack(alignment: .leading, spacing: 5) {
                Text(text)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.onSurface)
                    .lineSpacing(2)
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color.primary500, Color.primary500.opacity(0)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: 1.5)
            }
            .padding(.top, 4)

        case 2:
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.primary500)
                    .frame(width: 3, height: 18)
                Text(text)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.onSurface)
            }
            .padding(.top, 2)

        default:
            Text(text)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.onSurfaceVariant)
                .tracking(0.3)
                .padding(.top, 1)
        }
    }

    // MARK: - Code block view

    @ViewBuilder
    private func codeBlockView(lang: String, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header bar
            HStack {
                HStack(spacing: 5) {
                    ForEach([Color(red: 1, green: 0.37, blue: 0.34),
                             Color(red: 1, green: 0.73, blue: 0.18),
                             Color(red: 0.18, green: 0.78, blue: 0.44)], id: \.self) { c in
                        Circle().fill(c).frame(width: 8, height: 8)
                    }
                }
                Spacer()
                if !lang.isEmpty {
                    Text(lang.uppercased())
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundColor(.onSurfaceVariant)
                        .tracking(0.8)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.surfaceContainerHighest)

            Divider().opacity(0.4)

            // Code content
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundColor(Color(red: 0.18, green: 0.55, blue: 0.34))
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color(red: 0.97, green: 0.98, blue: 0.97))
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(Color.outlineVariant.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - Inline markdown

    private func inlineText(_ raw: String) -> Text {
        if let attr = try? AttributedString(
            markdown: raw,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attr)
        }
        return Text(raw)
    }
}

// MARK: - Table View

private struct MarkdownTableView: View {
    let headers: [String]
    let aligns: [Alignment]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            // Grid automatically makes each column as wide as its widest cell.
            // horizontalSpacing:1 + separator background color = column dividers.
            Grid(horizontalSpacing: 1, verticalSpacing: 0) {
                // Header
                GridRow {
                    ForEach(Array(headers.enumerated()), id: \.offset) { idx, header in
                        Text(header)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.onSurfaceVariant)
                            .tracking(0.5)
                            .lineLimit(2)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(minWidth: 60, minHeight: 38, alignment: alignment(for: idx))
                            .background(Color.surfaceContainerHighest)
                    }
                }

                Rectangle()
                    .fill(Color.outlineVariant.opacity(0.6))
                    .frame(height: 1)

                // Data rows
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    GridRow {
                        ForEach(0..<headers.count, id: \.self) { col in
                            cellText(col < row.count ? row[col] : "")
                                .font(.system(size: 13))
                                .foregroundColor(.onSurface)
                                .lineSpacing(2)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .frame(minWidth: 60, minHeight: 36, alignment: alignment(for: col))
                                .background(rowIdx % 2 == 0
                                    ? Color.clear
                                    : Color.primary600.opacity(0.025))
                        }
                    }

                    if rowIdx < rows.count - 1 {
                        Rectangle()
                            .fill(Color.outlineVariant.opacity(0.3))
                            .frame(height: 0.5)
                    }
                }
            }
            .background(Color.outlineVariant.opacity(0.35)) // shows through 1pt gaps → column lines
            .fixedSize()                                     // size to content, not parent width
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(Color.outlineVariant.opacity(0.5), lineWidth: 1)
        )
        .shadow(color: Color.primary600.opacity(0.04), radius: 8, x: 0, y: 2)
    }

    private func cellText(_ raw: String) -> Text {
        if let attr = try? AttributedString(
            markdown: raw,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attr)
        }
        return Text(raw)
    }

    private func alignment(for col: Int) -> Alignment {
        guard col < aligns.count else { return .leading }
        return aligns[col]
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
        let line   = lines[i]
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        // ── Code block ───────────────────────────────────────────────────────
        if trimmed.hasPrefix("```") {
            flushParagraph()
            let lang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            var codeLines: [String] = []
            i += 1
            var foundClose = false
            while i < lines.count {
                let codeLine = lines[i]
                if codeLine.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    foundClose = true
                    i += 1
                    break
                }
                codeLines.append(codeLine)
                i += 1
            }
            
            // 流式模式下：如果代码块未闭合，当作普通文本渲染（避免把后续所有内容当代码）
            if isStreaming && !foundClose && i >= lines.count {
                // 未闭合的代码块，当作普通段落
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
            while i < lines.count &&
                  lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                tableLines.append(lines[i].trimmingCharacters(in: .whitespaces))
                i += 1
            }
            
            // 流式模式下：表格至少需要2行（header + separator）
            if isStreaming && tableLines.count < 2 {
                // 表格不完整，当作普通段落
                pendingLines.append(contentsOf: tableLines)
            } else if let tableBlock = parseTable(tableLines) {
                blocks.append(tableBlock)
            } else {
                // 解析失败，当作普通段落
                pendingLines.append(contentsOf: tableLines)
            }
            continue
        }

        // ── Blockquote ────────────────────────────────────────────────────────
        if trimmed.hasPrefix("> ") {
            flushParagraph()
            blocks.append(.blockquote(String(trimmed.dropFirst(2))))
            i += 1
            continue
        }

        // ── Heading ───────────────────────────────────────────────────────────
        if trimmed.hasPrefix("#") {
            flushParagraph()
            var level = 0
            var rest = trimmed
            while rest.hasPrefix("#") { level += 1; rest = String(rest.dropFirst()) }
            blocks.append(.heading(level: min(level, 3),
                                   text: rest.trimmingCharacters(in: .whitespaces)))
            i += 1
            continue
        }

        // ── Divider ───────────────────────────────────────────────────────────
        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            flushParagraph()
            blocks.append(.divider)
            i += 1
            continue
        }

        // ── Bullet list ───────────────────────────────────────────────────────
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        let indent = leadingSpaces / 2
        if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("• ") {
            flushParagraph()
            blocks.append(.bulletItem(indent: indent, text: String(trimmed.dropFirst(2))))
            i += 1
            continue
        }

        // ── Numbered list ─────────────────────────────────────────────────────
        if let (n, text) = parseNumberedItem(trimmed) {
            flushParagraph()
            blocks.append(.numberedItem(n: n, indent: indent, text: text))
            i += 1
            continue
        }

        // ── Empty line ────────────────────────────────────────────────────────
        if trimmed.isEmpty {
            flushParagraph()
            i += 1
            continue
        }

        pendingLines.append(line)
        i += 1
    }

    flushParagraph()
    return blocks
}

// Parse markdown table, respecting alignment markers
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

    // Parse alignment from separator row
    let sepCells = cells(sepLine)
    let aligns: [Alignment] = sepCells.map { cell in
        let l = cell.hasPrefix(":")
        let r = cell.hasSuffix(":")
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

// MARK: - Color extension helper

private extension Color {
    static var primary400: Color { Color(red: 0.46, green: 0.62, blue: 0.98) }
}
