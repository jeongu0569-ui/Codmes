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
    @Published var searchResponse: SearchResponse?
    @Published var chatLines: [ChatLine] = [
        ChatLine(role: "system", text: "Connect to the Workspace Server, then start a Hermes live session.")
    ]
    @Published var liveSessionId: String?
    @Published var chatContextScope: ChatContextScope = .currentFile
    @Published var statusMessage = "Not connected"
    @Published var isLoading = false

    private let liveClient = LiveChatClient()

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
            statusMessage = "Connected"
        } catch {
            statusMessage = error.localizedDescription
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
            selectedFile = try await api.file(path: item.path)
            statusMessage = "Opened \(item.name)"
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

    func connectLiveChat() async {
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
            let sessionId = try await liveClient.createSession()
            liveSessionId = sessionId
            chatLines.append(ChatLine(role: "system", text: "Connected to Hermes live session \(sessionId)."))
            statusMessage = "Live chat connected"
        } catch {
            statusMessage = error.localizedDescription
            chatLines.append(ChatLine(role: "system", text: error.localizedDescription))
        }
    }

    func sendChatMessage(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if liveSessionId == nil {
            await connectLiveChat()
        }
        guard let liveSessionId else { return }
        chatLines.append(ChatLine(role: "user", text: trimmed))
        do {
            try await liveClient.submit(sessionId: liveSessionId, message: trimmed, contextRequest: chatContextRequest())
            statusMessage = "Message sent"
        } catch {
            statusMessage = error.localizedDescription
            chatLines.append(ChatLine(role: "system", text: error.localizedDescription))
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
            selectedFile.map { "Current file: \($0.path)" } ?? "Current file: none selected"
        case .currentFolder:
            "Current folder: \(selectedFolderPath.isEmpty ? "workspace root" : selectedFolderPath)"
        case .workspace:
            "Workspace root"
        }
    }

    private func handleLiveEnvelope(_ envelope: LiveEnvelope) {
        switch envelope.kind {
        case "ready":
            chatLines.append(ChatLine(role: "system", text: "Live bridge ready."))
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
        if type == "message.delta" {
            if chatLines.last?.role == "assistant" {
                chatLines[chatLines.count - 1].text += text
            } else {
                chatLines.append(ChatLine(role: "assistant", text: text))
            }
            return
        }
        if type.contains("thinking") || type.contains("reasoning") {
            if !text.isEmpty {
                chatLines.append(ChatLine(role: "thinking", text: text))
            }
            return
        }
        if type.contains("tool") {
            chatLines.append(ChatLine(role: "tool", text: text.isEmpty ? type : "\(type): \(text)"))
            return
        }
        if type == "approval.request" {
            chatLines.append(ChatLine(role: "approval", text: text.isEmpty ? "Approval requested." : text, approvalState: .pending))
            return
        }
    }

    private func updateApprovalLine(_ id: UUID, state: ApprovalState) {
        guard let index = chatLines.firstIndex(where: { $0.id == id }) else { return }
        chatLines[index].approvalState = state
    }

    private func chatContextRequest() -> ContextRequest? {
        switch chatContextScope {
        case .none:
            return nil
        case .currentFile:
            guard let selectedFile else { return nil }
            let scopeType = selectedFile.kind == "pdf" ? "pdf" : "current"
            return ContextRequest(scopeType: scopeType, scopePath: selectedFile.path, activePath: selectedFile.path)
        case .currentFolder:
            return ContextRequest(scopeType: "folder", scopePath: selectedFolderPath, activePath: selectedFile?.path)
        case .workspace:
            return ContextRequest(scopeType: "workspace", scopePath: nil, activePath: selectedFile?.path)
        }
    }

    private var selectedFolderPath: String {
        guard let path = selectedFile?.path else { return "" }
        guard let slashIndex = path.lastIndex(of: "/") else { return "" }
        return String(path[..<slashIndex])
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
