import Foundation

@MainActor
final class WorkspaceStore: ObservableObject {
    @Published var serverURLText = UserDefaults.standard.string(forKey: "workspace.serverURL") ?? "http://127.0.0.1:8787"
    @Published var workspace: WorkspaceInfo?
    @Published var notes: [WorkspaceItem] = []
    @Published var code: [WorkspaceItem] = []
    @Published var selectedFile: FileResponse?
    @Published var searchResponse: SearchResponse?
    @Published var chatLines: [ChatLine] = [
        ChatLine(role: "system", text: "Connect to the Workspace Server, then start a Hermes live session.")
    ]
    @Published var liveSessionId: String?
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
            notes = try await api.tree(root: "notes").children
            code = try await api.tree(root: "code").children
            statusMessage = "Connected"
        } catch {
            statusMessage = error.localizedDescription
        }
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
            try await liveClient.submit(sessionId: liveSessionId, message: trimmed)
            statusMessage = "Message sent"
        } catch {
            statusMessage = error.localizedDescription
            chatLines.append(ChatLine(role: "system", text: error.localizedDescription))
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
            chatLines.append(ChatLine(role: "approval", text: text.isEmpty ? "Approval requested." : text))
            return
        }
    }
}
