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
  from the Obsidian/Hermes approach: headings, bullets, fenced code blocks, and
  Markdown tables are rendered as distinct UI blocks instead of one flat line
- the same Markdown/code renderer is now used by Notes and Code file previews,
  so chat answers, markdown notes, and source files share one rendering surface
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

Not yet implemented:

- Apple developer team signing for real iPhone/iPad device installation
- iPhone/iPad runtime UX pass on physical devices

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
renderer follows the same broad approach as the Obsidian plugin and Hermes TUI:
split the text into blocks first, then render headings, bullets, fenced code
blocks, and table rows with dedicated views. Inline emphasis/code is still
handled through Swift `AttributedString(markdown:)` inside each text cell.

Fenced code blocks preserve the language tag from Markdown fences such as
```` ```python ```` and render a compact `Code · python` header. The code body
uses a lightweight local highlighter for comments, strings, numbers, literals,
and language-specific keyword sets. The current built-in profiles cover Python,
C/C++, Java/Kotlin, JavaScript/TypeScript, Swift, Rust, Go, shell, SQL, JSON,
YAML, and a generic fallback. The code card also includes an inline copy button,
mirroring the Hermes Desktop code-card pattern. Markdown tables render in a
bordered, horizontally scrollable table view with styled header cells.

Hermes Desktop uses React Streamdown plus Shiki for full syntax highlighting.
The Apple app does not yet embed Shiki or Tree-sitter. The renderer is structured
so a future `CodeEditSourceEditor`, Tree-sitter, or Swift syntax-highlighting
package can replace the built-in highlighter without changing chat, Notes, and
Code preview call sites.

Notes and Code previews use the same rendering layer:

```text
Markdown file -> RichMarkdownView
Code file     -> CodeBlockView(language from extension)
Other text    -> plain monospaced text
```

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
```

The old package check is still useful for quick compile feedback:

```bash
cd client/apple
swift build
```
