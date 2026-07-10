import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var selection: WorkspaceSection? = .chat
    @State private var sidebarMenuExpanded = false
    @State private var isChatPanelVisible = false
    @State private var chatPanelDragX: CGFloat = 0
    @State private var isSidebarVisible = false
    @State private var sidebarDragX: CGFloat = 0
    @State private var showingSettings = false
    @State private var isMacSidebarVisible = true

    var body: some View {
        #if os(macOS)
        GeometryReader { proxy in
            HStack(spacing: 0) {
                if isMacSidebarVisible {
                    VStack(spacing: 0) {
                        List(WorkspaceSection.allCases, selection: $selection) { section in
                            Label(section.rawValue, systemImage: section.systemImage)
                                .tag(section)
                        }
                        .navigationTitle("Workspace")

                        Divider()

                        ScrollView {
                            ServerStatusView()
                                .padding(12)
                        }
                        .frame(maxHeight: min(240, proxy.size.height * 0.38))
                    }
                    .frame(width: min(240, max(180, proxy.size.width * 0.22)))

                    Divider()
                }

                detailView
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .toolbar {
                        Button {
                            isMacSidebarVisible.toggle()
                        } label: {
                            Image(systemName: "sidebar.left")
                        }
                        .help(isMacSidebarVisible ? "Hide sidebar" : "Show sidebar")

                        if selectedSection != .chat {
                            Button {
                                isChatPanelVisible.toggle()
                            } label: {
                                Image(systemName: isChatPanelVisible ? "sidebar.right" : "bubble.right")
                            }
                            .help(isChatPanelVisible ? "Hide chat panel" : "Show chat panel")
                        }

                        Button {
                            showingSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                        }
                        .help("Settings")
                    }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(minWidth: 640, idealWidth: 1120, minHeight: 420, idealHeight: 740)
        .sheet(isPresented: $showingSettings) {
            WorkspaceSettingsView(isPresented: $showingSettings)
                .environmentObject(store)
        }
        .task(id: selectedSection) {
            store.activeChatSurface = selectedSection.runtimeSurfaceId
            await autoRefreshVisibleFileTree()
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
                    .simultaneousGesture(edgeOpenSidebarGesture(width: sidebarWidth))

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
            }
            .clipped()
        }
        .sheet(isPresented: $showingSettings) {
            WorkspaceSettingsView(isPresented: $showingSettings)
                .environmentObject(store)
        }
        .task(id: selectedSection) {
            store.activeChatSurface = selectedSection.runtimeSurfaceId
            await autoRefreshVisibleFileTree()
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
                Text("Codmes")
                    .font(.title2.weight(.semibold))
                Text(store.workspace?.rootName ?? "Codmes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)

            VStack(spacing: 8) {
                Button {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.9)) {
                        sidebarMenuExpanded.toggle()
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: selectedSection.systemImage)
                            .frame(width: 20)
                        Text(selectedSection.rawValue)
                            .font(.headline.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.bold))
                            .rotationEffect(.degrees(sidebarMenuExpanded ? 180 : 0))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(RoundedRectangle(cornerRadius: 10))
                    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)

                if sidebarMenuExpanded {
                    VStack(spacing: 2) {
                        ForEach(WorkspaceSection.allCases) { section in
                            Button {
                                selectSectionFromSidebar(section)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: section.systemImage)
                                        .frame(width: 20)
                                    Text(section.rawValue)
                                    Spacer()
                                }
                                .font(.subheadline.weight(.medium))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 9)
                                .foregroundStyle(selectedSection == section ? .primary : .secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(RoundedRectangle(cornerRadius: 8))
                                .background(
                                    selectedSection == section ? Color.secondary.opacity(0.12) : Color.clear,
                                    in: RoundedRectangle(cornerRadius: 8)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(6)
                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(.horizontal, 10)

            if selectedSection == .notes {
                Divider()
                    .padding(.vertical, 4)
                FileBrowserPane(title: "Notes", root: "notes", showsHeader: false) {
                    closeSidebar()
                }
                .frame(maxHeight: .infinity)
            } else if selectedSection == .code {
                Divider()
                    .padding(.vertical, 4)
                FileBrowserPane(title: "Code", root: "code", showsHeader: false) {
                    closeSidebar()
                }
                .frame(maxHeight: .infinity)
            } else {
                Spacer()
            }

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
        withAnimation(.spring(response: 0.22, dampingFraction: 0.9)) {
            sidebarMenuExpanded = false
        }
        if section == .chat {
            closeSidebar()
        }
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

    private func edgeOpenSidebarGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 14)
            .onChanged { value in
                guard !isSidebarVisible, !isChatPanelVisible, value.startLocation.x <= 26 else { return }
                sidebarDragX = max(0, value.translation.width)
            }
            .onEnded { value in
                guard !isSidebarVisible, !isChatPanelVisible, value.startLocation.x <= 26 else {
                    sidebarDragX = 0
                    return
                }
                let shouldOpen = value.translation.width > 34 || value.predictedEndTranslation.width > 72
                withAnimation(.spring(response: 0.26, dampingFraction: 0.9)) {
                    isSidebarVisible = shouldOpen
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
                .simultaneousGesture(chatPanelGesture(panelWidth: panelWidth))

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
                guard abs(value.translation.width) > abs(value.translation.height) * 1.35 else {
                    chatPanelDragX = 0
                    return
                }
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
                guard abs(value.translation.width) > abs(value.translation.height) * 1.35 else {
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

    private func autoRefreshVisibleFileTree() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            switch selectedSection {
            case .notes:
                await store.refreshTree(root: "notes")
            case .code:
                await store.refreshTree(root: "code")
            case .chat:
                return
            }
        }
    }

    @ViewBuilder
    private var primaryDetailView: some View {
        switch selectedSection {
        case .chat:
            ChatHomeView()
        case .notes:
            FileSectionView(title: "Notes", root: "notes")
        case .code:
            FileSectionView(title: "Code", root: "code")
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
            SecureField("Server auth token (optional)", text: $store.serverAuthToken)
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #endif
                .onChange(of: store.serverAuthToken) {
                    store.persistServerAuthToken()
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

                    RuntimeModelSettingsView()
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

private struct RuntimeModelSettingsView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var selectedProviderId = ""
    @State private var model = ""
    @State private var apiKey = ""
    @State private var baseUrl = ""
    @State private var isSaving = false

    private var provider: RuntimeProviderOption? {
        store.runtimeProviders.first { $0.id == selectedProviderId }
    }

    private var models: [String] {
        let discovered = store.runtimeProviderModels[selectedProviderId] ?? []
        return discovered.isEmpty ? (provider?.models ?? []) : discovered
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Providers")
                .font(.headline)
            #if os(iOS)
            VStack(alignment: .leading, spacing: 14) {
                providerList
                providerDetail
            }
            #else
            HStack(alignment: .top, spacing: 16) {
                providerList
                    .frame(width: 280)
                providerDetail
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            #endif
            if !store.runtimeModelSetupMessage.isEmpty {
                Text(store.runtimeModelSetupMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .task {
            await store.refreshRuntimeProviders()
            if selectedProviderId.isEmpty {
                let current = store.runtimeProviders.first(where: { $0.isDefault == true }) ?? store.runtimeProviders.first
                if let current {
                    selectProvider(current)
                }
            }
        }
    }

    private var providerList: some View {
        VStack(alignment: .leading, spacing: 10) {
            providerSection("Accounts", providers: providers(in: "Accounts"))
            providerSection("API Keys", providers: providers(in: "API Keys"))
            providerSection("Local", providers: providers(in: "Local"))
        }
    }

    private var providerDetail: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let provider {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(provider.name)
                            .font(.headline)
                        Text(provider.setupHint)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if provider.configured == true {
                        Label("Connected", systemImage: "checkmark")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                }

                providerCredentialFields(provider)

                HStack(spacing: 10) {
                    Picker("Model", selection: $model) {
                        Text("Select model").tag("")
                        ForEach(models, id: \.self) { item in
                            Text(item).tag(item)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: .infinity)

                    Button {
                        Task { await refreshSelectedProviderModels(saveValuesFirst: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)
                    .help("Refresh models")
                }

                HStack {
                    Button {
                        isSaving = true
                        Task {
                            _ = await store.saveRuntimeModelConfiguration(
                                providerId: selectedProviderId,
                                model: model,
                                apiKey: apiKey,
                                baseUrl: baseUrl
                            )
                            apiKey = ""
                            isSaving = false
                        }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Label("Set Default", systemImage: "checkmark")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isEmpty || isSaving)

                    if provider.isOAuth {
                        Text("Run `codmes model` on the server to sign in.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("Select a provider.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(.quaternary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }

    private func providers(in section: String) -> [RuntimeProviderOption] {
        store.runtimeProviders.filter { $0.sectionTitle == section }
    }

    private func providerSection(_ title: String, providers: [RuntimeProviderOption]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(providers) { option in
                Button {
                    selectProvider(option)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: iconName(for: option))
                            .frame(width: 18)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(option.name)
                                .font(.callout)
                                .lineLimit(1)
                            Text(option.id)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if option.isDefault == true {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        } else if option.configured == true {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 7)
                    .padding(.horizontal, 9)
                    .background(
                        selectedProviderId == option.id ? Color.accentColor.opacity(0.14) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 8)
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func providerCredentialFields(_ provider: RuntimeProviderOption) -> some View {
        if provider.isLocalOllama {
            TextField("http://127.0.0.1:11434/v1", text: $baseUrl)
                .textFieldStyle(.roundedBorder)
            Text("The Workspace Server resolves this URL. iPhone does not connect to Ollama directly.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else if provider.needsAPIKey {
            SecureField(provider.configured == true ? "New API key (leave blank to keep current)" : "API key", text: $apiKey)
                .textFieldStyle(.roundedBorder)
            if provider.baseUrlEnv != nil {
                TextField(provider.defaultBaseUrl ?? "Base URL", text: $baseUrl)
                    .textFieldStyle(.roundedBorder)
            }
        } else if provider.isOAuth {
            Label("Account OAuth is stored on the server runtime.", systemImage: "person.badge.key")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func selectProvider(_ option: RuntimeProviderOption) {
        selectedProviderId = option.id
        model = ""
        apiKey = ""
        baseUrl = option.defaultBaseUrl ?? ""
        Task { await refreshSelectedProviderModels(saveValuesFirst: false) }
    }

    private func refreshSelectedProviderModels(saveValuesFirst: Bool) async {
        guard !selectedProviderId.isEmpty else { return }
        if saveValuesFirst {
            _ = await store.saveRuntimeProviderValues(providerId: selectedProviderId, apiKey: apiKey, baseUrl: baseUrl)
        }
        await store.discoverRuntimeModels(providerId: selectedProviderId)
        let nextModels = store.runtimeProviderModels[selectedProviderId] ?? provider?.models ?? []
        if model.isEmpty, let first = nextModels.first {
            model = first
        }
    }

    private func iconName(for provider: RuntimeProviderOption) -> String {
        if provider.isLocalProvider { return "desktopcomputer" }
        if provider.isOAuth { return "person.crop.circle.badge.checkmark" }
        return "key"
    }
}
