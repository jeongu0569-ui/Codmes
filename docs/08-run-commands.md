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
Team/Signing을 본인 Apple Developer 계정으로 설정해야 한다. 현재 레포
기본값은 Simulator 빌드 검증을 우선하기 위해 device signing을 고정하지 않는다.

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

## 7. 현재 원격 접속 주의점

현재 Workspace Server는 코드상 `127.0.0.1:8787`로 실행된다.

즉 현재 상태에서는 macOS 앱을 같은 Mac에서 실행하는 로컬 개발 흐름이 기준이다.
iPad, iPhone, 다른 Mac에서 Workspace Server에 직접 접속하려면 이후 작업에서
Workspace Server의 bind host를 `0.0.0.0` 또는 설정값으로 바꾸는 기능을 추가해야 한다.

Hermes serve 자체는 아래처럼 실행하면 외부 접속을 받을 수 있다.

```bash
hermes serve --host 0.0.0.0 --port 9119
```

하지만 Apple 앱이 붙는 대상은 Hermes가 아니라 Workspace Server다.
따라서 모바일/원격 클라이언트 지원은 Workspace Server의 외부 바인딩까지 구현한 뒤
테스트해야 한다.
