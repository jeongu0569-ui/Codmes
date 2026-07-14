# Apple Client

The first Apple client is a SwiftUI shell in:

```text
client/apple
```

It now has a real Xcode project for app development:

```text
client/apple/Codmes.xcodeproj
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
xcodebuild -project Codmes.xcodeproj -scheme Codmes -destination 'platform=macOS' build
open ~/Library/Developer/Xcode/DerivedData
```

For the old package shell smoke test, `swift run Codmes` still works on
macOS.

## Current Views

```text
Chat
Notes
Code
```

Implemented:

- server URL setting
- optional server auth token setting. HTTP requests use `Authorization: Bearer`
  and live WebSocket/raw URLs use `?token=` when a token is configured.
  The token is stored in Keychain first; the old UserDefaults value is used only
  as a migration/fallback path.
- workspace status loading
- Surface settings for enabling/hiding built-in modes and adding lightweight
  plugin surfaces.
- Notes root listing
- Code root listing
- recursive Notes and Code folder navigation
- text/markdown file preview
- markdown/text/code editing and save through `PUT /api/file`
- PDF rendering through `GET /api/raw` and PDFKit
- iOS/iPadOS PDF page ink through PDFKit live drawing and
  `GET/PUT /api/file/annotations`
- iOS/iPadOS PDF markup tools for pen, partial eraser, object move/select, text
  box insertion, image attachment, object drag, object pinch-resize, text
  double-tap edit, and long-press delete. Ink strokes are stored as portable
  `inkStrokes`; text/image objects are stored as Codmes PDF annotation objects
  with page-relative bbox metadata.
- macOS PDF preview renders shared `inkStrokes`, and macOS edit mode can save
  mouse/trackpad pen strokes, erase strokes, select/move text/image objects,
  and delete selected objects with the Delete key through the same
  platform-neutral annotation JSON.
- iOS/iPadOS PDF export accepts an optional page range such as `1-3, 5`.
  Range exports remap editable Codmes state to the exported page order.
- iOS/iPadOS PDF insertion accepts a PDF plus an optional `.codmes.json` state
  file and inserts it after the current page. Existing annotation page indexes
  are shifted and imported annotation ids are regenerated to avoid collisions.
- image preview through `GET /api/raw`
- workspace search UI
- live chat connection through the Workspace Server
- model picker backed by `GET /api/models`
- session resume menu backed by `GET /api/sessions`
- session menu syncs history whenever the menu is opened, so a separate
  refresh button is no longer required
- session history loading backed by `GET /api/sessions/:id/messages`
- History sheet for session search, resume, and guarded delete
- a thin Obsidian-plugin-style session toolbar is shown even when the large Chat
  header is hidden. The left side opens session history management; the right
  side contains project grouping, session selection, and new-chat controls.
- session project grouping uses session project/workspace metadata when
  available and falls back to `All sessions` when the runtime does not expose project
  fields for a session.
- live session creation
- message submit
- Obsidian-plugin-style chat composer with `+`, History, Safe/Full access,
  model picker, Fast/Med/Deep reasoning picker, and icon send button
- chat context scope picker
- `contextRequest` forwarding for current file, current folder, and workspace scopes
- basic live event rendering for assistant, thinking, tool, approval, and system events
- Approval inbox view for server-side approval items, including pending approval
  review, approve/reject actions, and task refresh.
- Task panel inside the Approval inbox, including task status badges plus
  resume/cancel controls for `approval_required`, running, and queued tasks.
- Live approval/task events trigger inbox and task-list refreshes so approval
  state is visible without a manual restart.
- grouped, collapsible thinking/tool activity rows, one compact activity group per user turn
- streaming thinking/reasoning deltas coalesced into smooth activity blocks instead of one row per token
- active activity shimmer while Codmes is still streaming; finished rows show
  `Done` and stop animating
- Markdown rendering for assistant answers with a SwiftUI block renderer ported
  from the earlier Obsidian-style prototype: headings, paragraphs, unordered lists,
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
- Notes and Code file browsers also expose rename, delete, move, and copy from
  the row context menu. Each row now also has a visible `...` menu, so touch
  devices do not have to rely only on long-press discovery.
- Notes and Code file browsers can attach an existing local file into the
  current server-managed folder through the paperclip button. The picker now
  supports multiple files.
- uploads show a compact status panel inside the active Notes/Code browser.
  Each item moves through reading, uploading, done, or failed states. Active
  uploads show progress, duplicate names surface as a clear failure, and
  finished rows can be cleared without disturbing the file tree.
- small uploads still use the simple `POST /api/file/upload` JSON path. Larger
  uploads automatically switch to the chunked upload flow:
  `POST /api/file/upload/start`, repeated `POST /api/file/upload/chunk`,
  then `POST /api/file/upload/complete`. Failed chunked uploads are cancelled
  with `POST /api/file/upload/cancel` when possible.
- completed uploads refresh the current file tree and auto-open the uploaded
  item when it is visible in the current folder.
- the Code browser now includes a compact Code Agent panel backed by the
  Workspace Agent Engine. It can create an inspect task for the current Code
  folder, list recent code tasks, load task detail, show `taskMemory`, show the
  latest proposed/git diff artifact, approve/apply or deny an existing patch
  proposal, approve and immediately run approved checks, and run approved
  checks through the Workspace Server.
- approval and denial buttons for `approval.request` events
- normalized Codmes session menu titles instead of raw generated session ids
- zero-message Codmes sessions are hidden from the client session list
- the new chat `+` button clears the local chat view but does not create an Codmes session until the first message is sent
- macOS activation fix for `swift run Codmes`, so the launched window becomes the key app for keyboard input
- compact Notes/Code split view sizing for smaller macOS windows
- default macOS sidebar toggle only; the custom duplicate sidebar button was removed
- Xcode project with separate macOS and iOS app targets
- shared SwiftUI source between macOS and iOS
- iOS Simulator build support
- iOS device build support when the local Xcode signing team is configured
- physical iPhone app installation has been verified with a local Personal Team
- global chat side panel for Notes and Code. macOS shows a compact
  right-side split panel; iOS reveals the same compact chat surface by swiping
  left from the right edge, closer to the Obsidian plugin side-panel feel.
- iOS now uses a chat-first custom shell instead of `NavigationSplitView`.
  The main screen stays fixed, the left workspace menu opens as a drawer, and
  server connection settings live in a Settings sheet.
- compact iOS chat controls use short visible labels for access/model/reasoning
  so long provider model names do not expand vertically and fill the screen.
- the chat composer mirrors the earlier Obsidian plugin prototype layout more closely:
  new chat and history live in the chat header, while context/access/model/
  reasoning/send controls stay compact in the composer.
- tapping outside the chat input or scrolling the transcript dismisses the iOS
  keyboard.
- the iOS drawer hit target and spring thresholds were tuned so the left
  workspace menu opens more reliably from the edge and menu rows respond across
  the full row.
- on iOS, the invisible left-edge swipe target no longer covers the top bar
  sidebar button. When the drawer is open, a left swipe on the dimmed area
  outside the drawer also closes it.
- on iOS, Notes and Code use an Obsidian-style layout: the folder tree lives in
  the left drawer, and the main screen shows only the selected file preview or
  editor content.
- the iOS left drawer now uses a compact custom section dropdown above Settings
  instead of a full repeated menu list. The rest of the drawer is reserved for
  Notes/Code file navigation when one of those sections is selected.
- Notes and Code trees are quietly refreshed every few seconds while that
  section is visible. This keeps externally-created or externally-deleted server
  files in sync without requiring the user to reconnect or manually reload the
  whole workspace.
- the Apple client now uses a neutral app tint and neutral file/chat colors to
  avoid bright default blue controls in dark mode.
- connection diagnostics now call `/api/health` before loading workspace data
  and show the exact URL/error in the sidebar status area.
- the top connection pill uses a dedicated `isWorkspaceConnected` state instead
  of comparing the transient status text. This prevents successful connections
  from flickering to `Disconnected` when the app reports normal work statuses
  such as opening files or syncing sessions.
- macOS windows get a default app-sized frame and are clamped back inside the
  visible screen if a restored window opens too large or clipped.
- macOS windows explicitly keep the `.resizable` style mask and a small minimum
  size, so the window can be resized vertically as well as horizontally.

Not yet implemented:

- Repository-level Apple developer team signing is intentionally not fixed to a
  specific account. Configure the `Codmes iOS` target's Team in Xcode before
  installing on a physical iPhone/iPad.
- iPhone/iPad runtime UX pass after trusting the local developer profile on the
  device
- A full GoodNotes-class notebook engine is still planned. Current iOS/iPadOS
  PDF editing covers the first native annotation pass, export/import, and basic
  object controls; macOS has first-pass ink preview, pen input, stroke erasing,
  object select/move/resize/delete, and an inspector for text and frame edits.

## Client API Boundary

The app talks only to the Workspace Server:

```text
GET  /api/workspace
GET  /api/tree
GET  /api/file
POST /api/file/upload
POST /api/file/upload/start
POST /api/file/upload/chunk
POST /api/file/upload/complete
POST /api/file/upload/cancel
POST /api/search
GET  /api/agent/tasks
GET  /api/agent/tasks/:id
POST /api/agent/tasks/:id/resume
POST /api/agent/tasks/:id/cancel
GET  /api/agent/approvals
GET  /api/agent/approvals/:id
POST /api/agent/approvals/:id/respond
POST /api/agent/code-task
POST /api/agent/code-task/:id/patches
POST /api/agent/code-task/:id/patches/generate
POST /api/agent/code-task/:id/patches/:proposalId/apply
POST /api/agent/code-task/:id/patches/:proposalId/reject
POST /api/agent/code-task/:id/checks
POST /api/agent/code-task/:id/git
GET  /api/workspace/models
GET  /api/workspace/sessions
GET  /api/workspace/sessions/:id/messages
DELETE /api/workspace/sessions/:id
POST /api/workspace/sessions
WS   /api/live
```

It should not directly access filesystem paths or external dashboard cookies.

For approval-gated runtime work, the app should treat `approval_required` as a
normal task state. It can show the related approval from
`GET /api/agent/approvals`, call `POST /api/agent/approvals/:id/respond`, and
let the server resume or reject the stored pending state. The client should not
poll an MCP tool call directly or reconstruct the pending tool arguments.

## Code Agent Panel

The Code section has a first Workspace Agent surface. It is deliberately small:
the Apple app does not run shell commands or write files locally. It sends
requests to the Workspace Server, and the server-side `CodeAgentRuntime` owns
scope checks, approval requirements, patch application, command execution,
tool logs, task memory, and diff artifacts.

Current client flow:

```text
Code browser current folder
  -> Create code task
  -> GET recent code tasks
  -> Load task detail and taskMemory
  -> Show proposed patch diff when present
  -> Approve, Approve + Check, or deny existing patch proposal
  -> Run approved checks
```

This is not yet an automatic LLM-authored coding loop. The current client
surface exposes the server v1 primitives so later agent steps can plug into the
same task/diff/approval model instead of inventing a separate client-side flow.

## Live Chat Flow

The SwiftUI client connects only to Codmes Server. It opens:

```text
WS /api/live
```

on the Workspace Server. Runtime calls pass through the server-side
`WorkspaceAgentEngine`.

Chat can be used in two places:

```text
Chat tab
  -> full-page ChatHomeView

Notes / Code right-edge chat panel
  -> compact ChatHomeView
  -> macOS: right-side split panel
  -> iOS: right-edge swipe panel
```

On iOS, the app shell is intentionally chat-first. The left workspace menu is a
custom drawer opened from the top-left sidebar icon or by swiping from the left
edge. Server URL and connection diagnostics are managed from the Settings sheet,
not from the drawer itself.

When Notes or Code is selected on iOS, the drawer becomes the file navigator.
Opening a folder expands/navigates inside the drawer. Opening a file closes the
drawer and shows that file in the main content area. The main content area does
not repeat the Notes/Code header because the top app bar already names the
current section.

Choosing Notes or Code from the drawer's section dropdown does not close the
drawer by itself. This matches the intended mobile flow: first choose the
workspace section, then choose a concrete file. The drawer closes only when the
user opens a file, chooses Chat/Search, taps outside the drawer, or swipes it
closed.

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
  -> render runtime.event messages
  -> approval.respond when the user approves or denies a request
```

When the user chooses an existing session, the client first loads saved
messages from:

```text
GET /api/sessions/:id/messages
```

Then it resumes the live WebSocket session. This keeps the visible chat history
aligned with the selected session instead of showing only local system messages
such as "Live bridge ready".

The `+` button starts a local blank chat state only. Session creation is
deferred until the user sends the first message, which avoids empty orphan
sessions in history.

The session menu refreshes Codmes session metadata immediately before opening, and the
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
renderer follows the same broad approach as the Obsidian plugin and Codmes UI:
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

Reference desktop/web AI clients commonly use a web rendering stack with
Markdown components and Shiki/Streamdown-style dependencies. Terminal clients
use a separate terminal-specific renderer. These cannot be copied directly into
SwiftUI without a WebView bridge and bundled JavaScript resources. The target
architecture for high-quality rendering is:

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
closer rendering model to modern desktop AI clients. Shiki runs on the Workspace Server,
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
state. Saved Codmes reasoning/tool activity is also restored as an
activity row when loading session history.

Activity rows are not full chat bubbles. They are compact left-aligned progress
rows so the reasoning/tool stream reads like a process log between the user
message and the final assistant answer.

The chat composer follows the same compact control model used in the earlier
Obsidian plugin prototype:

```text
  History  Safe/Full  Model  Fast/Med/Deep  Send
```

`Safe` uses the Codmes approval policy, so mutating code tools and risky
MCP actions pause through the approval inbox. `Full` relaxes client-side
friction but does not bypass server-side hard safety blocks.

The reasoning menu maps to the prompt/runtime reasoning effort value:

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
the path, decides inline versus RAG/search metadata, and forwards compact
context into the Codmes runtime. This keeps filesystem and indexing policy centralized on the
server instead of duplicating it in each Apple client.

Codmes stores visible user messages separately from compact runtime
context. The Apple client should render only saved user/assistant messages from
`/api/sessions/:id/messages`; context, memory, and summaries belong to prompt
assembly on the server.

## Xcode Project

The app-development project is:

```text
client/apple/Codmes.xcodeproj
```

Targets:

```text
Codmes      macOS app target
Codmes iOS  iPhone/iPad app target
```

The targets share the files in:

```text
client/apple/Sources/Codmes
```

Platform-specific differences are handled with `#if os(macOS)` / `#if os(iOS)`.
For example:

- macOS uses `HSplitView`; iOS uses a stacked layout.
- macOS PDF preview uses `NSViewRepresentable` with PDFKit. iOS uses
  `UIViewRepresentable` with PDFKit, a live drawing overlay, and PDFKit ink
  annotations so ink follows the PDF page during scrolling and zooming.
- macOS applies `.windowStyle(.titleBar)` and activation handling; iOS does not.

Terminal support must be designed as a remote server feature, not as a
client-local shell. iOS/iPadOS cannot spawn a local development terminal, so the
cross-platform terminal panel should control terminal sessions running on the
Workspace Server:

```text
iOS/macOS terminal panel
  -> Workspace Server terminal API/WebSocket
  -> server-side shell/tool session
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
xcodebuild -project client/apple/Codmes.xcodeproj \
  -scheme Codmes \
  -configuration Debug \
  -destination 'platform=macOS' build

xcodebuild -project client/apple/Codmes.xcodeproj \
  -scheme 'Codmes iOS' \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build

xcodebuild -project client/apple/Codmes.xcodeproj \
  -scheme 'Codmes iOS' \
  -configuration Debug \
  -destination 'platform=iOS,id=<DEVICE_ID>' build
```

For command-line physical-device testing without committing a personal Team ID,
pass the Team ID at build time:

```bash
xcodebuild -project client/apple/Codmes.xcodeproj \
  -scheme 'Codmes iOS' \
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
