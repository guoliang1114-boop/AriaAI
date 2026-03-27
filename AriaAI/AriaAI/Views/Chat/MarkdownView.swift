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
        case .heading: return 6
        case .table:   return 8
        case .divider: return 8
        default:
            switch next {
            case .heading: return 8
            default:       return 4
            }
        }
    }

    // MARK: - Block renderer

    @ViewBuilder
    private func blockView(_ block: MDBlock) -> some View {
        Group {
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
        .textSelection(.enabled)
    }

    // MARK: - Heading view

    @ViewBuilder
    private func headingView(level: Int, text: String) -> some View {
        switch level {
        case 1:
            Text(text)
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.onSurface)

        case 2:
            Text(text)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.onSurface)

        default:
            Text(text)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.onSurfaceVariant)
        }
    }

    // MARK: - Code block view

    @ViewBuilder
    private func codeBlockView(lang: String, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // 简化的代码块头部
            if !lang.isEmpty {
                HStack {
                    Text(lang.lowercased())
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(.onSurfaceVariant.opacity(0.6))
                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color.surfaceContainerHighest.opacity(0.5))
            }

            // Code content
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(Color(red: 0.2, green: 0.5, blue: 0.3))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.surfaceContainerHighest.opacity(0.3))
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
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
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.onSurfaceVariant)
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .frame(minWidth: 50, minHeight: 28, alignment: alignment(for: idx))
                            .background(Color.surfaceContainerHighest.opacity(0.7))
                    }
                }

                Rectangle()
                    .fill(Color.outlineVariant.opacity(0.4))
                    .frame(height: 0.5)

                // Data rows
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    GridRow {
                        ForEach(0..<headers.count, id: \.self) { col in
                            cellText(col < row.count ? row[col] : "")
                                .font(.system(size: 12))
                                .foregroundColor(.onSurface)
                                .lineSpacing(1)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .frame(minWidth: 50, minHeight: 28, alignment: alignment(for: col))
                                .background(rowIdx % 2 == 0
                                    ? Color.clear
                                    : Color.primary600.opacity(0.02))
                        }
                    }

                    if rowIdx < rows.count - 1 {
                        Rectangle()
                            .fill(Color.outlineVariant.opacity(0.3))
                            .frame(height: 0.5)
                    }
                }
            }
            .background(Color.outlineVariant.opacity(0.25))
            .fixedSize()
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
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

// MARK: - Plain text conversion (for clipboard)

/// Converts markdown content to clean plain text suitable for pasting.
/// Strips syntax markers, preserves structure with indentation and bullets.
func markdownToPlainText(_ markdown: String) -> String {
    let blocks = parse(markdown)
    var lines: [String] = []
    for block in blocks {
        switch block {
        case .heading(_, let text):
            lines.append(stripInline(text))
        case .paragraph(let text):
            lines.append(stripInline(text))
        case .codeBlock(_, let code):
            lines.append(code)
        case .bulletItem(let indent, let text):
            lines.append(String(repeating: "  ", count: indent) + "• " + stripInline(text))
        case .numberedItem(let n, let indent, let text):
            lines.append(String(repeating: "  ", count: indent) + "\(n). " + stripInline(text))
        case .table(let headers, _, let rows):
            lines.append(headers.joined(separator: "\t"))
            for row in rows { lines.append(row.joined(separator: "\t")) }
        case .divider:
            lines.append("———")
        case .blockquote(let text):
            lines.append(stripInline(text))
        }
    }
    return lines.joined(separator: "\n")
}

private func stripInline(_ text: String) -> String {
    var s = text
    // **bold** / __bold__
    s = s.replacingOccurrences(of: #"\*\*(.+?)\*\*"#, with: "$1", options: .regularExpression)
    s = s.replacingOccurrences(of: #"__(.+?)__"#,    with: "$1", options: .regularExpression)
    // *italic* / _italic_
    s = s.replacingOccurrences(of: #"\*(.+?)\*"#,    with: "$1", options: .regularExpression)
    s = s.replacingOccurrences(of: #"_(.+?)_"#,      with: "$1", options: .regularExpression)
    // `code`
    s = s.replacingOccurrences(of: #"`(.+?)`"#,      with: "$1", options: .regularExpression)
    // [link](url) → link
    s = s.replacingOccurrences(of: #"\[(.+?)\]\(.+?\)"#, with: "$1", options: .regularExpression)
    return s
}

// MARK: - Single-Text rendering (enables cross-block mouse selection)

/// Renders markdown as ONE concatenated Text view so the user can
/// drag-select across paragraphs, bullet points, headings, etc.
func markdownAsSingleText(_ content: String) -> Text {
    let blocks = parse(content)
    var result = Text("")
    for (i, block) in blocks.enumerated() {
        if i > 0 { result = result + Text("\n") }
        switch block {
        case .heading(let level, let raw):
            let t: Text
            switch level {
            case 1:  t = Text(inlineAttr(raw)).font(.system(size: 16, weight: .bold))
            case 2:  t = Text(inlineAttr(raw)).font(.system(size: 14, weight: .semibold))
            default: t = Text(inlineAttr(raw)).font(.system(size: 12, weight: .semibold))
            }
            result = result + t
        case .paragraph(let raw):
            result = result + Text(inlineAttr(raw))
        case .bulletItem(let indent, let raw):
            let pad = String(repeating: "  ", count: indent)
            result = result + Text(pad + "• ") + Text(inlineAttr(raw))
        case .numberedItem(let n, let indent, let raw):
            let pad = String(repeating: "  ", count: indent)
            result = result + Text(pad + "\(n). ") + Text(inlineAttr(raw))
        case .codeBlock(_, let code):
            result = result + Text(code).font(.system(.body, design: .monospaced))
        case .blockquote(let raw):
            result = result + Text(inlineAttr(raw)).italic()
        case .table(let headers, _, let rows):
            let tableText = ([headers] + rows).map { $0.joined(separator: "  |  ") }.joined(separator: "\n")
            result = result + Text(tableText).font(.system(.body, design: .monospaced))
        case .divider:
            result = result + Text("──────────────────────")
        }
    }
    return result
}

private func inlineAttr(_ raw: String) -> AttributedString {
    if let attr = try? AttributedString(
        markdown: raw,
        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    ) { return attr }
    return AttributedString(raw)
}
