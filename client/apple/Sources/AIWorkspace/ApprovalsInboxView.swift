import SwiftUI

struct ApprovalsInboxView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var selectedApproval: WorkspaceApproval?
    @State private var runChecksAfterApply = true
    @State private var showingRejectSheet = false
    @State private var rejectReason = ""
    @State private var isSubmitting = false

    var body: some View {
        #if os(macOS)
        NavigationSplitView {
            sidebarList
                .navigationTitle("Pending Approvals")
        } detail: {
            detailContent
        }
        .onAppear {
            Task { await store.refreshApprovals() }
        }
        #else
        NavigationStack {
            sidebarList
                .navigationTitle("Approvals")
                .navigationDestination(for: WorkspaceApproval.self) { approval in
                    iOSDetailView(approval: approval)
                }
        }
        .onAppear {
            Task { await store.refreshApprovals() }
        }
        #endif
    }

    private var sidebarList: some View {
        Group {
            if store.isLoadingApprovals && store.approvals.isEmpty {
                VStack {
                    ProgressView()
                    Text("Loading approvals...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.approvals.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark.shield")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)
                    Text("No Pending Approvals")
                        .font(.headline)
                    Text("Workspace is clean. All actions have been processed.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(store.approvals, selection: $selectedApproval) { approval in
                    #if os(macOS)
                    sidebarRow(for: approval)
                        .tag(approval)
                    #else
                    NavigationLink(value: approval) {
                        sidebarRow(for: approval)
                    }
                    #endif
                }
                .refreshable {
                    await store.refreshApprovals()
                }
            }
        }
    }

    private func sidebarRow(for approval: WorkspaceApproval) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                CategoryBadge(category: approval.category ?? "")
                Spacer()
                if let dateStr = approval.createdAt {
                    Text(formatRelativeDate(dateStr))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            
            Text(approval.summary ?? "Request for approval")
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            
            if let scope = approval.scopePath {
                Text(scope)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var detailContent: some View {
        if let approval = selectedApproval {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            CategoryBadge(category: approval.category ?? "")
                            Spacer()
                            Text("ID: \(approval.id)")
                                .font(.caption)
                                .monospaced()
                                .foregroundStyle(.secondary)
                        }
                        
                        Text(approval.summary ?? "Request for approval")
                            .font(.title2.weight(.bold))
                        
                        if let scope = approval.scopePath {
                            Label(scope, systemImage: "folder")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        
                        if let taskId = approval.taskId {
                            Text("Task ID: \(taskId)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    
                    if approval.category == "code.patch.apply" {
                        patchDetailContent(for: approval)
                    } else if approval.category == "code.checks.run" {
                        checksDetailContent(for: approval)
                    } else {
                        fallbackDetailContent(for: approval)
                    }
                    
                    actionSection(for: approval)
                }
                .padding()
            }
            .task(id: approval.id) {
                if let diffRef = approval.diffRef {
                    await store.loadApprovalDiff(diffRef: diffRef)
                } else {
                    store.selectedApprovalDiffText = ""
                }
            }
            .sheet(isPresented: $showingRejectSheet) {
                RejectReasonSheet(isPresented: $showingRejectSheet, isSubmitting: $isSubmitting, onReject: { reason in
                    Task {
                        isSubmitting = true
                        await store.respondToWorkspaceApproval(id: approval.id, approved: false, reason: reason)
                        isSubmitting = false
                        selectedApproval = nil
                    }
                })
            }
        } else {
            VStack {
                Image(systemName: "tray")
                    .font(.system(size: 48))
                    .foregroundStyle(.secondary)
                Text("Select an approval to review details")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    
    #if os(iOS)
    @ViewBuilder
    private func iOSDetailView(approval: WorkspaceApproval) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        CategoryBadge(category: approval.category ?? "")
                        Spacer()
                        Text("ID: \(approval.id)")
                            .font(.caption)
                            .monospaced()
                            .foregroundStyle(.secondary)
                    }
                    
                    Text(approval.summary ?? "Request for approval")
                        .font(.title3.weight(.bold))
                    
                    if let scope = approval.scopePath {
                        Label(scope, systemImage: "folder")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                
                if approval.category == "code.patch.apply" {
                    patchDetailContent(for: approval)
                } else if approval.category == "code.checks.run" {
                    checksDetailContent(for: approval)
                } else {
                    fallbackDetailContent(for: approval)
                }
                
                actionSection(for: approval)
            }
            .padding()
        }
        .navigationTitle("Details")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let diffRef = approval.diffRef {
                await store.loadApprovalDiff(diffRef: diffRef)
            } else {
                store.selectedApprovalDiffText = ""
            }
        }
        .sheet(isPresented: $showingRejectSheet) {
            RejectReasonSheet(isPresented: $showingRejectSheet, isSubmitting: $isSubmitting, onReject: { reason in
                Task {
                    isSubmitting = true
                    await store.respondToWorkspaceApproval(id: approval.id, approved: false, reason: reason)
                    isSubmitting = false
                    showingRejectSheet = false
                }
            })
        }
    }
    #endif


    @ViewBuilder
    private func patchDetailContent(for approval: WorkspaceApproval) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Proposed Patch Diff")
                .font(.headline)
            
            if store.selectedApprovalDiffText.isEmpty {
                if store.isLoadingApprovals {
                    ProgressView()
                        .padding()
                } else {
                    Text("No diff content available.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding()
                }
            } else {
                DiffView(diffText: store.selectedApprovalDiffText)
            }
        }
    }

    @ViewBuilder
    private func checksDetailContent(for approval: WorkspaceApproval) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Commands to Run")
                .font(.headline)
            
            if let commands = approval.commands, !commands.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(commands, id: \.self) { cmd in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "terminal")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .padding(.top, 2)
                            Text(cmd)
                                .font(.system(.subheadline, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(8)
                                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                        }
                    }
                }
            } else {
                Text("No commands listed.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func fallbackDetailContent(for approval: WorkspaceApproval) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let reason = approval.reason {
                Text("Reason:")
                    .font(.headline)
                Text(reason)
                    .font(.subheadline)
            }
        }
    }

    @ViewBuilder
    private func actionSection(for approval: WorkspaceApproval) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if approval.category == "code.patch.apply" {
                Toggle(isOn: $runChecksAfterApply) {
                    Text("Run checks automatically after applying patch")
                        .font(.subheadline)
                }
                #if os(macOS)
                .toggleStyle(.checkbox)
                #else
                .toggleStyle(.customCheckbox)
                #endif
                .padding(.bottom, 4)
            }
            
            HStack(spacing: 16) {
                Button(role: .destructive) {
                    showingRejectSheet = true
                } label: {
                    Label("Reject", systemImage: "xmark.circle")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)
                
                Button {
                    Task {
                        await store.respondToWorkspaceApproval(
                            id: approval.id,
                            approved: true,
                            runChecksAfterApply: runChecksAfterApply
                        )
                        #if os(macOS)
                        selectedApproval = nil
                        #endif
                    }
                } label: {
                    Label("Approve & Execute", systemImage: "checkmark.circle")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
            }
        }
        .padding(.top, 10)
    }

    private func formatRelativeDate(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString) else { return isoString }
        let relativeFormatter = RelativeDateTimeFormatter()
        relativeFormatter.unitsStyle = .full
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }
}

struct CategoryBadge: View {
    let category: String
    
    var body: some View {
        Text(categoryLabel)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(badgeColor.opacity(0.15), in: Capsule())
            .foregroundStyle(badgeColor)
    }
    
    private var categoryLabel: String {
        switch category {
        case "code.patch.apply":
            "Patch Application"
        case "code.checks.run":
            "Check Execution"
        default:
            category
        }
    }
    
    private var badgeColor: Color {
        switch category {
        case "code.patch.apply":
            .blue
        case "code.checks.run":
            .purple
        default:
            .secondary
        }
    }
}

struct RejectReasonSheet: View {
    @Binding var isPresented: Bool
    @Binding var isSubmitting: Bool
    let onReject: (String) -> Void
    @State private var reason = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Please specify the reason for rejection:")
                    .font(.headline)
                
                TextEditor(text: $reason)
                    .frame(height: 120)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                    )
                
                Spacer()
                
                HStack(spacing: 16) {
                    Button("Cancel") {
                        isPresented = false
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    
                    Button("Reject Request") {
                        onReject(reason)
                        isPresented = false
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
                    .frame(maxWidth: .infinity)
                }
            }
            .padding()
            .navigationTitle("Reject Request")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(macOS)
        .frame(width: 400, height: 260)
        #endif
    }
}

struct DiffView: View {
    let diffText: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(lines, id: \.self) { line in
                        DiffLineRow(line: line)
                    }
                }
                .font(.system(.caption, design: .monospaced))
            }
            .background(Color.black.opacity(0.04))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
            )
        }
    }
    
    private var lines: [String] {
        diffText.components(separatedBy: .newlines)
    }
}

struct DiffLineRow: View {
    let line: String
    
    var body: some View {
        Text(line)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(backgroundColor)
            .foregroundStyle(textColor)
    }
    
    private var isAddition: Bool {
        line.hasPrefix("+") && !line.hasPrefix("+++")
    }
    
    private var isDeletion: Bool {
        line.hasPrefix("-") && !line.hasPrefix("---")
    }
    
    private var isHeader: Bool {
        line.hasPrefix("@@") || line.hasPrefix("diff") || line.hasPrefix("---") || line.hasPrefix("+++")
    }
    
    private var backgroundColor: Color {
        if isAddition {
            return Color.green.opacity(0.15)
        } else if isDeletion {
            return Color.red.opacity(0.15)
        } else if isHeader {
            return Color.blue.opacity(0.08)
        }
        return Color.clear
    }
    
    private var textColor: Color {
        if isAddition {
            return .green
        } else if isDeletion {
            return .red
        } else if isHeader {
            return .blue
        }
        return .primary
    }
}

#if os(iOS)
struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack {
                Image(systemName: configuration.isOn ? "checkmark.square" : "square")
                    .foregroundColor(configuration.isOn ? .accentColor : .secondary)
                configuration.label
            }
        }
        .buttonStyle(.plain)
    }
}
extension ToggleStyle where Self == CheckboxToggleStyle {
    static var customCheckbox: CheckboxToggleStyle { CheckboxToggleStyle() }
}
#endif
