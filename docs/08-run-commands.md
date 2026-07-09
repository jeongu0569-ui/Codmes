# 실행 명령어

이 문서는 현재 MVP를 로컬 Mac에서 실행하는 순서를 정리한다.

현재 구조는 세 단계다.

```text
Hermes serve
  -> Workspace Server
  -> Apple SwiftUI app
```

## 0. 위치

레포지토리 위치:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
```

Apple 앱 위치:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
```

## 1. Hermes 서버 실행

터미널 1에서 Hermes dashboard/API 서버를 먼저 실행한다.

```bash
hermes serve --host 0.0.0.0 --port 9119
```

정상 실행 예시:

```text
HERMES_DASHBOARD_READY port=9119
Hermes Web UI -> http://0.0.0.0:9119
```

로컬 Mac에서만 테스트할 때 Workspace Server는 다음 주소로 Hermes에 붙는다.

```text
http://127.0.0.1:9119
```

같은 네트워크나 Tailscale에서 Hermes 자체 접속을 확인하려면 Mac의 IP 또는
Tailscale IP를 사용한다.

```text
http://<Mac-IP>:9119
http://<Tailscale-IP>:9119
```

## 2. Workspace Server 실행

터미널 2에서 Workspace Server를 실행한다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes

export HERMES_WORKSPACE_ROOT="$HOME/HermesWorkspace"
export HERMES_SERVER_URL="http://127.0.0.1:9119"
export HERMES_DASHBOARD_USERNAME="admin"
export HERMES_DASHBOARD_PASSWORD="admin"

npm start
```

정상 실행 예시:

```text
[workspace] listening on http://127.0.0.1:8787
[workspace] root /Users/user/HermesWorkspace
[workspace] hermes http://127.0.0.1:9119
```

기본 bind host는 보안을 위해 `127.0.0.1`이다. iPhone/iPad 또는 Tailscale
테스트처럼 다른 기기에서 Workspace Server에 붙어야 할 때만 아래처럼 연다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes

WORKSPACE_HOST=0.0.0.0 \
PORT=8787 \
HERMES_WORKSPACE_ROOT="$HOME/HermesWorkspace" \
HERMES_SERVER_URL="http://127.0.0.1:9119" \
HERMES_DASHBOARD_USERNAME="admin" \
HERMES_DASHBOARD_PASSWORD="admin" \
npm start
```

이 경우 로그는 실제 bind host와 port를 출력한다.

```text
[workspace] listening on http://0.0.0.0:8787
```

서버 상태 확인:

```bash
curl http://127.0.0.1:8787/api/health
```

정상 응답:

```json
{
  "ok": true,
  "service": "ai-workspace-on-hermes"
}
```

Workspace 정보 확인:

```bash
curl http://127.0.0.1:8787/api/workspace
```

Hermes 세션 목록 확인:

```bash
curl http://127.0.0.1:8787/api/hermes/sessions
```

Hermes 모델 목록 확인:

```bash
curl http://127.0.0.1:8787/api/hermes/models
```

Code Agent Runtime inspect task 확인:

```bash
curl -X POST http://127.0.0.1:8787/api/agent/code-task \
  -H 'content-type: application/json' \
  --data '{
    "scopePath": "Code/my-app",
    "instruction": "이 프로젝트 구조를 보고 수정 계획을 만들어줘",
    "maxFiles": 120
  }'
```

이 API는 파일을 수정하지 않는다. 대신 `Code/` 아래 프로젝트를 읽고, 관련 파일
검색, git status/diff 수집, 추천 테스트 명령 탐지, 초기 plan 생성을 수행한 뒤
`.ai-workspace/tasks`, `.ai-workspace/tool-logs`, `.ai-workspace/decisions`,
`.ai-workspace/diffs`에 작업 기록을 남긴다.

응답의 `taskId`를 사용하면 승인 기반 patch/check 흐름을 이어갈 수 있다.

Patch 제안:

```bash
TASK_ID="task-..."

curl -X POST "http://127.0.0.1:8787/api/agent/code-task/$TASK_ID/patches" \
  -H 'content-type: application/json' \
  --data '{
    "changes": [
      {
        "path": "src/index.js",
        "find": "return '\''hello'\'';",
        "replace": "return '\''hello workspace'\'';"
      }
    ]
  }'
```

이 단계에서는 실제 파일이 바뀌지 않는다. `.ai-workspace/diffs` 아래에 제안 diff가
저장되고, task JSON에는 `patchProposals[]`가 추가된다.

Patch 적용:

```bash
PROPOSAL_ID="patch-..."

curl -X POST "http://127.0.0.1:8787/api/agent/code-task/$TASK_ID/patches/$PROPOSAL_ID/apply" \
  -H 'content-type: application/json' \
  --data '{
    "approved": true
  }'
```

`approved: true`가 없으면 서버는 `428`로 거절하고 파일을 수정하지 않는다. 적용
시점에 대상 파일 내용이 제안 당시의 hash와 다르면 충돌로 처리한다.

Check 실행:

```bash
curl -X POST "http://127.0.0.1:8787/api/agent/code-task/$TASK_ID/checks" \
  -H 'content-type: application/json' \
  --data '{
    "approved": true
  }'
```

명령 실행도 `approved: true`가 필요하다. `commands`를 생략하면 inspect 단계에서
탐지한 `inspection.suggestedCheckCommands`를 사용한다.

작은 파일 업로드 확인:

```bash
node - <<'NODE'
const body = {
  path: "Notes/upload-smoke.txt",
  dataBase64: Buffer.from("hello upload\n").toString("base64")
};
const res = await fetch("http://127.0.0.1:8787/api/file/upload", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});
console.log(res.status, await res.text());
NODE
```

큰 파일 업로드는 앱에서 자동으로 chunked upload를 사용한다. 서버 API 흐름은
다음과 같다.

```text
POST /api/file/upload/start
POST /api/file/upload/chunk
POST /api/file/upload/chunk
...
POST /api/file/upload/complete
```

중간 실패나 취소가 발생하면 가능한 경우 임시 업로드 파일을 정리한다.

```text
POST /api/file/upload/cancel
```

중복 파일명은 `409 Conflict`로 응답한다. 앱은 이 값을 업로드 상태 카드에서
`Failed`로 표시한다.

## 3. Apple macOS 앱 실행

실제 앱 개발은 Xcode 프로젝트를 기준으로 진행한다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
open AIWorkspace.xcodeproj
```

Xcode에서 `AIWorkspace` scheme을 선택하고 My Mac 대상으로 실행한다.

터미널에서 빌드만 검증하려면:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme AIWorkspace \
  -configuration Debug \
  -destination 'platform=macOS' build
```

기존 Swift Package shell도 회귀 테스트용으로 남겨두었다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
swift run AIWorkspace
```

앱이 열리면 좌하단 Workspace Server 주소가 다음 값인지 확인한다.

```text
http://127.0.0.1:8787
```

그 다음 순서:

1. Chat 탭에서 모델, 추론 모드, Safe/Full 권한 모드를 선택한다.
2. 기존 세션이 필요하면 세션 드롭다운을 연다. 드롭다운을 열 때마다
   Hermes 세션 목록이 다시 동기화된다.
3. 새 대화를 시작하려면 `+` 버튼을 누른다. 이때는 로컬 채팅창만 비워지고,
   실제 Hermes 세션은 첫 메시지를 보낼 때 생성된다.
4. 메시지를 입력하고 전송 아이콘을 누른다.
5. Notes/Code에서 파일을 서버 폴더로 가져오려면 paperclip 버튼을 누른다.
   작은 파일은 단일 업로드로, 큰 파일은 chunked upload로 자동 전환된다.
   진행 상태는 파일 브라우저 상단의 Uploads 카드에서 확인한다.

채팅 입력창 하단 컨트롤은 현재 다음 구조다.

```text
+  History  Safe/Full  Model  Fast/Med/Deep  Send
```

`Safe`는 Hermes의 위험 작업 승인 게이트를 사용하는 모드이고, `Full`은
Hermes가 지원하는 범위에서 추가 승인 없이 진행하는 모드다. 내부적으로는
Hermes live RPC의 `config.set key=yolo`를 사용한다.

추론 모드는 다음처럼 Hermes reasoning 설정으로 전달된다.

```text
Fast -> low
Med  -> medium
Deep -> high
```

## 4. iPhone/iPad 앱 빌드

Xcode 프로젝트에는 iOS target도 들어있다.

```text
Scheme: AIWorkspace iOS
Target: AIWorkspace iOS
```

iOS Simulator 빌드 검증:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build
```

실제 iPhone/iPad에 설치하려면 Xcode에서 `AIWorkspace iOS` target의
Team/Signing을 본인 Apple Developer 계정으로 설정해야 한다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
xcrun xctrace list devices

xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -configuration Debug \
  -destination 'platform=iOS,id=<DEVICE_ID>' build
```

레포는 특정 Apple Team ID를 고정하지 않는다. 그래서 새 Mac에서는 Xcode에서
`Signing & Capabilities`의 Team을 먼저 선택해야 실제 기기 설치가 된다. Team
또는 Apple Development 인증서가 없으면 빌드는 되더라도 설치 단계에서
`No code signature found` 또는 signing 오류가 난다.

Xcode UI에서 Team을 고정하지 않고 터미널에서만 테스트하려면 로컬 Team ID를
명령어로 넘길 수 있다.

```bash
xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -configuration Debug \
  -destination 'platform=iOS,id=<DEVICE_ID>' \
  DEVELOPMENT_TEAM=<TEAM_ID> \
  -allowProvisioningUpdates build

xcrun devicectl device install app \
  --device <DEVICE_ID> \
  "$HOME/Library/Developer/Xcode/DerivedData/AIWorkspace-eszydbckepibgkbdkzydbcbcxtzz/Build/Products/Debug-iphoneos/AI Workspace iOS.app"
```

처음 설치한 개인 개발자 앱은 iPhone에서 바로 실행이 거부될 수 있다. 이 경우
iPhone에서 `설정 > 일반 > VPN 및 기기 관리`로 이동해 Apple Development
프로파일을 신뢰한 다음 다시 실행한다.

iPhone에서 앱 화면이 정사각형 호환 모드처럼 보이면 iOS target의 Launch Screen
설정이 빠진 상태일 가능성이 높다. 현재 앱은 `App/iOS-Info.plist`에
`UILaunchScreen`과 iPhone/iPad 방향 지원 값을 포함해 전체 화면 앱으로 실행되게
설정되어 있다.

iPhone/iPad 앱에서 Workspace Server URL에는 Mac의 주소를 넣어야 한다.
`http://127.0.0.1:8787`은 iPhone/iPad 자기 자신을 가리키므로 Mac 서버에
연결되지 않는다. Tailscale을 쓰는 경우 예시는 다음과 같다.

```text
http://100.x.x.x:8787
```

같은 LAN에서 테스트할 때는 Mac의 LAN IP를 사용할 수 있다.

```bash
ipconfig getifaddr en0
```

그리고 앱에는 다음처럼 입력한다.

```text
http://<MAC_LAN_IP>:8787
```

연결이 안 될 때는 Mac에서 먼저 서버와 Tailscale 주소가 실제 응답하는지 확인한다.

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
curl http://127.0.0.1:8787/api/health
curl http://100.x.x.x:8787/api/health
```

세 명령이 모두 정상인데 iPhone 앱만 실패하면 앱의 `Workspace Server` 입력값을
다시 확인한다. 앱은 연결 시 `/api/health`를 먼저 호출하고, 실패한 URL과 오류를
상태 영역에 표시한다. `100.x.x.x:8787`처럼 스킴 없이 입력해도 Connect 시점에
`http://`를 붙여 저장한다.

iOS에서 `URLError.-1022`와 함께 App Transport Security 오류가 나오면 앱의
`App/iOS-Info.plist`에 HTTP 개발 연결 허용 설정이 실제 번들에 들어갔는지
확인한다. 현재 개발 빌드는 `NSAllowsArbitraryLoads=true`만 사용한다. 이 값과
세부 예외 키를 섞으면 iOS에서 전체 HTTP 허용이 기대대로 적용되지 않을 수 있다.

iOS 기본 화면은 Hermes Chat이다. 왼쪽 메뉴는 화면을 밀어내는 시스템 split view가
아니라, 왼쪽 위 사이드바 아이콘 또는 왼쪽 가장자리 스와이프로 여는 drawer다.
서버 주소는 drawer 안이 아니라 오른쪽 위 Settings에서 입력한다.

iOS에서 Notes/Code/Search를 보고 있을 때 전역 채팅은 별도 버튼이 아니라 오른쪽
화면 가장자리에서 왼쪽으로 스와이프해 연다. 닫을 때는 패널을 오른쪽으로 밀거나
어두워진 본문 영역을 탭한다.

## 5. 백그라운드로 Workspace Server 실행

매번 터미널을 열어두기 싫으면 Workspace Server를 백그라운드로 실행할 수 있다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes

HERMES_SERVER_URL="http://127.0.0.1:9119" \
HERMES_WORKSPACE_ROOT="$HOME/HermesWorkspace" \
HERMES_DASHBOARD_USERNAME="admin" \
HERMES_DASHBOARD_PASSWORD="admin" \
node server/index.mjs > /tmp/ai-workspace-on-hermes.log 2>&1 &

echo $! > /tmp/ai-workspace-on-hermes.pid
```

상태 확인:

```bash
curl http://127.0.0.1:8787/api/health
```

로그 확인:

```bash
tail -f /tmp/ai-workspace-on-hermes.log
```

종료:

```bash
kill "$(cat /tmp/ai-workspace-on-hermes.pid)"
```

## 6. 개발 검증 명령어

서버 테스트:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
npm run check
```

Apple macOS 앱 Xcode 빌드:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme AIWorkspace \
  -configuration Debug \
  -destination 'platform=macOS' build
```

Apple iOS 앱 Simulator 빌드:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
xcodebuild -project client/apple/AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build
```

Swift Package 회귀 빌드:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
swift build
```

Apple 앱 실행:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
swift run AIWorkspace
```

## 7. 원격 접속 주의점

Apple 앱이 직접 붙는 대상은 Hermes가 아니라 Workspace Server다.
따라서 iPhone/iPad에서 쓰려면 두 서버의 역할을 구분해야 한다.

Hermes serve는 Workspace Server가 붙는 백엔드다. 보통 같은 Mac 안에서만
Workspace Server가 Hermes에 접근하므로 `HERMES_SERVER_URL`은 아래처럼 로컬
주소를 유지해도 된다.

```bash
hermes serve --host 0.0.0.0 --port 9119
```

```bash
HERMES_SERVER_URL="http://127.0.0.1:9119"
```

반대로 iPhone/iPad 앱은 Workspace Server에 접속해야 한다. 그래서 모바일 테스트
때는 Workspace Server를 외부 바인딩으로 열어야 한다.

```bash
WORKSPACE_HOST=0.0.0.0 \
PORT=8787 \
HERMES_WORKSPACE_ROOT="$HOME/HermesWorkspace" \
HERMES_SERVER_URL="http://127.0.0.1:9119" \
HERMES_DASHBOARD_USERNAME="admin" \
HERMES_DASHBOARD_PASSWORD="admin" \
npm start
```

그 다음 iPhone/iPad 앱의 Settings에는 Mac의 Tailscale 주소나 LAN 주소를 넣는다.

```text
http://100.x.x.x:8787
http://<MAC_LAN_IP>:8787
```

연결 상태가 실제로 정상인지 확인할 때는 Mac에서 먼저 아래 명령을 확인한다.

```bash
curl http://127.0.0.1:8787/api/health
curl http://100.x.x.x:8787/api/health
```

첫 번째만 성공하고 두 번째가 실패하면 Workspace Server가 `127.0.0.1`에만
묶여 있거나, Tailscale/LAN 방화벽 경로가 막힌 것이다.

앱 상단의 Connected/Disconnected 표시는 전용 연결 상태값을 기준으로 한다.
파일 열기, 세션 동기화, 모델 목록 불러오기 같은 일시 작업 메시지가 바뀌어도
연결이 살아 있으면 Connected로 유지된다.

## 8. Notes/Code 파일 관리

Notes와 Code는 서버의 workspace root 아래 폴더를 조작한다.

```text
Notes -> <workspace root>/Notes
Code  -> <workspace root>/Code
```

지원되는 작업:

- 새 파일 만들기
- 새 폴더 만들기
- 기존 로컬 파일 첨부
- 이름 바꾸기
- 삭제
- 다른 폴더로 이동
- 다른 폴더로 복사

macOS에서는 Notes/Code 화면의 왼쪽 파일 브라우저에서 파일과 폴더를 관리한다.
iOS에서는 왼쪽 사이드 drawer가 파일 브라우저 역할을 한다. Notes 또는 Code를
선택한 뒤 왼쪽 drawer를 열면 폴더 트리가 보이고, 파일을 누르면 drawer가 닫히며
메인 화면에는 파일 내용만 크게 표시된다.

파일 브라우저 상단 아이콘:

```text
문서+  -> 새 파일
폴더+  -> 새 폴더
클립   -> 기존 파일 첨부
위쪽   -> 상위 폴더
집     -> Notes/Code 루트
```

각 파일/폴더 행 오른쪽의 `...` 메뉴에서 이동, 복사, 이름 변경, 삭제를 실행한다.
macOS에서는 우클릭 context menu도 동일하게 동작하고, iOS에서는 행을 길게 눌러도
같은 메뉴를 열 수 있다.

iOS 왼쪽 drawer 상단에는 현재 섹션을 고르는 커스텀 드롭다운이 있다. Notes 또는
Code를 선택해도 drawer가 바로 닫히지 않는다. 먼저 섹션을 고르고, 그 안에서 실제
파일을 선택했을 때 drawer가 닫히며 메인 화면에 파일 내용이 표시된다.

첨부 기능은 `POST /api/file/upload`를 사용한다. 앱이 사용자가 고른 파일을 읽어
Workspace Server로 보내고, 서버가 현재 Notes/Code 폴더 아래에 같은 파일명으로
저장한다. 같은 이름의 파일이 이미 있으면 서버가 덮어쓰지 않고 오류를 반환한다.

앱 안에서 파일을 만들거나 삭제하면 작업 직후 현재 폴더 트리를 다시 읽기 때문에
바로 반영된다. 서버 컴퓨터에서 Finder, 터미널, 다른 앱으로 파일을 직접 만들거나
삭제한 경우에는 앱이 현재 보고 있는 Notes/Code 폴더를 몇 초마다 조용히 다시
읽어서 반영한다. 서버의 `/api/tree`는 파일시스템을 매 요청마다 읽으므로 별도
서버 캐시 때문에 늦어지는 구조는 아니다.
