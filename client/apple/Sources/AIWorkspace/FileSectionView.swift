import SwiftUI
import PDFKit
import UniformTypeIdentifiers

struct FileSectionView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let title: String
    let root: String

    var body: some View {
        Group {
            #if os(macOS)
            HSplitView {
                FileBrowserPane(title: title, root: root)
                    .frame(minWidth: 0, idealWidth: 280)

                FilePreviewView()
                    .frame(minWidth: 0)
            }
            #else
            VStack(spacing: 0) {
                FileBrowserPane(title: title, root: root)
                    .frame(maxHeight: 320)
                Divider()
                FilePreviewView()
            }
            #endif
        }
        .background(.background)
    }
}

struct FileBrowserPane: View {
    @EnvironmentObject private var store: WorkspaceStore
    let title: String
    let root: String
    var showsHeader = true
    var onOpenFile: (() -> Void)?
    @State private var newItemKind: NewWorkspaceItemKind?
    @State private var newItemName = ""
    @State private var itemToRename: WorkspaceItem?
    @State private var renameName = ""
    @State private var itemToDelete: WorkspaceItem?
    @State private var transferAction: WorkspaceTransferAction?
    @State private var transferDestination = ""
    @State private var isImportingFile = false

    var body: some View {
        VStack(spacing: 0) {
            if showsHeader {
                HeaderView(title: title, subtitle: store.sectionSubtitle(root: root))
            }
            HStack(spacing: 8) {
                Button {
                    newItemName = root == "code" ? "Untitled.swift" : "Untitled.md"
                    newItemKind = .file
                } label: {
                    Image(systemName: "doc.badge.plus")
                }
                .buttonStyle(.plain)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
                .help("New file")

                Button {
                    newItemName = "New Folder"
                    newItemKind = .folder
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .buttonStyle(.plain)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
                .help("New folder")

                Button {
                    isImportingFile = true
                } label: {
                    Image(systemName: "paperclip")
                }
                .buttonStyle(.plain)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
                .help("Attach file")

                Button {
                    Task { await store.goToParent(root: root) }
                } label: {
                    Image(systemName: "chevron.up")
                }
                .buttonStyle(.plain)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
                .disabled(store.currentPath(for: root).isEmpty)
                .help("Go to parent folder")

                Button {
                    Task { await store.goToRoot(root: root) }
                } label: {
                    Image(systemName: "house")
                }
                .buttonStyle(.plain)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
                .disabled(store.currentPath(for: root).isEmpty)
                .help("Go to root folder")

                Text(store.currentPath(for: root).isEmpty ? "/" : store.currentPath(for: root))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.quaternary.opacity(0.10))
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(.quaternary.opacity(0.35))
                    .frame(height: 1)
            }

            UploadStatusPanel(root: root)

            if root == "code" {
                CodeAgentPanel()
            }

            List(store.items(for: root)) { item in
                HStack(spacing: 8) {
                    Button {
                        open(item)
                    } label: {
                        fileRowLabel(item)
                    }
                    .buttonStyle(.plain)

                    Menu {
                        itemManagementMenu(item)
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 30, height: 30)
                            .contentShape(Rectangle())
                    }
                    .menuStyle(.borderlessButton)
                }
                .contextMenu {
                    itemManagementMenu(item)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        itemToDelete = item
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    Button {
                        itemToRename = item
                        renameName = item.name
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    .tint(.secondary)
                }
            }
        }
        .fileImporter(isPresented: $isImportingFile, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case let .success(urls):
                Task { await store.uploadLocalFiles(root: root, fileURLs: urls) }
            case let .failure(error):
                store.statusMessage = error.localizedDescription
            }
        }
        .alert(newItemKind?.title ?? "New item", isPresented: newItemBinding) {
            TextField("Name", text: $newItemName)
            Button("Create") {
                let name = newItemName
                let kind = newItemKind
                newItemKind = nil
                Task {
                    switch kind {
                    case .file:
                        await store.createFile(root: root, name: name)
                    case .folder:
                        await store.createFolder(root: root, name: name)
                    case .none:
                        break
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                newItemKind = nil
            }
        } message: {
            Text(store.currentPath(for: root).isEmpty ? "Create in \(title)." : "Create in \(store.currentPath(for: root)).")
        }
        .alert("Rename", isPresented: renameBinding) {
            TextField("Name", text: $renameName)
            Button("Rename") {
                let item = itemToRename
                let name = renameName
                itemToRename = nil
                Task {
                    if let item {
                        await store.renameItem(root: root, item: item, newName: name)
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                itemToRename = nil
            }
        } message: {
            Text(itemToRename?.path ?? "")
        }
        .alert(transferAction?.title ?? "Transfer", isPresented: transferBinding) {
            TextField("Destination folder in \(title)", text: $transferDestination)
            Button(transferAction?.buttonTitle ?? "Apply") {
                let action = transferAction
                let destination = transferDestination
                transferAction = nil
                Task {
                    switch action {
                    case let .move(item):
                        await store.moveItem(root: root, item: item, destinationFolder: destination)
                    case let .copy(item):
                        await store.copyItem(root: root, item: item, destinationFolder: destination)
                    case .none:
                        break
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                transferAction = nil
            }
        } message: {
            Text("Use a folder path relative to \(title). Leave empty for the \(title) root.")
        }
        .confirmationDialog("Delete item?", isPresented: deleteBinding, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                let item = itemToDelete
                itemToDelete = nil
                Task {
                    if let item {
                        await store.deleteItem(root: root, item: item)
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                itemToDelete = nil
            }
        } message: {
            Text(itemToDelete.map { "Delete \($0.path)?" } ?? "")
        }
        .task {
            if root == "code" {
                await store.refreshCodeTasks()
            }
        }
    }

    private var newItemBinding: Binding<Bool> {
        Binding(
            get: { newItemKind != nil },
            set: { if !$0 { newItemKind = nil } }
        )
    }

    private var renameBinding: Binding<Bool> {
        Binding(
            get: { itemToRename != nil },
            set: { if !$0 { itemToRename = nil } }
        )
    }

    private var deleteBinding: Binding<Bool> {
        Binding(
            get: { itemToDelete != nil },
            set: { if !$0 { itemToDelete = nil } }
        )
    }

    private var transferBinding: Binding<Bool> {
        Binding(
            get: { transferAction != nil },
            set: { if !$0 { transferAction = nil } }
        )
    }

    private func icon(for item: WorkspaceItem) -> String {
        if item.isDirectory { return "folder" }
        switch item.kind {
        case "markdown": return "doc.text"
        case "pdf": return "doc.richtext"
        case "image": return "photo"
        case "code": return "curlybraces"
        default: return "doc"
        }
    }

    private func open(_ item: WorkspaceItem) {
        Task {
            if item.isDirectory {
                await store.openFolder(root: root, item: item)
            } else {
                await store.loadFile(item)
                onOpenFile?()
            }
        }
    }

    @ViewBuilder
    private func itemManagementMenu(_ item: WorkspaceItem) -> some View {
        Button {
            transferDestination = store.currentPath(for: root)
            transferAction = .move(item)
        } label: {
            Label("Move to folder", systemImage: "folder")
        }

        Button {
            transferDestination = store.currentPath(for: root)
            transferAction = .copy(item)
        } label: {
            Label("Copy to folder", systemImage: "doc.on.doc")
        }

        Button {
            itemToRename = item
            renameName = item.name
        } label: {
            Label("Rename", systemImage: "pencil")
        }

        Button(role: .destructive) {
            itemToDelete = item
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    private func fileRowLabel(_ item: WorkspaceItem) -> some View {
        HStack {
            Image(systemName: icon(for: item))
                .foregroundStyle(item.isDirectory ? Color.primary.opacity(0.82) : Color.secondary)
            VStack(alignment: .leading) {
                Text(item.name)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(item.path)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            if item.isDirectory {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

private struct CodeAgentPanel: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    TextField("Describe a code task", text: $store.codeTaskInstruction, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...3)
                    Button {
                        Task { await store.createCodeInspectTask() }
                    } label: {
                        Image(systemName: "play.circle")
                    }
                    .buttonStyle(.plain)
                    .frame(width: 30, height: 30)
                    .disabled(store.codeTaskInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isLoadingCodeTask)
                    .help("Create code task")
                }

                HStack(spacing: 8) {
                    Label(store.currentCodeScopePath, systemImage: "scope")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                    Button {
                        Task { await store.refreshCodeTasks() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isLoadingCodeTask)
                    .help("Refresh code tasks")
                }

                if store.isLoadingCodeTask {
                    ProgressView()
                        .controlSize(.small)
                }

                if !store.codeTasks.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Recent tasks")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(store.codeTasks.prefix(4)) { task in
                            Button {
                                Task { await store.loadCodeTask(task) }
                            } label: {
                                CodeTaskSummaryRow(task: task, isSelected: store.selectedCodeTask?.id == task.id)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if let task = store.selectedCodeTask {
                    Divider()
                    CodeTaskDetailView(task: task)
                }
            }
            .padding(.top, 8)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                Text("Code Agent")
                    .font(.caption.weight(.semibold))
                Spacer()
                if let status = store.selectedCodeTask?.status {
                    Text(status)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.quaternary.opacity(0.08))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(.quaternary.opacity(0.25))
                .frame(height: 1)
        }
    }
}

private struct CodeTaskSummaryRow: View {
    let task: AgentTaskSummary
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.message ?? task.summary ?? task.id)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                HStack(spacing: 6) {
                    Text(task.status ?? "task")
                    if let scopePath = task.scopePath {
                        Text(scopePath)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
        }
        .padding(7)
        .background(isSelected ? Color.secondary.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
    }

    private var statusColor: Color {
        switch task.status {
        case "checked":
            return .green
        case "check_failed", "failed":
            return .orange
        case "patched", "patch_proposed":
            return .blue
        default:
            return .secondary
        }
    }
}

private struct CodeTaskDetailView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let task: CodeTaskRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(task.plan?.summary ?? task.message ?? task.id)
                    .font(.caption.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(task.scopePath ?? "Code")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            if let memory = task.taskMemory {
                CodeTaskMemoryView(memory: memory)
            }

            let proposals = task.patchProposals ?? []
            if !proposals.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Patch proposals")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(proposals) { proposal in
                        CodePatchProposalView(proposal: proposal)
                    }
                }
            }

            HStack(spacing: 10) {
                Button {
                    Task { await store.runSelectedCodeTaskChecks() }
                } label: {
                    Label("Run checks", systemImage: "checkmark.seal")
                }
                .buttonStyle(.borderless)
                .disabled(store.isLoadingCodeTask)

                Spacer()
            }

            if !store.selectedCodeTaskDiff.isEmpty {
                DisclosureGroup {
                    ScrollView(.horizontal) {
                        Text(store.selectedCodeTaskDiff)
                            .font(.system(.caption2, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8)
                    }
                    .frame(maxHeight: 160)
                    .background(.black.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                } label: {
                    Label("Git diff", systemImage: "plus.forwardslash.minus")
                        .font(.caption.weight(.semibold))
                }
            }
        }
    }
}

private struct CodeTaskMemoryView: View {
    let memory: CodeTaskMemory

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !memory.nextSteps.isEmpty {
                memoryGroup(title: "Next", values: Array(memory.nextSteps.prefix(3)))
            }
            if !memory.changedFiles.isEmpty {
                memoryGroup(title: "Changed", values: Array(memory.changedFiles.prefix(4)))
            } else if !memory.proposedFiles.isEmpty {
                memoryGroup(title: "Proposed", values: Array(memory.proposedFiles.prefix(4)))
            } else if !memory.readFiles.isEmpty {
                memoryGroup(title: "Read", values: Array(memory.readFiles.prefix(4)))
            }
            if !memory.commands.isEmpty {
                memoryGroup(title: "Commands", values: Array(memory.commands.prefix(3)))
            }
            if let latestCheck = memory.checkResults.last {
                Label(latestCheck.allPassed == true ? "Checks passed" : "Checks need review", systemImage: latestCheck.allPassed == true ? "checkmark.circle" : "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(latestCheck.allPassed == true ? .green : .orange)
            }
        }
    }

    private func memoryGroup(title: String, values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(values, id: \.self) { value in
                Text(value)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }
}

private struct CodePatchProposalView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let proposal: CodePatchProposal

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: statusIcon)
                    .foregroundStyle(statusColor)
                Text(proposal.summary ?? proposal.id)
                    .font(.caption)
                    .lineLimit(2)
                Spacer(minLength: 6)
                if proposal.status == "proposed" {
                    Button {
                        Task { await store.applyCodePatch(proposal) }
                    } label: {
                        Text("Approve")
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.borderless)
                    .disabled(store.isLoadingCodeTask)
                    Button {
                        Task { await store.rejectCodePatch(proposal) }
                    } label: {
                        Text("Deny")
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.borderless)
                    .disabled(store.isLoadingCodeTask)
                } else if proposal.status == "rejected" {
                    Text("Denied")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.orange)
                }
            }
            ForEach((proposal.changes ?? []).prefix(3)) { change in
                Text("\(change.operation ?? "change") \(change.path)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(8)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private var statusIcon: String {
        switch proposal.status {
        case "applied":
            return "checkmark.circle"
        case "rejected":
            return "xmark.circle"
        default:
            return "exclamationmark.shield"
        }
    }

    private var statusColor: Color {
        switch proposal.status {
        case "applied":
            return .green
        case "rejected":
            return .orange
        default:
            return .orange
        }
    }
}

private struct UploadStatusPanel: View {
    @EnvironmentObject private var store: WorkspaceStore
    let root: String

    private var uploads: [UploadItem] {
        store.uploads(for: root)
    }

    var body: some View {
        if !uploads.isEmpty {
            VStack(spacing: 6) {
                HStack(spacing: 8) {
                    Text("Uploads")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        store.clearFinishedUploads(root: root)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .disabled(!uploads.contains(where: { !$0.isActive }))
                    .help("Clear finished uploads")
                }

                ForEach(uploads.prefix(3)) { item in
                    UploadStatusRow(item: item)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.quaternary.opacity(0.08))
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(.quaternary.opacity(0.25))
                    .frame(height: 1)
            }
        }
    }
}

private struct UploadStatusRow: View {
    let item: UploadItem

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                if item.isActive {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 14, height: 14)
                } else {
                    Image(systemName: item.status.systemImage)
                        .font(.caption)
                        .foregroundStyle(iconColor)
                        .frame(width: 14, height: 14)
                }

                Text(item.fileName)
                    .font(.caption)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer(minLength: 8)

                Text(item.status.label)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(iconColor)
            }

            if item.isActive {
                ProgressView(value: item.progress)
                    .progressViewStyle(.linear)
                    .controlSize(.small)
            }

            if !item.message.isEmpty {
                Text(item.message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(8)
        .background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var iconColor: Color {
        switch item.status {
        case .completed:
            return .green
        case .failed:
            return .orange
        case .cancelled:
            return .secondary
        case .reading, .uploading:
            return .accentColor
        }
    }
}

private enum WorkspaceTransferAction {
    case move(WorkspaceItem)
    case copy(WorkspaceItem)

    var title: String {
        switch self {
        case let .move(item): "Move \(item.name)"
        case let .copy(item): "Copy \(item.name)"
        }
    }

    var buttonTitle: String {
        switch self {
        case .move: "Move"
        case .copy: "Copy"
        }
    }
}

private enum NewWorkspaceItemKind {
    case file
    case folder

    var title: String {
        switch self {
        case .file: "New file"
        case .folder: "New folder"
        }
    }
}

struct FilePreviewView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        VStack(spacing: 0) {
            if let rawFile = store.selectedRawFile {
                HeaderView(title: rawFile.name, subtitle: rawFile.path)
                if rawFile.kind == "pdf" {
                    PDFPreviewView(url: rawFile.url)
                } else if rawFile.kind == "image" {
                    AsyncImage(url: rawFile.url) { phase in
                        switch phase {
                        case let .success(image):
                            image
                                .resizable()
                                .scaledToFit()
                                .padding(20)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        case let .failure(error):
                            ContentUnavailableView("Could not load image", systemImage: "photo", description: Text(error.localizedDescription))
                        case .empty:
                            ProgressView()
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        @unknown default:
                            EmptyView()
                        }
                    }
                } else {
                    ContentUnavailableView("Raw preview unavailable", systemImage: "doc", description: Text(rawFile.path))
                }
            } else if let file = store.selectedFile {
                HeaderView(title: file.name, subtitle: file.path)
                HStack(spacing: 12) {
                    if store.isEditingFile {
                        Button {
                            Task { await store.saveSelectedFile() }
                        } label: {
                            Label("Save", systemImage: "square.and.arrow.down")
                        }
                        .buttonStyle(.borderless)
                        .disabled(!store.selectedFileIsDirty)

                        Button {
                            store.cancelEditingSelectedFile()
                        } label: {
                            Label("Cancel", systemImage: "xmark.circle")
                        }
                        .buttonStyle(.borderless)
                    } else {
                        Button {
                            store.startEditingSelectedFile()
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        .buttonStyle(.borderless)
                        .disabled(!store.selectedFileCanEdit)
                    }

                    if store.selectedFileIsDirty {
                        Label("Unsaved changes", systemImage: "circle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }

                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)

                if store.isEditingFile {
                    TextEditor(text: $store.editorText)
                        .font(.system(.body, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .padding(16)
                } else {
                    ScrollView {
                        if file.kind == "markdown" {
                            RichMarkdownView(markdown: file.content)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(20)
                        } else if file.kind == "code" {
                            CodeFileRenderedView(language: languageForPath(file.path), code: file.content)
                                .padding(20)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text(file.content)
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(20)
                        }
                    }
                }
            } else {
                ContentUnavailableView("Select a file", systemImage: "doc.text.magnifyingglass", description: Text("Open a markdown or text file from the tree."))
            }
        }
    }
}

struct CodeFileRenderedView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let language: String?
    let code: String
    @State private var renderedHTML: String?
    @State private var webHeight: CGFloat = 120
    @State private var renderFailed = false

    var body: some View {
        Group {
            if let renderedHTML, !renderFailed {
                RenderedMarkdownWebView(html: renderedHTML, height: $webHeight)
                    .frame(minHeight: webHeight, maxHeight: webHeight)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                CodeBlockView(language: language, code: code)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: "\(language ?? ""):\(code.hashValue)") {
            await loadServerRenderedHTML()
        }
    }

    private func loadServerRenderedHTML() async {
        guard let api = store.api else {
            renderFailed = true
            renderedHTML = nil
            return
        }
        do {
            try await Task.sleep(nanoseconds: 150_000_000)
            let html = try await api.renderCode(code: code, language: language)
            guard !Task.isCancelled else { return }
            renderedHTML = html
            renderFailed = false
        } catch {
            guard !Task.isCancelled else { return }
            renderedHTML = nil
            renderFailed = true
        }
    }
}

private func languageForPath(_ path: String) -> String? {
    let lower = path.lowercased()
    let name = URL(fileURLWithPath: lower).lastPathComponent
    if name == "dockerfile" { return "dockerfile" }
    if name == "makefile" { return "makefile" }

    switch URL(fileURLWithPath: lower).pathExtension {
    case "py", "pyw": return "python"
    case "js", "mjs", "cjs": return "javascript"
    case "ts", "tsx": return "typescript"
    case "jsx": return "jsx"
    case "swift": return "swift"
    case "java": return "java"
    case "c", "h": return "c"
    case "cc", "cpp", "cxx", "hpp", "hh", "hxx": return "cpp"
    case "cs": return "csharp"
    case "kt", "kts": return "kotlin"
    case "rs": return "rust"
    case "go": return "go"
    case "rb": return "ruby"
    case "php": return "php"
    case "sh", "bash", "zsh": return "bash"
    case "sql": return "sql"
    case "json": return "json"
    case "yml", "yaml": return "yaml"
    case "html", "htm": return "html"
    case "css": return "css"
    case "md", "markdown": return "markdown"
    case "xml": return "xml"
    default: return nil
    }
}

#if os(macOS)
struct PDFPreviewView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        view.document = PDFDocument(url: url)
    }
}
#endif

#if os(iOS)
struct PDFPreviewView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        view.document = PDFDocument(url: url)
    }
}
#endif
