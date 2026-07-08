import Foundation

@MainActor
final class WorkspaceStore: ObservableObject {
    @Published var serverURLText = UserDefaults.standard.string(forKey: "workspace.serverURL") ?? "http://127.0.0.1:8787"
    @Published var workspace: WorkspaceInfo?
    @Published var notes: [WorkspaceItem] = []
    @Published var code: [WorkspaceItem] = []
    @Published var notesPath = ""
    @Published var codePath = ""
    @Published var selectedFile: FileResponse?
    @Published var selectedRawFile: RawFilePreview?
    @Published var editorText = ""
    @Published var isEditingFile = false
    @Published var searchResponse: SearchResponse?
    @Published var chatLines: [ChatLine] = [
        ChatLine(role: "system", text: "Connect to the Workspace Server, then start a Hermes live session.")
    ]
    @Published var liveSessionId: String?
    @Published var hermesModels: [HermesModelOption] = []
    @Published var hermesSessions: [HermesSessionSummary] = []
    @Published var activeHermesSessionTitle = "No session"
    @Published var selectedHermesModelId = ""
    @Published var chatAccessMode: ChatAccessMode = .confirm
    @Published var chatReasoningMode: ChatReasoningMode = .balanced
    @Published var chatContextScope: ChatContextScope = .currentFile
    @Published var statusMessage = "Not connected"
    @Published var isLoading = false
    @Published var sessionManagerSearch = ""

    private let liveClient = LiveChatClient()
    private var activeActivityLineId: UUID?
    private var isChatTurnOpen = false

    var api: WorkspaceAPI? {
        guard let url = URL(string: serverURLText) else { return nil }
        return WorkspaceAPI(baseURL: url)
    }

    func saveServerURL() {
        UserDefaults.standard.set(serverURLText, forKey: "workspace.serverURL")
    }

    func refreshWorkspace() async {
        guard let api else {
            statusMessage = "Invalid server URL"
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            workspace = try await api.workspace()
            let notesTree = try await api.tree(root: "notes", path: notesPath)
            let codeTree = try await api.tree(root: "code", path: codePath)
            notes = notesTree.children
            code = codeTree.children
            await refreshHermesMetadata()
            statusMessage = "Connected"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func refreshHermesMetadata() async {
        guard let api else { return }
        do {
            hermesModels = try await api.hermesModelOptions()
            hermesSessions = try await api.hermesSessions()
            if selectedHermesModelId.isEmpty {
                selectedHermesModelId = hermesModels.first?.id ?? ""
            }
            updateActiveSessionTitle()
        } catch {
            statusMessage = "Hermes metadata: \(error.localizedDescription)"
        }
    }

    func items(for root: String) -> [WorkspaceItem] {
        root == "code" ? code : notes
    }

    func currentPath(for root: String) -> String {
        root == "code" ? codePath : notesPath
    }

    func sectionSubtitle(root: String) -> String {
        let path = currentPath(for: root)
        let rootName = root == "code" ? "Code" : "Notes"
        return path.isEmpty ? rootName : "\(rootName)/\(path)"
    }

    func openFolder(root: String, item: WorkspaceItem) async {
        guard item.isDirectory else { return }
        await loadTree(root: root, path: nestedPath(root: root, workspacePath: item.path))
    }

    func goToRoot(root: String) async {
        await loadTree(root: root, path: "")
    }

    func goToParent(root: String) async {
        let path = currentPath(for: root)
        guard !path.isEmpty else { return }
        let parent = parentPath(path)
        await loadTree(root: root, path: parent)
    }

    func loadFile(_ item: WorkspaceItem) async {
        guard !item.isDirectory, let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            if item.kind == "pdf" {
                let url = try await api.downloadRawFile(path: item.path, name: item.name)
                selectedRawFile = RawFilePreview(path: item.path, name: item.name, kind: item.kind, url: url)
                selectedFile = nil
                editorText = ""
            } else if item.kind == "image" {
                let url = try api.rawURL(path: item.path)
                selectedRawFile = RawFilePreview(path: item.path, name: item.name, kind: item.kind, url: url)
                selectedFile = nil
                editorText = ""
            } else {
                selectedFile = try await api.file(path: item.path)
                selectedRawFile = nil
                editorText = selectedFile?.content ?? ""
            }
            isEditingFile = false
            statusMessage = "Opened \(item.name)"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    var selectedFileIsDirty: Bool {
        guard let selectedFile else { return false }
        return editorText != selectedFile.content
    }

    var selectedFileCanEdit: Bool {
        guard let kind = selectedFile?.kind else { return false }
        return ["markdown", "code", "file"].contains(kind)
    }

    func startEditingSelectedFile() {
        guard selectedFileCanEdit else { return }
        editorText = selectedFile?.content ?? ""
        isEditingFile = true
    }

    func cancelEditingSelectedFile() {
        editorText = selectedFile?.content ?? ""
        isEditingFile = false
    }

    func saveSelectedFile() async {
        guard let api, var selectedFile, selectedFileCanEdit else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            try await api.writeFile(path: selectedFile.path, content: editorText)
            selectedFile.content = editorText
            self.selectedFile = selectedFile
            isEditingFile = false
            statusMessage = "Saved \(selectedFile.name)"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func loadTree(root: String, path: String) async {
        guard let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let tree = try await api.tree(root: root, path: path)
            if root == "code" {
                codePath = path
                code = tree.children
            } else {
                notesPath = path
                notes = tree.children
            }
            statusMessage = tree.path.isEmpty ? "Opened workspace root" : "Opened \(tree.path)"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func runSearch(query: String, scopePath: String) async {
        guard let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            searchResponse = try await api.search(query: query, scopePath: scopePath)
            statusMessage = "\(searchResponse?.resultCount ?? 0) results"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func prepareNewChat() {
        liveSessionId = nil
        activeHermesSessionTitle = "No session"
        activeActivityLineId = nil
        isChatTurnOpen = false
        chatLines = [ChatLine(role: "system", text: "New chat ready. Send a message to create a Hermes session.")]
        statusMessage = "New chat ready"
    }

    func startNewHermesSession() async {
        guard let url = URL(string: serverURLText) else {
            statusMessage = "Invalid server URL"
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            try await liveClient.connect(baseURL: url) { [weak self] envelope in
                Task { @MainActor in
                    self?.handleLiveEnvelope(envelope)
                }
            }
            let selectedModel = selectedHermesModel
            let sessionId = try await liveClient.createSession(
                provider: selectedModel?.provider,
                model: selectedModel?.model,
                reasoningEffort: chatReasoningMode.effort,
                accessMode: chatAccessMode.rawValue
            )
            liveSessionId = sessionId
            activeHermesSessionTitle = "New session"
            activeActivityLineId = nil
            isChatTurnOpen = false
            if chatLines.allSatisfy({ $0.role == "system" }) {
                chatLines.removeAll()
            }
            statusMessage = "New live session connected"
            await refreshHermesMetadata()
            updateActiveSessionTitle()
        } catch {
            statusMessage = error.localizedDescription
            chatLines.append(ChatLine(role: "system", text: error.localizedDescription))
        }
    }

    func connectLiveChat() async {
        await startNewHermesSession()
    }

    func resumeHermesSession(_ session: HermesSessionSummary) async {
        guard let url = URL(string: serverURLText) else {
            statusMessage = "Invalid server URL"
            return
        }
        guard let api else {
            statusMessage = "Invalid server URL"
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let history = try await api.hermesSessionMessages(sessionId: session.id)
            chatLines = chatLinesFromHistory(history, fallbackTitle: session.title)
            activeActivityLineId = nil
            isChatTurnOpen = false
            try await liveClient.connect(baseURL: url) { [weak self] envelope in
                Task { @MainActor in
                    self?.handleLiveEnvelope(envelope)
                }
            }
            try await liveClient.resumeSession(sessionId: session.id)
            liveSessionId = session.id
            activeHermesSessionTitle = session.title
            statusMessage = "Resumed \(session.title)"
        } catch {
            statusMessage = error.localizedDescription
            chatLines.append(ChatLine(role: "system", text: error.localizedDescription))
        }
    }

    func sendChatMessage(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if liveSessionId == nil {
            await startNewHermesSession()
        }
        guard let liveSessionId else { return }
        chatLines.append(ChatLine(role: "user", text: trimmed))
        activeActivityLineId = nil
        isChatTurnOpen = true
        do {
            try await liveClient.submit(sessionId: liveSessionId, message: trimmed, contextRequest: chatContextRequest())
            statusMessage = "Message sent"
        } catch {
            statusMessage = error.localizedDescription
            chatLines.append(ChatLine(role: "system", text: error.localizedDescription))
        }
    }

    func deleteHermesSession(_ session: HermesSessionSummary) async {
        guard let api else { return }
        if session.id == liveSessionId {
            statusMessage = "Cannot delete the active session"
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            try await api.deleteHermesSession(sessionId: session.id)
            hermesSessions.removeAll { $0.id == session.id }
            statusMessage = "Deleted \(session.title)"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func applyAccessModeToLiveSession() async {
        guard let liveSessionId else { return }
        do {
            try await liveClient.setAccessMode(sessionId: liveSessionId, accessMode: chatAccessMode.rawValue)
            statusMessage = "\(chatAccessMode.label) mode applied"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func applyReasoningModeToLiveSession() async {
        guard let liveSessionId else { return }
        do {
            try await liveClient.setReasoningMode(sessionId: liveSessionId, reasoningEffort: chatReasoningMode.effort)
            statusMessage = "\(chatReasoningMode.label) reasoning applied"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    var filteredHermesSessions: [HermesSessionSummary] {
        let query = sessionManagerSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return hermesSessions }
        return hermesSessions.filter {
            $0.title.lowercased().contains(query)
                || $0.id.lowercased().contains(query)
                || ($0.updatedAt ?? "").lowercased().contains(query)
        }
    }

    func respondToApproval(lineId: UUID, approved: Bool) async {
        guard let liveSessionId else {
            statusMessage = "No live session"
            return
        }
        updateApprovalLine(lineId, state: approved ? .approved : .denied)
        do {
            try await liveClient.respondToApproval(sessionId: liveSessionId, approved: approved)
            statusMessage = approved ? "Approval sent" : "Denial sent"
        } catch {
            statusMessage = error.localizedDescription
            updateApprovalLine(lineId, state: .pending)
            chatLines.append(ChatLine(role: "system", text: error.localizedDescription))
        }
    }

    var chatContextLabel: String {
        switch chatContextScope {
        case .none:
            "No workspace context"
        case .currentFile:
            selectedResourcePath.map { "Current file: \($0)" } ?? "Current file: none selected"
        case .currentFolder:
            "Current folder: \(selectedFolderPath.isEmpty ? "workspace root" : selectedFolderPath)"
        case .workspace:
            "Workspace root"
        }
    }

    var selectedHermesModel: HermesModelOption? {
        hermesModels.first { $0.id == selectedHermesModelId }
    }

    private func handleLiveEnvelope(_ envelope: LiveEnvelope) {
        switch envelope.kind {
        case "ready":
            statusMessage = "Live bridge ready"
        case "hermes.event":
            appendHermesEvent(envelope)
        case "hermes.close":
            chatLines.append(ChatLine(role: "system", text: "Hermes live connection closed."))
        case "error":
            chatLines.append(ChatLine(role: "system", text: envelope.error ?? "Live bridge error."))
        default:
            break
        }
    }

    private func appendHermesEvent(_ envelope: LiveEnvelope) {
        let type = envelope.type ?? "event"
        let text = envelope.text ?? ""
        if isAssistantDelta(type) {
            guard !text.isEmpty else { return }
            if chatLines.last?.role == "assistant" {
                chatLines[chatLines.count - 1].text += text
            } else {
                chatLines.append(ChatLine(role: "assistant", text: text))
            }
            return
        }

        if type == "message.done"
            || type == "response.done"
            || type == "content.done"
            || type == "message.completed"
            || type == "response.completed"
            || type == "message.complete"
            || type == "response.complete"
            || type == "turn.complete"
            || type == "turn.completed" {
            isChatTurnOpen = false
            finishActiveActivity()
            activeActivityLineId = nil
            Task {
                await refreshHermesMetadata()
                updateActiveSessionTitle()
            }
            return
        }

        if type.contains("thinking") || type.contains("reasoning") {
            if isChatTurnOpen && isMeaningfulActivityText(text) {
                appendActivity(type: type, text: text)
            }
            return
        }
        if type.contains("tool") {
            if isChatTurnOpen {
                appendActivity(type: type, text: text)
            }
            return
        }
        if type == "approval.request" {
            chatLines.append(ChatLine(role: "approval", text: text.isEmpty ? "Approval requested." : text, approvalState: .pending))
            return
        }
    }

    private func chatLinesFromHistory(_ messages: [HermesSessionMessage], fallbackTitle: String) -> [ChatLine] {
        var lines: [ChatLine] = []
        for message in messages {
            let role = normalizedHistoryRole(message.role)
            guard let role else { continue }
            if role == "activity" {
                let label = message.toolName.map { "\($0): \(message.content)" } ?? message.content
                lines.append(ChatLine(role: "activity", text: "Activity · 1 tool", activityItems: [
                    ChatActivity(type: message.toolName ?? message.role, text: label)
                ]))
                continue
            }
            if role == "assistant", let reasoning = message.reasoning, !reasoning.isEmpty {
                lines.append(ChatLine(role: "activity", text: "Activity · thinking", activityItems: [
                    ChatActivity(type: "Reasoning", text: reasoning)
                ]))
            }
            let content = role == "user" ? displayedUserMessage(from: message.content) : message.content
            lines.append(ChatLine(role: role, text: content))
        }
        if !lines.isEmpty {
            return lines
        }
        return [ChatLine(role: "system", text: "No saved messages for \(fallbackTitle).")]
    }

    private func updateActiveSessionTitle() {
        guard let liveSessionId else {
            activeHermesSessionTitle = "No session"
            return
        }
        if let session = hermesSessions.first(where: { $0.id == liveSessionId }) {
            activeHermesSessionTitle = session.title
        } else if activeHermesSessionTitle == "No session" {
            activeHermesSessionTitle = "Current session"
        }
    }

    private func normalizedHistoryRole(_ role: String) -> String? {
        switch role.lowercased() {
        case "user":
            return "user"
        case "assistant":
            return "assistant"
        case "system":
            return "system"
        case "tool", "function":
            return "activity"
        default:
            return nil
        }
    }

    private func displayedUserMessage(from content: String) -> String {
        let marker = "[User message]"
        guard let range = content.range(of: marker) else {
            return content
        }
        return String(content[range.upperBound...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func updateApprovalLine(_ id: UUID, state: ApprovalState) {
        guard let index = chatLines.firstIndex(where: { $0.id == id }) else { return }
        chatLines[index].approvalState = state
    }

    private func appendActivity(type: String, text: String) {
        let group = activityGroup(for: type)
        let item = ChatActivity(type: group, text: text.isEmpty ? group : text)
        if let activeActivityLineId,
           let index = chatLines.firstIndex(where: { $0.id == activeActivityLineId }) {
            if let itemIndex = chatLines[index].activityItems.firstIndex(where: { $0.type == group }) {
                chatLines[index].activityItems[itemIndex].text = mergeActivityText(
                    chatLines[index].activityItems[itemIndex].text,
                    text
                )
            } else {
                chatLines[index].activityItems.append(item)
            }
            chatLines[index].text = activitySummary(chatLines[index].activityItems)
            chatLines[index].isStreamingActivity = true
        } else {
            let line = ChatLine(role: "activity", text: activitySummary([item]), activityItems: [item], isStreamingActivity: true)
            activeActivityLineId = line.id
            chatLines.append(line)
        }
    }

    private func finishActiveActivity() {
        guard let activeActivityLineId,
              let index = chatLines.firstIndex(where: { $0.id == activeActivityLineId }) else {
            return
        }
        chatLines[index].isStreamingActivity = false
    }

    private func activitySummary(_ items: [ChatActivity]) -> String {
        let toolCount = items.filter { $0.type == "Tool" }.count
        let thoughtCount = items.filter { $0.type == "Thinking" || $0.type == "Reasoning" }.count
        let parts = [
            thoughtCount > 0 ? "thinking" : nil,
            toolCount > 0 ? "\(toolCount) tools" : nil
        ].compactMap { $0 }
        return parts.isEmpty ? "Activity" : "Activity · " + parts.joined(separator: " · ")
    }

    private func activityGroup(for type: String) -> String {
        if type.contains("tool") {
            return "Tool"
        }
        if type.contains("reasoning") {
            return "Reasoning"
        }
        return "Thinking"
    }

    private func isMeaningfulActivityText(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return false }
        if trimmed == #"{"text":""}"# || trimmed == #"{"text": ""}"# {
            return false
        }
        return true
    }

    private func mergeActivityText(_ current: String, _ incoming: String) -> String {
        guard !incoming.isEmpty else { return current }
        guard !current.isEmpty else { return incoming }
        if current.last?.isWhitespace == true || incoming.first?.isWhitespace == true {
            return current + incoming
        }
        if incoming.first?.isPunctuation == true {
            return current + incoming
        }
        if current.last?.isASCIIAlphaNumeric == true && incoming.first?.isASCIIAlphaNumeric == true {
            return current + " " + incoming
        }
        return current + incoming
    }

    private func isAssistantDelta(_ type: String) -> Bool {
        type == "message.delta"
            || type == "assistant.delta"
            || type == "assistant.message.delta"
    }

    private func chatContextRequest() -> ContextRequest? {
        switch chatContextScope {
        case .none:
            return nil
        case .currentFile:
            guard let selectedResourcePath, let selectedResourceKind else { return nil }
            let scopeType = selectedResourceKind == "pdf" ? "pdf" : "current"
            return ContextRequest(scopeType: scopeType, scopePath: selectedResourcePath, activePath: selectedResourcePath)
        case .currentFolder:
            return ContextRequest(scopeType: "folder", scopePath: selectedFolderPath, activePath: selectedResourcePath)
        case .workspace:
            return ContextRequest(scopeType: "workspace", scopePath: nil, activePath: selectedResourcePath)
        }
    }

    private var selectedFolderPath: String {
        guard let path = selectedResourcePath else { return "" }
        guard let slashIndex = path.lastIndex(of: "/") else { return "" }
        return String(path[..<slashIndex])
    }

    private var selectedResourcePath: String? {
        selectedFile?.path ?? selectedRawFile?.path
    }

    private var selectedResourceKind: String? {
        selectedFile?.kind ?? selectedRawFile?.kind
    }

    private func nestedPath(root: String, workspacePath: String) -> String {
        let rootName = root == "code" ? "Code" : "Notes"
        if workspacePath == rootName { return "" }
        let prefix = rootName + "/"
        guard workspacePath.hasPrefix(prefix) else { return workspacePath }
        return String(workspacePath.dropFirst(prefix.count))
    }

    private func parentPath(_ path: String) -> String {
        guard let slashIndex = path.lastIndex(of: "/") else { return "" }
        return String(path[..<slashIndex])
    }
}

private extension Character {
    var isASCIIAlphaNumeric: Bool {
        guard let scalar = unicodeScalars.first, unicodeScalars.count == 1 else {
            return false
        }
        return (65...90).contains(Int(scalar.value))
            || (97...122).contains(Int(scalar.value))
            || (48...57).contains(Int(scalar.value))
    }
}
