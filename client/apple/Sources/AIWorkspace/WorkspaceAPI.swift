import Foundation

enum WorkspaceAPIError: Error, LocalizedError {
    case invalidURL
    case badStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Invalid workspace server URL."
        case let .badStatus(status, body):
            "Workspace server returned \(status): \(body)"
        }
    }
}

struct WorkspaceAPI {
    var baseURL: URL
    var session: URLSession = .shared

    func workspace() async throws -> WorkspaceInfo {
        try await get("/api/workspace")
    }

    func health() async throws -> HealthResponse {
        try await get("/api/health")
    }

    func tree(root: String, path: String = "") async throws -> TreeResponse {
        var components = try components("/api/tree")
        components.queryItems = [
            URLQueryItem(name: "root", value: root),
            URLQueryItem(name: "path", value: path)
        ]
        return try await request(components)
    }

    func file(path: String) async throws -> FileResponse {
        var components = try components("/api/file")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return try await request(components)
    }

    func rawURL(path: String) throws -> URL {
        var components = try components("/api/raw")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        guard let url = components.url else { throw WorkspaceAPIError.invalidURL }
        return url
    }

    func downloadRawFile(path: String, name: String) async throws -> URL {
        let url = try rawURL(path: path)
        var request = URLRequest(url: url)
        request.setValue("*/*", forHTTPHeaderField: "accept")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw WorkspaceAPIError.badStatus(status, String(data: data, encoding: .utf8) ?? "")
        }
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("AIWorkspaceRawPreviews", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        let fileURL = temporaryDirectory
            .appendingPathComponent(UUID().uuidString + "-" + name)
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }

    func writeFile(path: String, content: String) async throws {
        var components = try components("/api/file")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        let body = ["content": content]
        let _: EmptyResponse = try await request(components, method: "PUT", body: body)
    }

    func createFile(path: String, content: String = "") async throws {
        let body = [
            "path": path,
            "content": content
        ]
        let _: EmptyResponse = try await post("/api/file", body: body)
    }

    func createFolder(path: String) async throws {
        let body = ["path": path]
        let _: EmptyResponse = try await post("/api/folder", body: body)
    }

    func movePath(from: String, to: String) async throws {
        let body = [
            "from": from,
            "to": to
        ]
        let _: EmptyResponse = try await request(try components("/api/file/move"), method: "PATCH", body: body)
    }

    func copyPath(from: String, to: String) async throws {
        let body = [
            "from": from,
            "to": to
        ]
        let _: EmptyResponse = try await post("/api/file/copy", body: body)
    }

    func uploadFile(path: String, data: Data) async throws {
        let body = [
            "path": path,
            "dataBase64": data.base64EncodedString()
        ]
        let _: EmptyResponse = try await post("/api/file/upload", body: body)
    }

    func startChunkedUpload(path: String, size: Int64) async throws -> UploadStartResponse {
        try await post("/api/file/upload/start", body: ChunkedUploadStartBody(path: path, size: size))
    }

    func uploadChunk(uploadId: String, offset: Int64, data: Data) async throws -> UploadChunkResponse {
        try await post("/api/file/upload/chunk", body: ChunkedUploadChunkBody(
            uploadId: uploadId,
            offset: offset,
            dataBase64: data.base64EncodedString()
        ))
    }

    func completeChunkedUpload(uploadId: String) async throws {
        let _: EmptyResponse = try await post("/api/file/upload/complete", body: ChunkedUploadIDBody(uploadId: uploadId))
    }

    func cancelChunkedUpload(uploadId: String) async throws {
        let _: EmptyResponse = try await post("/api/file/upload/cancel", body: ChunkedUploadIDBody(uploadId: uploadId))
    }

    func deletePath(path: String) async throws {
        var components = try components("/api/file")
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        let _: EmptyResponse = try await request(components, method: "DELETE")
    }

    func renderMarkdown(markdown: String) async throws -> String {
        let response: RenderedMarkdownResponse = try await post("/api/render/markdown", body: ["markdown": markdown])
        return response.html
    }

    func renderCode(code: String, language: String?) async throws -> String {
        var body = ["code": code]
        if let language, !language.isEmpty {
            body["language"] = language
        }
        let response: RenderedMarkdownResponse = try await post("/api/render/code", body: body)
        return response.html
    }

    func search(query: String, scopePath: String) async throws -> SearchResponse {
        let body = [
            "query": query,
            "scopePath": scopePath
        ]
        return try await post("/api/search", body: body)
    }

    func agentTasks(type: String = "code", limit: Int = 50) async throws -> [AgentTaskSummary] {
        var components = try components("/api/agent/tasks")
        components.queryItems = [
            URLQueryItem(name: "type", value: type),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        let response: AgentTasksResponse = try await request(components)
        return response.tasks
    }

    func agentTask(id: String) async throws -> CodeTaskRecord {
        var components = try components("/api/agent/tasks/\(id)")
        components.percentEncodedPath = "/api/agent/tasks/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        return try await request(components)
    }

    func createCodeTask(scopePath: String, instruction: String) async throws -> CodeTaskResponse {
        try await post("/api/agent/code-task", body: CodeTaskCreateBody(
            scopePath: scopePath,
            instruction: instruction,
            maxFiles: 160,
            maxSearchResults: 10
        ))
    }

    func applyCodePatch(taskId: String, proposalId: String) async throws -> CodePatchApplyResponse {
        var components = try components("/api/agent/code-task/\(taskId)/patches/\(proposalId)/apply")
        components.percentEncodedPath = "/api/agent/code-task/\(taskId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? taskId)/patches/\(proposalId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? proposalId)/apply"
        return try await request(components, method: "POST", body: ApprovedBody(approved: true))
    }

    func rejectCodePatch(taskId: String, proposalId: String, reason: String = "Rejected in Apple client.") async throws -> CodePatchRejectResponse {
        var components = try components("/api/agent/code-task/\(taskId)/patches/\(proposalId)/reject")
        components.percentEncodedPath = "/api/agent/code-task/\(taskId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? taskId)/patches/\(proposalId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? proposalId)/reject"
        return try await request(components, method: "POST", body: RejectPatchBody(reason: reason))
    }

    func runCodeChecks(taskId: String) async throws -> CodeChecksResponse {
        var components = try components("/api/agent/code-task/\(taskId)/checks")
        components.percentEncodedPath = "/api/agent/code-task/\(taskId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? taskId)/checks"
        return try await request(components, method: "POST", body: ApprovedBody(approved: true))
    }

    func hermesModelOptions() async throws -> [HermesModelOption] {
        let data = try await dataRequest(try components("/api/hermes/models"))
        let object = try JSONSerialization.jsonObject(with: data)
        return extractHermesModels(from: object)
    }

    func hermesSessions() async throws -> [HermesSessionSummary] {
        let data = try await dataRequest(try components("/api/hermes/sessions"))
        let object = try JSONSerialization.jsonObject(with: data)
        return extractHermesSessions(from: object)
    }

    func hermesSessionMessages(sessionId: String) async throws -> [HermesSessionMessage] {
        var components = try components("/api/hermes/sessions/\(sessionId)/messages")
        components.percentEncodedPath = "/api/hermes/sessions/\(sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId)/messages"
        let response: HermesSessionMessagesResponse = try await request(components)
        return response.messages
    }

    func deleteHermesSession(sessionId: String) async throws {
        var components = try components("/api/hermes/sessions/\(sessionId)")
        components.percentEncodedPath = "/api/hermes/sessions/\(sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId)"
        let _: EmptyResponse = try await request(components, method: "DELETE")
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(try components(path))
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        try await request(try components(path), method: "POST", body: body)
    }

    private func components(_ path: String) throws -> URLComponents {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw WorkspaceAPIError.invalidURL
        }
        components.path = path
        return components
    }

    private func request<T: Decodable>(_ components: URLComponents, method: String = "GET", body: (some Encodable)? = Optional<String>.none) async throws -> T {
        let data = try await dataRequest(components, method: method, body: body)
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func dataRequest(_ components: URLComponents, method: String = "GET", body: (some Encodable)? = Optional<String>.none) async throws -> Data {
        guard let url = components.url else { throw WorkspaceAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw WorkspaceAPIError.badStatus(status, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }
}

struct EmptyResponse: Codable {}

private struct ChunkedUploadStartBody: Encodable {
    let path: String
    let size: Int64
}

private struct ChunkedUploadChunkBody: Encodable {
    let uploadId: String
    let offset: Int64
    let dataBase64: String
}

private struct ChunkedUploadIDBody: Encodable {
    let uploadId: String
}

private struct CodeTaskCreateBody: Encodable {
    let scopePath: String
    let instruction: String
    let maxFiles: Int
    let maxSearchResults: Int
}

private struct ApprovedBody: Encodable {
    let approved: Bool
}

private struct RejectPatchBody: Encodable {
    let reason: String
}

struct AnyEncodable: Encodable {
    let encodeBody: (Encoder) throws -> Void

    init(_ value: some Encodable) {
        encodeBody = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeBody(encoder)
    }
}

private func extractHermesModels(from object: Any) -> [HermesModelOption] {
    var models: [HermesModelOption] = []
    collectHermesModels(from: object, provider: nil, into: &models)
    var seen = Set<String>()
    return models.filter {
        !$0.id.isEmpty
            && $0.id != "<null>"
            && !$0.model.isEmpty
            && $0.model != "<null>"
            && seen.insert($0.id).inserted
    }
}

private func collectHermesModels(from object: Any, provider: String?, into models: inout [HermesModelOption]) {
    if let value = stringValue(object) {
        models.append(HermesModelOption(label: provider.map { "\($0) / \(value)" } ?? value, provider: provider, model: value))
        return
    }
    if let array = object as? [Any] {
        for item in array {
            collectHermesModels(from: item, provider: provider, into: &models)
        }
        return
    }
    guard let dict = object as? [String: Any] else { return }
    let nextProvider = stringValue(dict["provider"])
        ?? stringValue(dict["provider_id"])
        ?? stringValue(dict["providerId"])
        ?? stringValue(dict["name"]).flatMap { dict["models"] != nil ? $0 : nil }
        ?? provider
    if let model = stringValue(dict["model"])
        ?? stringValue(dict["model_id"])
        ?? stringValue(dict["modelId"])
        ?? stringValue(dict["id"]).flatMap({ dict["models"] == nil ? $0 : nil }) {
        let label = stringValue(dict["label"])
            ?? stringValue(dict["display_name"])
            ?? stringValue(dict["displayName"])
            ?? stringValue(dict["name"]).flatMap { $0 == nextProvider ? nil : $0 }
            ?? nextProvider.map { "\($0) / \(model)" }
            ?? model
        models.append(HermesModelOption(label: label, provider: nextProvider, model: model))
    }
    for key in ["models", "options", "model_options", "modelOptions", "items", "providers"] {
        if let nested = dict[key] {
            collectHermesModels(from: nested, provider: nextProvider, into: &models)
        }
    }
}

private func extractHermesSessions(from object: Any) -> [HermesSessionSummary] {
    var sessions: [HermesSessionSummary] = []
    collectHermesSessions(from: object, into: &sessions)
    var seen = Set<String>()
    return sessions.filter {
        !$0.id.isEmpty
            && $0.id != "<null>"
            && seen.insert($0.id).inserted
    }
}

private func collectHermesSessions(from object: Any, into sessions: inout [HermesSessionSummary]) {
    if let array = object as? [Any] {
        for item in array {
            collectHermesSessions(from: item, into: &sessions)
        }
        return
    }
    guard let dict = object as? [String: Any] else { return }
    if let id = stringValue(dict["id"])
        ?? stringValue(dict["session_id"])
        ?? stringValue(dict["sessionId"])
        ?? stringValue(dict["stored_session_id"])
        ?? stringValue(dict["storedSessionId"]) {
        if boolValue(dict["archived"]) == true {
            return
        }
        let preview = stringValue(dict["preview"])
        let messageCount = intValue(dict["message_count"]) ?? intValue(dict["messageCount"]) ?? 0
        let explicitTitle = stringValue(dict["display_name"])
            ?? stringValue(dict["displayName"])
            ?? stringValue(dict["title"])
            ?? stringValue(dict["name"])
            ?? stringValue(dict["summary"])
        let title = explicitTitle
            ?? preview
            ?? fallbackSessionTitle(model: stringValue(dict["model"]), id: id)
        let updatedAt = stringValue(dict["updated_at"])
            ?? stringValue(dict["updatedAt"])
            ?? stringValue(dict["modified_at"])
            ?? stringValue(dict["modifiedAt"])
            ?? stringValue(dict["last_active"])
            ?? stringValue(dict["lastActive"])
        let projectObject = dict["project"] as? [String: Any]
        let workspaceObject = dict["workspace"] as? [String: Any]
        let projectIdCandidates: [Any?] = [
            dict["project_id"], dict["projectId"], dict["workspace_id"], dict["workspaceId"],
            projectObject?["id"], workspaceObject?["id"]
        ]
        let projectTitleCandidates: [Any?] = [
            dict["project_title"], dict["projectTitle"], dict["workspace_title"], dict["workspaceTitle"],
            dict["cwd"], dict["git_repo_root"], dict["gitRepoRoot"],
            projectObject?["title"], projectObject?["name"], workspaceObject?["title"], workspaceObject?["name"]
        ]
        let projectId = projectIdCandidates.compactMap { stringValue($0) }.first
        let projectTitle = projectTitleCandidates.compactMap { stringValue($0) }.first
        if messageCount > 0 || preview != nil || explicitTitle != nil {
            sessions.append(HermesSessionSummary(id: id, title: title, updatedAt: updatedAt, projectId: projectId, projectTitle: projectTitle))
        }
    }
    for key in ["sessions", "items", "data", "results"] {
        if let nested = dict[key] {
            collectHermesSessions(from: nested, into: &sessions)
        }
    }
}

private func stringValue(_ value: Any?) -> String? {
    guard let value, !(value is NSNull) else { return nil }

    if let value = value as? String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || trimmed == "<null>" ? nil : trimmed
    }

    if let value = value as? NSNumber {
        return value.stringValue
    }

    return nil
}

private func intValue(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    if let value = stringValue(value) { return Int(value) }
    return nil
}

private func boolValue(_ value: Any?) -> Bool? {
    if let value = value as? Bool { return value }
    if let value = value as? NSNumber { return value.boolValue }
    if let value = stringValue(value) {
        switch value.lowercased() {
        case "true", "1", "yes": return true
        case "false", "0", "no": return false
        default: return nil
        }
    }
    return nil
}

private func fallbackSessionTitle(model: String?, id: String) -> String {
    if let model {
        return "Chat with \(model)"
    }
    if let date = generatedSessionDate(id) {
        return "Chat \(date)"
    }
    return "Untitled chat"
}

private func generatedSessionDate(_ id: String) -> String? {
    let pattern = #"^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_"#
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)),
          match.numberOfRanges >= 7 else {
        return nil
    }
    let parts = (1..<7).compactMap { index -> String? in
        guard let range = Range(match.range(at: index), in: id) else { return nil }
        return String(id[range])
    }
    guard parts.count == 6 else { return nil }
    return "\(parts[0])-\(parts[1])-\(parts[2]) \(parts[3]):\(parts[4])"
}
