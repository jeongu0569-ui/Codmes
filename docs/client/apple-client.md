# Apple 클라이언트

## 대상과 구조

하나의 Xcode 프로젝트가 macOS와 iOS/iPadOS target을 제공한다.

```text
client/apple/Codmes.xcodeproj
client/apple/Sources/Codmes/
```

공통 SwiftUI 화면과 모델을 공유하고, PDF 입력 계층은 조건부 컴파일로 나뉜다.

- iOS/iPadOS: `UIViewRepresentable`, `PDFView`, UIKit gesture
- macOS: `NSViewRepresentable`, `PDFView`, AppKit event

## 주요 화면

- `RootView`: Chat, Notes, Code surface와 사이드바
- `FileSectionView`: 재귀 파일 트리, 다중 선택, 메뉴, drag and drop
- `SearchView`: 전역 검색과 문서별 PDF 결과
- `PDFWorkspaceView`: PDF 열람, 페이지 thumbnail, 필기와 object 편집
- `WorkspaceStore`: 앱 상태와 API orchestration
- `WorkspaceAPI`: HTTP 요청
- `LiveChatClient`: WebSocket stream

## 파일 탐색

Notes와 Code는 한 위치로 들어가는 탐색 방식이 아니라 재귀 트리를 사용한다.
여러 폴더를 동시에 펼칠 수 있고 펼침 상태를 앱 저장소에 보존한다. 파일은 길게
눌러 선택하거나 여러 항목을 선택할 수 있으며, 폴더 행에 drag and drop하여
이동한다. 폴더 바깥으로 이동할 때는 상위/root drop target을 사용한다.

## PDF 읽기

- 세로 연속 한 페이지 모드
- 화면과 PDF page 크기로 계산한 초기/최소 읽기 배율
- 첫 페이지는 다음 페이지 일부, 중간 페이지는 위아래 페이지 일부 노출
- 최소 읽기 배율보다 축소한 뒤 놓으면 반동 없이 자연스럽게 원래 배율로 복귀
- 회전 또는 viewport 변경 시 배율 재계산
- toolbar 아래에서 열리는 왼쪽 page thumbnail sidebar
- thumbnail 선택 시 해당 페이지 중앙 정렬

세부 사항은 [iOS PDF](../notes/ios/pdf-reader.md)와
[macOS PDF](../notes/macos/pdf-reader.md)를 참고한다.

## 빌드

명령과 workspace server 실행 방법은
[runbook.md](../runbook.md)에 정리한다.
