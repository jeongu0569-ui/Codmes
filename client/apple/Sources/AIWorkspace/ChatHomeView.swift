import SwiftUI

struct ChatHomeView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(title: "Hermes Chat", subtitle: store.workspace?.hermes.serverUrl ?? "No Hermes server loaded")
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
                    Picker("Model", selection: $store.selectedHermesModelId) {
                        if store.hermesModels.isEmpty {
                            Text("Default Hermes model").tag("")
                        } else {
                            ForEach(store.hermesModels) { model in
                                Text(model.label).tag(model.id)
                            }
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: 260)
                    .help("Model for the next new Hermes live session")

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
                        Label("Sessions", systemImage: "clock.arrow.circlepath")
                    }
                    .menuStyle(.borderlessButton)

                    Button {
                        Task { await store.refreshHermesMetadata() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                    .help("Refresh Hermes models and sessions")

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

                HStack(spacing: 12) {
                    Button {
                        Task { await store.connectLiveChat() }
                    } label: {
                        Image(systemName: "bolt.horizontal")
                    }
                    .buttonStyle(.borderless)
                    .help("Connect live Hermes session")

                    TextField("Message Hermes...", text: $draft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(1...4)
                        .padding(10)
                        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                        .onSubmit(sendDraft)
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
            .padding(16)
        }
    }

    private func sendDraft() {
        let message = draft
        draft = ""
        Task { await store.sendChatMessage(message) }
    }
}

struct MessageBubble: View {
    let line: ChatLine
    let onApproval: (Bool) -> Void
    @State private var activityExpanded = false

    var body: some View {
        HStack {
            if line.role == "user" {
                Spacer(minLength: 52)
            }

            VStack(alignment: bubbleAlignment, spacing: 6) {
                Text(roleLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if line.role == "activity" {
                    activityView
                } else {
                    Text(line.text)
                        .textSelection(.enabled)
                        .multilineTextAlignment(line.role == "user" ? .trailing : .leading)
                }
                if line.role == "approval", let state = line.approvalState {
                    approvalControls(state)
                }
            }
            .padding(12)
            .frame(maxWidth: 720, alignment: frameAlignment)
            .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 10))

            if line.role != "user" {
                Spacer(minLength: 52)
            }
        }
        .frame(maxWidth: .infinity, alignment: frameAlignment)
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
        if line.role == "user" {
            return AnyShapeStyle(.tint.opacity(0.18))
        }
        return AnyShapeStyle(.quaternary.opacity(0.35))
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
            HStack(spacing: 8) {
                Image(systemName: "waveform.path")
                    .foregroundStyle(.secondary)
                Text(line.text)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
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
