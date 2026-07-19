# Codmes

[![check](https://github.com/jeongu0569-ui/Codmes/actions/workflows/check.yml/badge.svg)](https://github.com/jeongu0569-ui/Codmes/actions/workflows/check.yml)

Codmes는 채팅, Notes/PDF, 문서 검색과 코드 작업을 하나의 서버 중심
Workspace에서 다루는 애플리케이션입니다. 서버가 파일, 검색 index, AI runtime과
상태를 소유하고 macOS, iPhone, iPad 앱은 같은 Workspace에 접속합니다.

현재 저장소는 실제 사용 가능한 MVP를 확장하는 단계입니다.

## 구조

```text
Mac, Linux server
`- Codmes Server
   |- Workspace files and document state
   |- Chat sessions and model runtime
   |- Search and document extraction
   |- Tools, approvals and memory
   `- Code tasks, patches and checks

macOS / iPhone / iPad
`- Codmes App
   |- Chat
   |- Notes
   `- Code
```

Apple 앱은 서버의 절대 경로를 직접 다루지 않고 HTTP와 WebSocket API를 통해
Workspace-relative 경로만 사용합니다.

## 현재 기능

### Chat

- Codmes-owned session 생성, 저장, 검색과 이어서 대화
- model, 접근 mode와 reasoning 수준 선택
- response, reasoning, tool event 실시간 streaming
- Markdown, 표, code block과 Shiki syntax highlighting
- 현재 file/folder/workspace context 선택
- 승인 요청 확인, 허용과 거절
- 대화 archive, folder, summary와 memory 검색

일반 Chat session은 최신 30개를 기본 목록에 유지하고 오래된 항목을 자동
보관합니다. project/folder에 속하거나 고정, 진행 중 작업, 승인 대기 상태인 session은
자동 보관에서 제외합니다.

### Notes와 PDF

- Obsidian 방식의 재귀 file tree와 여러 folder 동시 펼치기
- 펼침 상태 유지와 현재 file 강조
- context menu, `...` menu와 다중 선택
- file을 folder 또는 root drop target으로 drag하여 이동
- Markdown/text 읽기, 편집과 server 저장
- 여러 attachment upload와 진행 상태
- PDF 연속 page 읽기, pinch zoom과 page thumbnail sidebar
- 화면과 page 크기로 계산하는 초기/최소 읽기 배율
- pen, partial eraser, lasso, shape 자동 보정, text box와 image object
- annotation undo/redo와 PDF page 삽입
- 평탄화 PDF export
- PDF와 편집 가능한 annotation을 한 파일에 담는 `.codmespdf` export/import

PDF annotation은 Apple view 상태가 아니라 page-relative JSON으로 저장됩니다.
iOS와 macOS가 같은 형식을 사용하며 future Windows/Android adapter도 이 계약을
재사용할 수 있습니다.

### Search

- Notes, Documents, Code, 대화의 filename과 본문 검색
- PDF, image, DOC/DOCX, PPT/PPTX, HWP/HWPX, ODT/ODP, XLS/XLSX와 ZIP 추출
- PDF table의 Markdown 및 구조화 metadata 보존
- text가 부족한 PDF page와 image의 선택적 VLM OCR
- PDF text/image annotation 검색
- file watcher와 file API에 연결된 부분 index 갱신
- cursor 기반 100개 단위 로딩으로 전체 결과 탐색
- filename 일치와 document match 수에 따른 document 정렬
- document 내부 PDF 결과의 page/bbox 순 정렬과 thumbnail highlight

현재 검색은 `.codmes/index/search.json`의 text chunk index를 사용합니다.
embedding provider/model 설정은 저장되지만 vector 생성과 semantic reranking은
아직 구현되지 않았습니다. LLM은 `codmes_search` tool로 같은 검색 runtime을
사용합니다.

### Code

- `Code/` project의 재귀 file tree와 source 편집
- 여러 언어의 syntax highlighting
- file/folder 생성, rename, move, copy와 delete
- Code Agent task 생성, 취소와 재개
- patch 제안, 승인 적용과 거절
- 승인된 check와 제한된 Git command 실행
- task, diff, decision과 tool event 상태 저장

Code surface는 아직 완전한 IDE가 아니며 LSP, debugger, extension host와 server
terminal UI는 남은 작업입니다.

### Runtime

- OpenAI Codex OAuth와 OpenAI-compatible provider
- Ollama Local/Cloud와 custom endpoint
- model/provider/auth 설정 CLI와 Apple settings UI
- MCP server registry와 tool execution
- skill registry와 동적 tool discovery
- security policy, approval inbox와 audit log
- user/project/folder/session memory

## Workspace

서버를 처음 실행하면 설정한 root에 기본 folder와 `.codmes` 상태 root를 만듭니다.

```text
CodmesWorkspace/
|- Notes/
|- Code/
|- Documents/
|- Attachments/
`- .codmes/
   |- config/
   |- documents/
   |- index/
   |- sessions/
   |- tasks/
   |- approvals/
   |- memory/
   `- tool-logs/
```

문서별 상태는 한 folder에 모읍니다.

```text
.codmes/documents/<name>--<path-hash>/
|- manifest.json
|- annotations.json
`- index/
   |- extraction.json
   |- content.md
   `- annotation-ocr/
```

`annotations.json`은 사용자 상태이며 나머지 index/extraction 파일은 재생성 가능한
파생 상태입니다. 서버 API로 문서를 move/copy/delete하면 연결된 annotation과
index도 함께 이동, 복제 또는 제거됩니다.

## 빠른 시작

### 요구사항

- Node.js 22 이상
- npm
- document runtime bootstrap용 Python 3.11~3.13
- Apple 앱을 빌드할 경우 Xcode
- 사용할 AI provider 또는 local model server

```bash
git clone https://github.com/jeongu0569-ui/Codmes.git
cd Codmes
npm install
npm link
npm run runtime:bootstrap
```

`runtime:bootstrap`은 저장소의 `.codmes-runtime`에 Python 환경과 PDF/Office
추출 library를 설치합니다.

### 모델 설정

```bash
codmes model
codmes provider list
codmes model list
codmes auth list
codmes doctor --deep
```

Ollama Local을 빠르게 설정하려면 다음 명령을 사용할 수 있습니다.

```bash
codmes ollama
codmes ollama --model gemma4:e2b-mlx --serve
```

model, provider, credential과 search 설정은
`<Workspace>/.codmes/config`에 저장됩니다.

### 서버 실행

기본 주소는 `127.0.0.1:8787`, 기본 Workspace는 `~/CodmesWorkspace`입니다.

```bash
codmes serve
codmes serve --host 0.0.0.0 --port 8787 --root ~/CodmesWorkspace
```

환경 변수로 실행할 수도 있습니다.

```bash
CODMES_WORKSPACE_ROOT="$HOME/CodmesWorkspace" \
CODMES_HOST="0.0.0.0" \
CODMES_PORT="8787" \
CODMES_SERVER_TOKEN="충분히-긴-개인용-토큰" \
npm start
```

상태 확인:

```bash
codmes status
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/workspace
```

iPhone과 iPad는 Mac의 `127.0.0.1`에 접속할 수 없습니다. Mac의 LAN 또는
Tailscale 주소를 앱의 Server URL에 입력하고, 외부 interface로 열 때는
`CODMES_SERVER_TOKEN`을 설정하세요.

## Apple 앱 빌드

Xcode project:

```text
client/apple/Codmes.xcodeproj
```

macOS:

```bash
xcodebuild \
  -project client/apple/Codmes.xcodeproj \
  -scheme Codmes \
  -configuration Debug \
  -destination 'platform=macOS' \
  build CODE_SIGNING_ALLOWED=NO
```

iOS Simulator:

```bash
xcodebuild \
  -project client/apple/Codmes.xcodeproj \
  -scheme 'Codmes iOS' \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
```

실제 iPhone/iPad 설치에는 Xcode에서 Apple Development Team을 지정해야 합니다.
앱 settings에서 Server URL과 token을 입력하며 token은 Keychain에 저장됩니다.

## 자주 사용하는 명령

```bash
codmes serve
codmes status
codmes doctor --deep
codmes sessions list
codmes tasks list
codmes approvals list
codmes index status
codmes index rebuild
codmes index search "architecture" --scope Notes --limit 10
codmes code create Code/demo-app "인사말을 수정해줘"
```

전체 JavaScript 문법 검사와 server test:

```bash
npm run check
```

## 보안과 백업

- 외부 interface로 server를 열 때 `CODMES_SERVER_TOKEN`을 사용합니다.
- token이 설정되면 `/api/health`를 제외한 HTTP API가 Bearer 인증을 요구합니다.
- API key와 OAuth token이 있는 `.codmes/config`를 공개 저장소에 commit하지 않습니다.
- 원본 file, `annotations.json`, config, sessions, tasks, approvals와 memory를
  Workspace backup에 포함합니다.
- `search.json`, `extraction.json`, `content.md`와 OCR cache는 다시 만들 수 있습니다.

## 현재 한계

- vector store와 hybrid/semantic ranking은 구현되지 않았습니다.
- handwriting stroke OCR과 안정적인 OCR bbox overlay는 없습니다.
- Windows와 Android용 Notes/PDF editor는 없습니다.
- Code surface에는 LSP, debugger, extension host와 terminal UI가 없습니다.
- provider별 transport와 OAuth 지원 범위는 계속 확장 중입니다.

## 문서

- [문서 홈](docs/README.md)
- [제품 범위](docs/product.md)
- [로드맵](docs/roadmap.md)
- [Server](docs/server/README.md)
- [Client](docs/client/README.md)
- [Notes와 PDF](docs/notes/README.md)
- [Search](docs/search/README.md)
- [Code](docs/code/README.md)
- [UI/UX](docs/ui-ux/README.md)
- [실행과 검증](docs/runbook.md)
- [Debug](docs/debug/)
