# Codmes

[![check](https://github.com/jeongu0569-ui/Codmes/actions/workflows/check.yml/badge.svg)](https://github.com/jeongu0569-ui/Codmes/actions/workflows/check.yml)

Codmes는 Chat, Notes/PDF, 문서 검색과 Code 작업을 하나의 server 중심 Workspace에서
다루는 애플리케이션입니다. server가 file, search index, AI runtime과 상태를
소유하고 macOS, iPhone, iPad 앱은 같은 Workspace에 접속합니다.

현재 공식 앱은 macOS와 iPhone·iPad를 지원합니다.

화면과 데이터 처리처럼 공통으로 사용할 수 있는 부분은 SwiftUI로 함께 만들고,
mouse·keyboard가 필요한 macOS 기능은 AppKit으로, touch·Apple Pencil이 필요한
iPhone·iPad 기능은 UIKit으로 따로 구현합니다. Notes와 PDF의 annotation data는
특정 앱에만 묶이지 않도록 만들어, 나중에 Windows나 Android 앱에서도 그대로
사용할 수 있게 합니다.

현재 저장소는 실제 사용 가능한 MVP를 확장하는 단계입니다.

## 주요 기능

- [Chat](docs/features/chat.md): session, model, live streaming, context와 tool approval
- [Notes와 PDF](docs/features/notes.md): file tree, PDF 읽기와 annotation, 대용량 streaming
- [Search](docs/features/search.md): file과 본문 검색, 문서 추출, PDF page 결과
- [Code](docs/features/code.md): source 편집, code agent task, patch와 check
- [Runtime과 Server](docs/server/architecture.md): provider, model, tool과 Workspace API

Apple 앱은 server의 절대 경로를 직접 다루지 않고 HTTP와 WebSocket API를 통해
Workspace-relative path만 사용합니다. 아직 구현되지 않은 범위는
[roadmap](docs/roadmap.md)을 참고하세요.

## 빠른 시작

### 요구사항

- Node.js 22 이상
- npm
- document runtime bootstrap용 Python 3.11~3.13
- Apple 앱을 build할 경우 Xcode
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

### Model 설정

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

### Server 실행

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
CODMES_SERVER_TOKEN="충분히-긴-개인용-token" \
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

## Apple 앱 build

Xcode project는 `client/apple/Codmes.xcodeproj`입니다.

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

전체 JavaScript 문법 검사와 server test:

```bash
npm run check
```

## 문서

- [Server architecture](docs/server/architecture.md)
- [Server API](docs/server/api-contract.md)
- [Server data model](docs/server/data-model.md)
- [Apple client](docs/client/apple.md)
- [UI/UX 원칙](docs/client/ui-ux.md)
- [Debug 기록](docs/debug/)
