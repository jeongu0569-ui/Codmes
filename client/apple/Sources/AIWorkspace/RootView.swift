import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var selection: WorkspaceSection? = .chat
    @State private var isChatPanelVisible = false
    @State private var chatPanelDragX: CGFloat = 0
    @State private var isSidebarVisible = false
    @State private var sidebarDragX: CGFloat = 0
    @State private var showingSettings = false

    var body: some View {
        #if os(macOS)
        NavigationSplitView {
            List(WorkspaceSection.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.systemImage)
                    .tag(section)
            }
            .navigationTitle("Workspace")
            .safeAreaInset(edge: .bottom) {
                ServerStatusView()
                    .padding(12)
            }
        } detail: {
            detailView
                .toolbar {
                    #if os(macOS)
                    if selectedSection != .chat {
                        Button {
                            isChatPanelVisible.toggle()
                        } label: {
                            Image(systemName: isChatPanelVisible ? "sidebar.right" : "bubble.right")
                        }
                        .help(isChatPanelVisible ? "Hide chat panel" : "Show chat panel")
                    }
                    #endif
                }
        }
        #else
        iOSRootView
        #endif
    }

    private var selectedSection: WorkspaceSection {
        selection ?? .chat
    }

    @ViewBuilder
    private var detailView: some View {
        #if os(macOS)
        if selectedSection != .chat && isChatPanelVisible {
            HSplitView {
                primaryDetailView
                    .frame(minWidth: 0)
                Divider()
                ChatHomeView(compact: true)
                    .frame(minWidth: 320, idealWidth: 390, maxWidth: 460)
            }
        } else {
            primaryDetailView
        }
        #else
        if selectedSection == .chat {
            primaryDetailView
        } else {
            iOSSwipeChatContainer {
                primaryDetailView
            }
        }
        #endif
    }

    #if os(iOS)
    private var iOSRootView: some View {
        GeometryReader { proxy in
            let sidebarWidth = min(max(proxy.size.width * 0.78, 260), 320)
            ZStack(alignment: .leading) {
                iOSMainContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                if isSidebarVisible {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .gesture(sidebarGesture(width: sidebarWidth))
                        .onTapGesture {
                            closeSidebar()
                        }
                }

                iOSSidebar(width: sidebarWidth)
                    .offset(x: sidebarOffset(width: sidebarWidth))
                    .gesture(sidebarGesture(width: sidebarWidth))

                if !isSidebarVisible && !isChatPanelVisible {
                    Color.clear
                        .frame(width: 52)
                        .padding(.top, 58)
                        .contentShape(Rectangle())
                        .gesture(sidebarGesture(width: sidebarWidth))
                }
            }
            .clipped()
        }
        .sheet(isPresented: $showingSettings) {
            WorkspaceSettingsView(isPresented: $showingSettings)
                .environmentObject(store)
        }
    }

    private var iOSMainContent: some View {
        VStack(spacing: 0) {
            iOSTopBar
            Divider()
            switch selectedSection {
            case .chat:
                ChatHomeView(showsHeader: false)
            case .notes, .code:
                iOSSwipeChatContainer {
                    FilePreviewView()
                }
            case .search:
                iOSSwipeChatContainer {
                    SearchView()
                }
            }
        }
        .background(.background)
    }

    private var iOSTopBar: some View {
        HStack(spacing: 12) {
            Button {
                openSidebar()
            } label: {
                Image(systemName: "sidebar.left")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .frame(width: 34, height: 34)
            .contentShape(Rectangle())

            VStack(alignment: .leading, spacing: 2) {
                Text(selectedSection.rawValue)
                    .font(.headline.weight(.semibold))
                HStack(spacing: 6) {
                    Circle()
                        .fill(store.isWorkspaceConnected ? .green : .orange)
                        .frame(width: 7, height: 7)
                    Text(store.isWorkspaceConnected ? "Connected" : "Disconnected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button {
                showingSettings = true
            } label: {
                Image(systemName: "gearshape")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .frame(width: 34, height: 34)
            .contentShape(Rectangle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(.quaternary.opacity(0.14))
    }

    private func iOSSidebar(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Hermes")
                    .font(.title2.weight(.semibold))
                Text(store.workspace?.rootName ?? "AI Workspace")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)

            VStack(spacing: 4) {
                ForEach(WorkspaceSection.allCases) { section in
                    Button {
                        selectSectionFromSidebar(section)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: section.systemImage)
                                .frame(width: 22)
                            Text(section.rawValue)
                            Spacer()
                        }
                        .font(.headline)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .foregroundStyle(selectedSection == section ? .primary : .secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .background(
                            selectedSection == section ? Color.secondary.opacity(0.14) : Color.clear,
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)

            if selectedSection == .notes {
                Divider()
                    .padding(.vertical, 4)
                FileBrowserPane(title: "Notes", root: "notes", showsHeader: false) {
                    closeSidebar()
                }
            } else if selectedSection == .code {
                Divider()
                    .padding(.vertical, 4)
                FileBrowserPane(title: "Code", root: "code", showsHeader: false) {
                    closeSidebar()
                }
            }

            Spacer()

            Button {
                showingSettings = true
                closeSidebar()
            } label: {
                Label("Settings", systemImage: "gearshape")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(.secondary)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(18)
        }
        .frame(width: width, alignment: .leading)
        .frame(maxHeight: .infinity)
        .background(.regularMaterial)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(.quaternary.opacity(0.55))
                .frame(width: 1)
        }
        .shadow(color: .black.opacity(0.20), radius: 18, x: 6, y: 0)
    }

    private func openSidebar() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
            isSidebarVisible = true
            isChatPanelVisible = false
            sidebarDragX = 0
            chatPanelDragX = 0
        }
    }

    private func closeSidebar() {
        withAnimation(.spring(response: 0.24, dampingFraction: 0.92)) {
            isSidebarVisible = false
            sidebarDragX = 0
        }
    }

    private func selectSectionFromSidebar(_ section: WorkspaceSection) {
        selection = section
        closeSidebar()
    }

    private func sidebarOffset(width: CGFloat) -> CGFloat {
        if isSidebarVisible {
            return min(0, sidebarDragX)
        }
        return min(0, -width + sidebarDragX)
    }

    private func sidebarGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                guard !isChatPanelVisible else { return }
                if isSidebarVisible {
                    sidebarDragX = min(0, value.translation.width)
                } else {
                    sidebarDragX = max(0, value.translation.width)
                }
            }
            .onEnded { value in
                guard !isChatPanelVisible else {
                    sidebarDragX = 0
                    return
                }
                let predicted = value.predictedEndTranslation.width
                let shouldOpen = isSidebarVisible
                    ? value.translation.width > -width * 0.28 && predicted > -width * 0.44
                    : value.translation.width > 34 || predicted > 72
                withAnimation(.spring(response: 0.26, dampingFraction: 0.9)) {
                    isSidebarVisible = shouldOpen
                    if shouldOpen {
                        isChatPanelVisible = false
                        chatPanelDragX = 0
                    }
                    sidebarDragX = 0
                }
            }
    }

    private func iOSSwipeChatContainer<Content: View>(@ViewBuilder content: @escaping () -> Content) -> some View {
        GeometryReader { proxy in
            let panelWidth = min(max(proxy.size.width * 0.88, 300), 430)
            ZStack(alignment: .trailing) {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                if isChatPanelVisible {
                    Color.black.opacity(0.24)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                                isChatPanelVisible = false
                                chatPanelDragX = 0
                            }
                        }
                }

                HStack(spacing: 0) {
                    ZStack {
                        Color.clear
                        RoundedRectangle(cornerRadius: 2)
                            .fill(.secondary.opacity(0.55))
                            .frame(width: 3, height: 48)
                    }
                    .frame(width: 20)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .highPriorityGesture(chatPanelGesture(panelWidth: panelWidth))

                    ChatHomeView(compact: true)
                        .frame(width: panelWidth)
                        .background(.regularMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                        .shadow(color: .black.opacity(0.22), radius: 18, x: -6, y: 0)
                }
                .frame(width: panelWidth + 15)
                .frame(maxHeight: .infinity)
                .offset(x: chatPanelOffset(panelWidth: panelWidth))
                .highPriorityGesture(chatPanelGesture(panelWidth: panelWidth))

                if !isChatPanelVisible && !isSidebarVisible {
                    Color.clear
                        .frame(width: 28)
                        .contentShape(Rectangle())
                        .gesture(chatPanelGesture(panelWidth: panelWidth))
                }
            }
            .clipped()
        }
    }

    private func chatPanelOffset(panelWidth: CGFloat) -> CGFloat {
        let closedOffset = panelWidth + 15
        if isChatPanelVisible {
            return max(0, chatPanelDragX)
        }
        return max(0, closedOffset + chatPanelDragX)
    }

    private func chatPanelGesture(panelWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                guard !isSidebarVisible else { return }
                if isChatPanelVisible {
                    chatPanelDragX = min(panelWidth + 15, max(0, value.translation.width))
                } else {
                    chatPanelDragX = max(-(panelWidth + 15), min(0, value.translation.width))
                }
            }
            .onEnded { value in
                guard !isSidebarVisible else {
                    chatPanelDragX = 0
                    return
                }
                let predicted = value.predictedEndTranslation.width
                let shouldOpen = isChatPanelVisible
                    ? value.translation.width < panelWidth * 0.28 && predicted < panelWidth * 0.45
                    : value.translation.width < -44 || predicted < -80
                withAnimation(.spring(response: 0.28, dampingFraction: 0.88)) {
                    isChatPanelVisible = shouldOpen
                    if shouldOpen {
                        isSidebarVisible = false
                        sidebarDragX = 0
                    }
                    chatPanelDragX = 0
                }
            }
    }
    #endif

    @ViewBuilder
    private var primaryDetailView: some View {
        switch selectedSection {
        case .chat:
            ChatHomeView()
        case .notes:
            FileSectionView(title: "Notes", root: "notes")
        case .code:
            FileSectionView(title: "Code", root: "code")
        case .search:
            SearchView()
        }
    }
}

struct ServerStatusView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Workspace Server", text: $store.serverURLText)
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                #endif
                .onChange(of: store.serverURLText) {
                    store.persistServerURLText()
                }
                .onSubmit {
                    store.saveServerURL()
                    Task { await store.refreshWorkspace() }
                }
            Text(store.serverConnectionHint)
                .font(.caption2)
                .foregroundStyle(store.serverURLUsesLocalhost ? .orange : .secondary)
                .fixedSize(horizontal: false, vertical: true)
            #if os(iOS)
            Button {
                store.useMacTailscaleServerURL()
                Task { await store.refreshWorkspace() }
            } label: {
                Label("Use Mac Tailscale", systemImage: "network")
                    .labelStyle(.titleAndIcon)
                    .font(.caption)
            }
            .buttonStyle(.borderless)
            #endif
            HStack {
                Circle()
                    .fill(store.isWorkspaceConnected ? .green : .orange)
                    .frame(width: 8, height: 8)
                Text(store.statusMessage)
                    .font(.caption)
                    .lineLimit(2)
                Spacer()
                Button {
                    store.saveServerURL()
                    Task { await store.refreshWorkspace() }
                } label: {
                    Label("Connect", systemImage: "arrow.clockwise")
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.borderless)
            }
            Text(store.connectionDetail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            Text("Step: \(store.connectionStep)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}

struct WorkspaceSettingsView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @Binding var isPresented: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Connection")
                            .font(.headline)
                        ServerStatusView()
                    }
                    .padding(14)
                    .background(.quaternary.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))

                    VStack(alignment: .leading, spacing: 6) {
                        Text("iPhone / Tailscale")
                            .font(.headline)
                        Text("Use the Mac server's Tailscale URL when the app runs on iPhone or iPad. 127.0.0.1 points to the phone itself.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(14)
                    .background(.quaternary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                }
                .padding(18)
            }
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        isPresented = false
                    }
                }
            }
        }
    }
}
