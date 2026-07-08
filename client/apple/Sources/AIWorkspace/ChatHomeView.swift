import SwiftUI

struct ChatHomeView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var draft = ""
    @State private var showingSessionManager = false

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(title: "Hermes Chat", subtitle: store.workspace?.hermes.serverUrl ?? "No Hermes server loaded")
            HStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .foregroundStyle(.secondary)
                Text(store.activeHermesSessionTitle)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .background(.quaternary.opacity(0.18))
            ScrollView {
                VStack(spacing: 14) {
                    ForEach(store.chatLines) { line in
                        MessageBubble(line: line) { approved in
                            Task { await store.respondToApproval(lineId: line.id, approved: approved) }
                        }
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Menu {
                        if store.hermesSessions.isEmpty {
                            Text("No sessions loaded")
                        } else {
                            ForEach(store.hermesSessions) { session in
                                Button {
                                    Task { await store.resumeHermesSession(session) }
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text(session.title)
                                        if let updatedAt = session.updatedAt {
                                            Text(updatedAt)
                                        }
                                    }
                                }
                            }
                        }
                    } label: {
                        Label(store.activeHermesSessionTitle == "No session" ? "Sessions" : store.activeHermesSessionTitle, systemImage: "clock.arrow.circlepath")
                            .lineLimit(1)
                    }
                    .menuStyle(.borderlessButton)
                    .simultaneousGesture(TapGesture().onEnded {
                        Task { await store.refreshHermesMetadata() }
                    })

                    Spacer()
                }

                HStack(spacing: 10) {
                    Picker("Context", selection: $store.chatContextScope) {
                        ForEach(ChatContextScope.allCases) { scope in
                            Label(scope.label, systemImage: scope.systemImage)
                                .tag(scope)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()

                    Text(store.chatContextLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Spacer()
                }

                VStack(spacing: 8) {
                    TextField("Message Hermes...", text: $draft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(1...4)
                        .onSubmit(sendDraft)

                    HStack(spacing: 12) {
                        Button {
                            store.prepareNewChat()
                        } label: {
                            Image(systemName: "plus")
                        }
                        .buttonStyle(.borderless)
                        .help("New chat")

                        Button {
                            showingSessionManager = true
                        } label: {
                            Image(systemName: "clock.arrow.circlepath")
                        }
                        .buttonStyle(.borderless)
                        .help("Search and manage sessions")

                        Picker("Access", selection: $store.chatAccessMode) {
                            ForEach(ChatAccessMode.allCases) { mode in
                                Text(mode.label).tag(mode)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .frame(maxWidth: 84)
                        .onChange(of: store.chatAccessMode) {
                            Task { await store.applyAccessModeToLiveSession() }
                        }

                        Picker("Model", selection: $store.selectedHermesModelId) {
                            if store.hermesModels.isEmpty {
                                Text("Default").tag("")
                            } else {
                                ForEach(store.hermesModels) { model in
                                    Text(model.label).tag(model.id)
                                }
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .frame(maxWidth: 220)

                        Picker("Reasoning", selection: $store.chatReasoningMode) {
                            ForEach(ChatReasoningMode.allCases) { mode in
                                Text(mode.label).tag(mode)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .frame(maxWidth: 82)
                        .onChange(of: store.chatReasoningMode) {
                            Task { await store.applyReasoningModeToLiveSession() }
                        }

                        Spacer()

                        Button {
                            sendDraft()
                        } label: {
                            Image(systemName: "paperplane.fill")
                        }
                        .buttonStyle(.borderless)
                        .font(.title3)
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(10)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
            }
            .padding(16)
        }
        .sheet(isPresented: $showingSessionManager) {
            SessionManagerView(isPresented: $showingSessionManager)
                .environmentObject(store)
        }
    }

    private func sendDraft() {
        let message = draft
        draft = ""
        Task { await store.sendChatMessage(message) }
    }
}

struct SessionManagerView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @Binding var isPresented: Bool
    @State private var pendingDelete: HermesSessionSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("History")
                        .font(.title2.weight(.semibold))
                    Text("Search and manage Hermes sessions.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await store.refreshHermesMetadata() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                Button {
                    isPresented = false
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
            }

            TextField("Search session title...", text: $store.sessionManagerSearch)
                .textFieldStyle(.roundedBorder)

            if store.filteredHermesSessions.isEmpty {
                ContentUnavailableView("No sessions", systemImage: "clock", description: Text("No saved Hermes sessions match this search."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(store.filteredHermesSessions) { session in
                    HStack(spacing: 12) {
                        Button {
                            Task {
                                await store.resumeHermesSession(session)
                                isPresented = false
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(session.title)
                                    .lineLimit(1)
                                if let updatedAt = session.updatedAt {
                                    Text(updatedAt)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)

                        Button(role: .destructive) {
                            pendingDelete = session
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .disabled(session.id == store.liveSessionId)
                        .help(session.id == store.liveSessionId ? "Cannot delete the active session" : "Delete session")
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .padding(20)
        .frame(idealWidth: 520, idealHeight: 460)
        .task {
            await store.refreshHermesMetadata()
        }
        .confirmationDialog(
            "Delete this Hermes session?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            presenting: pendingDelete
        ) { session in
            Button("Delete \(session.title)", role: .destructive) {
                Task {
                    await store.deleteHermesSession(session)
                    pendingDelete = nil
                }
            }
            Button("Cancel", role: .cancel) {
                pendingDelete = nil
            }
        } message: { session in
            Text("This deletes the saved Hermes session, not just the local row: \(session.title)")
        }
    }
}

struct MessageBubble: View {
    let line: ChatLine
    let onApproval: (Bool) -> Void
    @State private var activityExpanded = false

    var body: some View {
        if line.role == "activity" {
            activityRow
        } else {
            messageRow
        }
    }

    private var messageRow: some View {
        HStack {
            if line.role == "user" {
                Spacer(minLength: 52)
            }

            VStack(alignment: bubbleAlignment, spacing: 6) {
                if line.role != "assistant" {
                    Text(roleLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if line.role == "assistant" {
                    MarkdownText(markdown: line.text)
                        .textSelection(.enabled)
                } else {
                    Text(line.text)
                        .textSelection(.enabled)
                        .multilineTextAlignment(line.role == "user" ? .trailing : .leading)
                }
                if line.role == "approval", let state = line.approvalState {
                    approvalControls(state)
                }
            }
            .padding(bubblePadding)
            .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 10))

            if line.role != "user" {
                Spacer(minLength: 52)
            }
        }
        .frame(maxWidth: .infinity, alignment: frameAlignment)
    }

    private var activityRow: some View {
        HStack(alignment: .top) {
            activityView
                .padding(.vertical, 6)
                .padding(.horizontal, 9)
                .frame(maxWidth: 520, alignment: .leading)
                .background(.quaternary.opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
            Spacer(minLength: 80)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var roleLabel: String {
        switch line.role {
        case "user": "YOU"
        case "assistant": "AI"
        default: line.role.uppercased()
        }
    }

    private var bubbleAlignment: HorizontalAlignment {
        line.role == "user" ? .trailing : .leading
    }

    private var frameAlignment: Alignment {
        line.role == "user" ? .trailing : .leading
    }

    private var bubbleBackground: AnyShapeStyle {
        if line.role == "activity" {
            return AnyShapeStyle(.quaternary.opacity(0.22))
        }
        if line.role == "user" {
            return AnyShapeStyle(.tint.opacity(0.18))
        }
        return AnyShapeStyle(.quaternary.opacity(0.35))
    }

    private var bubblePadding: EdgeInsets {
        if line.role == "activity" {
            return EdgeInsets(top: 7, leading: 10, bottom: 7, trailing: 10)
        }
        return EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
    }

    private var activityView: some View {
        DisclosureGroup(isExpanded: $activityExpanded) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(line.activityItems) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.type)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(item.text)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    .padding(.vertical, 1)
                }
            }
            .padding(.top, 4)
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Image(systemName: line.isStreamingActivity ? "sparkles" : "checkmark.circle")
                        .foregroundStyle(.secondary)
                    Text(activityLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .shimmering(active: line.isStreamingActivity)

                if line.isStreamingActivity && !activityExpanded {
                    Text(activityPreview)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                        .transition(.opacity)
                }
            }
        }
    }

    private var activityPreview: String {
        line.activityItems.last?.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private var activityLabel: String {
        let status = line.isStreamingActivity ? "Running" : "Done"
        let text = line.text
            .replacingOccurrences(of: "Activity · ", with: "")
            .replacingOccurrences(of: "Activity", with: "thinking")
        return "\(text) · \(status)"
    }

    @ViewBuilder
    private func approvalControls(_ state: ApprovalState) -> some View {
        switch state {
        case .pending:
            HStack(spacing: 12) {
                Button {
                    onApproval(true)
                } label: {
                    Label("Approve", systemImage: "checkmark.circle")
                }
                Button {
                    onApproval(false)
                } label: {
                    Label("Deny", systemImage: "xmark.circle")
                }
            }
            .buttonStyle(.borderless)
            .padding(.top, 4)
        case .approved:
            Label("Approved", systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
        case .denied:
            Label("Denied", systemImage: "xmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.red)
        }
    }
}

private struct MarkdownText: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(markdownBlocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var markdownBlocks: [MarkdownBlock] {
        parseMarkdownBlocks(markdown)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case let .heading(level, text):
            Text(text)
                .font(headingFont(level))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        case let .paragraph(text):
            Text(attributed(text))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        case let .bullet(text):
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text("•")
                    .foregroundStyle(.secondary)
                Text(attributed(text))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case let .code(text):
            ScrollView(.horizontal) {
                Text(text)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
        case let .table(table):
            markdownTable(table)
        }
    }

    private func markdownTable(_ table: MarkdownTable) -> some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(table.rows.enumerated()), id: \.offset) { rowIndex, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            MarkdownTableCell(text: attributed(cell), isHeader: rowIndex == 0)
                        }
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title3.weight(.semibold)
        case 2: .headline
        default: .subheadline.weight(.semibold)
        }
    }

    private func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

private struct MarkdownTableCell: View {
    let text: AttributedString
    let isHeader: Bool

    var body: some View {
        Text(text)
            .font(isHeader ? .caption.weight(.semibold) : .caption)
            .textSelection(.enabled)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(minWidth: 90, alignment: .leading)
            .background(cellBackground)
            .overlay(Rectangle().stroke(.quaternary.opacity(0.5), lineWidth: 0.5))
    }

    private var cellBackground: AnyShapeStyle {
        if isHeader {
            return AnyShapeStyle(.quaternary.opacity(0.35))
        }
        return AnyShapeStyle(.quaternary.opacity(0.16))
    }
}

private struct ShimmerModifier: ViewModifier {
    let active: Bool
    @State private var phase = false

    func body(content: Content) -> some View {
        if active {
            content
                .opacity(phase ? 1 : 0.62)
                .shadow(color: .white.opacity(phase ? 0.35 : 0.05), radius: phase ? 8 : 1)
                .onAppear {
                    withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                        phase = true
                    }
                }
        } else {
            content
        }
    }
}

private extension View {
    func shimmering(active: Bool) -> some View {
        modifier(ShimmerModifier(active: active))
    }
}

private func parseMarkdownBlocks(_ markdown: String) -> [MarkdownBlock] {
    let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    var blocks: [MarkdownBlock] = []
    var paragraph: [String] = []
    var index = 0

    func flushParagraph() {
        let text = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            blocks.append(.paragraph(text))
        }
        paragraph.removeAll()
    }

    while index < lines.count {
        let line = lines[index]
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        if trimmed.isEmpty {
            flushParagraph()
            index += 1
            continue
        }

        if trimmed.hasPrefix("```") {
            flushParagraph()
            index += 1
            var code: [String] = []
            while index < lines.count {
                let codeLine = lines[index]
                if codeLine.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    index += 1
                    break
                }
                code.append(codeLine)
                index += 1
            }
            blocks.append(.code(code.joined(separator: "\n")))
            continue
        }

        if let table = parseMarkdownTable(lines: lines, start: index) {
            flushParagraph()
            blocks.append(.table(table.table))
            index = table.nextIndex
            continue
        }

        if let heading = parseHeading(trimmed) {
            flushParagraph()
            blocks.append(.heading(level: heading.level, text: heading.text))
            index += 1
            continue
        }

        if let bullet = parseBullet(trimmed) {
            flushParagraph()
            blocks.append(.bullet(bullet))
            index += 1
            continue
        }

        paragraph.append(line)
        index += 1
    }

    flushParagraph()
    return blocks.isEmpty ? [.paragraph(markdown)] : blocks
}

private func parseHeading(_ line: String) -> (level: Int, text: String)? {
    let hashes = line.prefix { $0 == "#" }.count
    guard hashes > 0, hashes <= 6 else { return nil }
    let rest = line.dropFirst(hashes)
    guard rest.first == " " else { return nil }
    return (hashes, String(rest.dropFirst()).trimmingCharacters(in: .whitespaces))
}

private func parseBullet(_ line: String) -> String? {
    for prefix in ["- ", "* ", "+ "] where line.hasPrefix(prefix) {
        return String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    }
    return nil
}

private func parseMarkdownTable(lines: [String], start: Int) -> (table: MarkdownTable, nextIndex: Int)? {
    guard start + 1 < lines.count else { return nil }
    let header = lines[start].trimmingCharacters(in: .whitespaces)
    let separator = lines[start + 1].trimmingCharacters(in: .whitespaces)
    guard header.contains("|"), isTableSeparator(separator) else { return nil }

    var rows = [splitTableRow(header)]
    var index = start + 2
    while index < lines.count {
        let line = lines[index].trimmingCharacters(in: .whitespaces)
        guard line.contains("|"), !line.isEmpty else { break }
        rows.append(splitTableRow(line))
        index += 1
    }

    let maxColumns = rows.map(\.count).max() ?? 0
    guard maxColumns > 1 else { return nil }
    rows = rows.map { row in
        row + Array(repeating: "", count: max(0, maxColumns - row.count))
    }
    return (MarkdownTable(rows: rows), index)
}

private func splitTableRow(_ line: String) -> [String] {
    var text = line
    if text.hasPrefix("|") { text.removeFirst() }
    if text.hasSuffix("|") { text.removeLast() }
    return text
        .components(separatedBy: "|")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
}

private func isTableSeparator(_ line: String) -> Bool {
    guard line.contains("|") else { return false }
    let cells = splitTableRow(line)
    guard !cells.isEmpty else { return false }
    return cells.allSatisfy { cell in
        let stripped = cell.replacingOccurrences(of: ":", with: "")
        return stripped.count >= 3 && stripped.allSatisfy { $0 == "-" }
    }
}
