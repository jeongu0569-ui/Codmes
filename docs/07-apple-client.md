# Apple Client

The first Apple client is a SwiftUI shell in:

```text
client/apple
```

It now has a real Xcode project for app development:

```text
client/apple/AIWorkspace.xcodeproj
```

The previous Swift Package remains in place as a lightweight CLI build check,
but the main app-development path is now Xcode. The Xcode project contains a
macOS app target and an iOS app target that share the same SwiftUI source files.

## Run

Start the Workspace Server first:

```bash
npm start
```

Then run the client:

```bash
cd client/apple
xcodebuild -project AIWorkspace.xcodeproj -scheme AIWorkspace -destination 'platform=macOS' build
open ~/Library/Developer/Xcode/DerivedData
```

For the old package shell smoke test, `swift run AIWorkspace` still works on
macOS.

## Current Views

```text
Chat
Notes
Code
Search
```

Implemented:

- server URL setting
- workspace status loading
- Notes root listing
- Code root listing
- recursive Notes and Code folder navigation
- text/markdown file preview
- markdown/text/code editing and save through `PUT /api/file`
- PDF rendering through `GET /api/raw` and PDFKit
- image preview through `GET /api/raw`
- workspace search UI
- Hermes live chat connection through the Workspace Server
- Hermes model picker backed by `GET /api/hermes/models`
- Hermes session resume menu backed by `GET /api/hermes/sessions`
- session menu syncs Hermes history whenever the menu is opened, so a separate
  refresh button is no longer required
- Hermes session history loading backed by `GET /api/hermes/sessions/:id/messages`
- History sheet for session search, resume, and guarded delete
- live session creation
- message submit
- Obsidian-plugin-style chat composer with `+`, History, Safe/Full access,
  model picker, Fast/Med/Deep reasoning picker, and icon send button
- chat context scope picker
- `contextRequest` forwarding for current file, current folder, and workspace scopes
- basic live event rendering for assistant, thinking, tool, approval, and system events
- grouped, collapsible thinking/tool activity rows, one compact activity group per user turn
- streaming thinking/reasoning deltas coalesced into smooth activity blocks instead of one row per token
- active activity shimmer while Hermes is still streaming; finished rows show
  `Done` and stop animating
- Markdown rendering for assistant answers with a SwiftUI block renderer ported
  from the Obsidian/Hermes approach: headings, paragraphs, unordered lists,
  ordered lists, task checkboxes, block quotes, horizontal rules, fenced code
  blocks, and Markdown tables are rendered as distinct UI blocks instead of
  one flat line
- the same Markdown/code renderer is now used by Notes and Code file previews,
  so chat answers, markdown notes, and source files share one rendering surface
- code highlighting is language-aware in the current native renderer. It
  normalizes common aliases and has profiles for Python, C/C++, Java/Kotlin/C#,
  JavaScript/TypeScript, Swift, Rust, Go, shell/Dockerfile/Makefile, SQL,
  JSON/YAML, HTML/XML, CSS, Ruby, PHP, Markdown, and fallback code.
- server-rendered Markdown is now available through `POST /api/render/markdown`.
  The server uses `marked` for Markdown and `shiki` for code highlighting, then
  the Apple client displays the result through `WKWebView`. If the server render
  request fails, the existing native SwiftUI renderer remains as fallback.
- standalone Code file previews now use `POST /api/render/code`, so source
  files get the same Shiki highlighting path as fenced code blocks. If the
  server render request fails, the existing native SwiftUI code card remains as
  fallback.
- Notes and Code file browsers can create a new file or folder in the current
  server-managed folder. New Notes files default to `.md`; new Code files
  default to `.swift` unless the user enters an extension.
- approval and denial buttons for `approval.request` events
- normalized Hermes session menu titles instead of raw generated session ids
- zero-message Hermes sessions are hidden from the client session list
- the new chat `+` button clears the local chat view but does not create a Hermes session until the first message is sent
- macOS activation fix for `swift run AIWorkspace`, so the launched window becomes the key app for keyboard input
- compact Notes/Code split view sizing for smaller macOS windows
- default macOS sidebar toggle only; the custom duplicate sidebar button was removed
- Xcode project with separate macOS and iOS app targets
- shared SwiftUI source between macOS and iOS
- iOS Simulator build support
- iOS device build support when the local Xcode signing team is configured
- physical iPhone app installation has been verified with a local Personal Team
- global chat side panel for Notes, Code, and Search. macOS shows a compact
  right-side split panel; iOS reveals the same compact chat surface by swiping
  left from the right edge, closer to the Obsidian plugin side-panel feel.
- iOS now uses a chat-first custom shell instead of `NavigationSplitView`.
  The main screen stays fixed, the left workspace menu opens as a drawer, and
  server connection settings live in a Settings sheet.
- compact iOS chat controls use short visible labels for access/model/reasoning
  so long provider model names do not expand vertically and fill the screen.
- the chat composer mirrors the Obsidian Hermes Connection layout more closely:
  new chat and history live in the chat header, while context/access/model/
  reasoning/send controls stay compact in the composer.
- tapping outside the chat input or scrolling the transcript dismisses the iOS
  keyboard.
- the iOS drawer hit target and spring thresholds were tuned so the left
  workspace menu opens more reliably from the edge and menu rows respond across
  the full row.
- the Apple client now uses a neutral app tint and neutral file/chat colors to
  avoid bright default blue controls in dark mode.
- connection diagnostics now call `/api/health` before loading workspace data
  and show the exact URL/error in the sidebar status area.
- macOS windows get a default app-sized frame and are clamped back inside the
  visible screen if a restored window opens too large or clipped.

Not yet implemented:

- Repository-level Apple developer team signing is intentionally not fixed to a
  specific account. Configure the `AIWorkspace iOS` target's Team in Xcode before
  installing on a physical iPhone/iPad.
- iPhone/iPad runtime UX pass after trusting the local developer profile on the
  device

## Client API Boundary

The app talks only to the Workspace Server:

```text
GET  /api/workspace
GET  /api/tree
GET  /api/file
POST /api/search
WS   /api/live
```

It should not directly access filesystem paths or Hermes dashboard cookies.

## Live Chat Flow

The SwiftUI client does not connect to Hermes directly. It opens:

```text
WS /api/live
```

on the Workspace Server. The server is responsible for Hermes dashboard login,
WebSocket ticket creation, Hermes live session routing, and approval forwarding.

Chat can be used in two places:

```text
Chat tab
  -> full-page ChatHomeView

Notes / Code / Search toolbar chat button
  -> compact ChatHomeView
  -> macOS: right-side split panel
  -> iOS: right-edge swipe panel
```

On iOS, the app shell is intentionally chat-first. The left workspace menu is a
custom drawer opened from the top-left sidebar icon or by swiping from the left
edge. Server URL and connection diagnostics are managed from the Settings sheet,
not from the drawer itself.

The left workspace drawer and the right global chat drawer are mutually
exclusive. Opening one closes the other, and the opposite edge gesture is
disabled while a drawer is open so a right-swipe close does not accidentally open
the left menu. The right chat drawer uses a full-height drag handle and
high-priority swipe handling so it can be closed with a right swipe from the
panel itself, similar to the left drawer.

The global panel uses the same `WorkspaceStore`, live session, model picker,
access mode, reasoning mode, session manager, approval controls, and message
history as the main Chat tab. It is a different presentation of the same chat
state, not a separate local chat instance. iOS intentionally does not show a
toolbar button for this panel; the panel is opened by swiping left from the
right screen edge and dismissed by swiping right or tapping the dimmed content.

The current client flow is:

```text
Connect button or first message
  -> WS /api/live
  -> connect
  -> session.create
  -> prompt.submit with optional contextRequest
  -> render hermes.event messages
  -> approval.respond when the user approves or denies a request
```

When the user chooses an existing Hermes session, the client first loads saved
messages from:

```text
GET /api/hermes/sessions/:id/messages
```

Then it resumes the live WebSocket session. This keeps the visible chat history
aligned with the Hermes session instead of showing only local system messages
such as "Live bridge ready".

The `+` button starts a local blank chat state only. Hermes session creation is
deferred until the user sends the first message, which avoids empty orphan
sessions in Hermes history.

The session menu refreshes Hermes metadata immediately before opening, and the
History sheet also refreshes on presentation. This mirrors the Obsidian plugin
behavior: history is synchronized at the moment the user is about to choose or
manage a session instead of requiring a separate reload button.

The client now treats assistant text and activity as separate streams.
`message.delta` appends to the assistant bubble. Thinking, reasoning, and tool
events are grouped into a single collapsible activity row for the current user
turn. `message.complete`, `turn.complete`, and related completion events close
the current activity group so late events do not create extra rows after the
answer.

User messages are right-aligned and assistant messages remain left-aligned, so
chat turns are visually easier to scan.

Assistant answers are rendered by a small SwiftUI Markdown block renderer. The
renderer follows the same broad approach as the Obsidian plugin and Hermes UI:
split the text into blocks first, then render headings, paragraphs, lists,
tasks, quotes, rules, fenced code blocks, and table rows with dedicated views.
Inline emphasis/code is still handled through Swift
`AttributedString(markdown:)` inside each text cell.

Fenced code blocks preserve the language tag from Markdown fences such as
```` ```python ```` and render through server-side Shiki when the Workspace
Server is available. Code previews infer the language from the file extension
and use the same server-side Shiki path through `POST /api/render/code`.

The native fallback still has a compact `Code · Python` card with a copy button
and a lightweight local highlighter for comments, strings, numbers, literals,
and language-specific keyword sets. The fallback profiles cover Python, C/C++,
Java/Kotlin/C#, JavaScript/TypeScript, Swift, Rust, Go,
shell/Dockerfile/Makefile, SQL, JSON/YAML, HTML/XML, CSS, Ruby, PHP, Markdown,
and fallback code. Markdown tables render in a bordered, horizontally scrollable
table view with styled header cells when the native Markdown fallback is used.

Hermes Desktop/Web uses a web rendering stack with Markdown components and
Shiki/Streamdown dependencies available in the Hermes source tree. The Hermes
TUI has a separate terminal-specific renderer. Neither can be copied directly
into SwiftUI without a WebView bridge and bundled JavaScript resources. The
target architecture for Hermes-level rendering quality is:

```text
RichMarkdownView / CodeBlockView
  -> native renderer for fast fallback and editable previews
  -> WebView renderer for full Markdown + Shiki/TextMate-grade code color
```

The current renderer is intentionally structured so a future WebView/Shiki,
`CodeEditSourceEditor`, Tree-sitter, or Swift syntax-highlighting package can
replace the built-in highlighter without changing chat, Notes, and Code preview
call sites.

Notes and Code previews use the same rendering layer:

```text
Markdown file -> RichMarkdownView
Code file     -> CodeFileRenderedView(language from extension)
Other text    -> plain monospaced text
```

`RichMarkdownView` first attempts server rendering:

```text
RichMarkdownView
  -> POST /api/render/markdown
  -> WKWebView rendered HTML
  -> fallback to native SwiftUI Markdown blocks if unavailable

CodeFileRenderedView
  -> POST /api/render/code
  -> WKWebView rendered Shiki HTML
  -> fallback to native SwiftUI CodeBlockView if unavailable
```

The server-rendered path gives Markdown tables and fenced code blocks a much
closer rendering model to Hermes Desktop. Shiki runs on the Workspace Server,
so iOS does not need to bundle a JavaScript highlighter or parse TextMate
grammars locally.

The Notes and Code browser panes call the Workspace Server file APIs instead of
touching local client storage directly:

```text
New file   -> POST /api/file
New folder -> POST /api/folder
Move       -> PATCH /api/file/move
Copy       -> POST /api/file/copy
Rename     -> PATCH /api/file/move
Delete     -> DELETE /api/file
Save edit  -> PUT /api/file
```

This keeps file ownership on the server, which is required for iOS/iPadOS and
remote workspace use. On iOS, the app is not expected to mount NAS folders,
spawn local file tools, or modify the server disk directly. It only sends
workspace-relative paths to the Workspace Server, and the server performs the
actual filesystem operation inside the configured workspace root.

The current Apple UI exposes move/copy through context-menu actions with a
destination folder text field. This is intentionally server-relative and works
on iOS as well as macOS. A later drag-and-drop pass should reuse the same
`WorkspaceStore.moveItem` and `WorkspaceStore.copyItem` methods instead of
adding a second filesystem path layer.

While an activity block is streaming, its collapsed state shows a three-line
preview of the latest reasoning/tool text and a subtle shimmer. When streaming
finishes, the shimmer stops and the collapsed row returns to the summary-only
state. Saved Hermes reasoning is also restored as an activity row when loading
session history.

Activity rows are not full chat bubbles. They are compact left-aligned progress
rows so the reasoning/tool stream reads like a process log between the user
message and the final assistant answer.

The chat composer follows the same compact control model used in the Obsidian
Hermes plugin:

```text
  History  Safe/Full  Model  Fast/Med/Deep  Send
```

`Safe` maps to Hermes `yolo=false`, so dangerous actions still rely on Hermes'
approval gate. `Full` maps to `yolo=true`, allowing Hermes to proceed without
that extra approval step where Hermes supports it.

The reasoning menu maps to Hermes `config.set key=reasoning`:

```text
Fast -> low
Med  -> medium
Deep -> high
```

## Chat Context Scopes

The chat input can now choose the workspace context sent with each prompt:

```text
No context
Current file
Current folder
Workspace
```

The client only sends a compact `contextRequest`. The Workspace Server resolves
the path, decides inline versus RAG/search metadata, and forwards the rendered
context to Hermes. This keeps filesystem and indexing policy centralized on the
server instead of duplicating it in each Apple client.

Hermes live RPC currently stores the submitted prompt as one text field. Since
Workspace context must be included in that text for the model, saved user rows
can contain both context and the visible user message. When loading history, the
Apple client extracts the text after `[User message]` and displays only that
actual user message in the chat UI.

## Xcode Project

The app-development project is:

```text
client/apple/AIWorkspace.xcodeproj
```

Targets:

```text
AIWorkspace      macOS app target
AIWorkspace iOS  iPhone/iPad app target
```

The targets share the files in:

```text
client/apple/Sources/AIWorkspace
```

Platform-specific differences are handled with `#if os(macOS)` / `#if os(iOS)`.
For example:

- macOS uses `HSplitView`; iOS uses a stacked layout.
- macOS PDF preview uses `NSViewRepresentable`; iOS uses `UIViewRepresentable`.
- macOS applies `.windowStyle(.titleBar)` and activation handling; iOS does not.

Terminal support must be designed as a remote server feature, not as a
client-local shell. iOS/iPadOS cannot spawn a local development terminal, so the
cross-platform terminal panel should control terminal sessions running on the
Workspace Server or Hermes server:

```text
iOS/macOS terminal panel
  -> Workspace Server terminal API/WebSocket
  -> server-side shell or Hermes tool session
```

macOS may later add local-only developer conveniences, but those should be
separate from the shared iOS/macOS terminal feature.

Info plists:

```text
App/Info.plist      macOS
App/iOS-Info.plist  iOS
```

Both allow local HTTP networking during development because the client connects
to the local Workspace Server.

Current verified builds:

```bash
xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme AIWorkspace \
  -configuration Debug \
  -destination 'platform=macOS' build

xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build

xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -configuration Debug \
  -destination 'platform=iOS,id=<DEVICE_ID>' build
```

For command-line physical-device testing without committing a personal Team ID,
pass the Team ID at build time:

```bash
xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -configuration Debug \
  -destination 'platform=iOS,id=<DEVICE_ID>' \
  DEVELOPMENT_TEAM=<TEAM_ID> \
  -allowProvisioningUpdates build
```

If the app installs but launch is denied, trust the Apple Development profile on
the iPhone/iPad under `Settings > General > VPN & Device Management`.

The old package check is still useful for quick compile feedback:

```bash
cd client/apple
swift build
```
