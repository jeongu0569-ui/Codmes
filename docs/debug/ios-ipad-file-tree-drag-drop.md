# iPad 파일 트리에서 드래그해도 폴더로 이동하지 않는 문제

## 문제 요약

Notes 사이드바를 Obsidian처럼 여러 폴더를 동시에 펼칠 수 있는 트리 구조로
변경한 뒤, 파일을 길게 눌러 폴더로 옮기는 기능을 추가했다.

원하는 동작은 다음과 같았다.

1. `AI브리프_3월_260303.pdf` 행을 길게 누른다.
2. 파일 미리보기가 나타나면 손을 떼지 않고 `컴퓨터` 폴더 위로 끈다.
3. `컴퓨터` 행의 색과 테두리가 바뀌어 이동 가능한 위치임을 알려준다.
4. 손을 떼면 PDF가 `컴퓨터` 폴더 안으로 이동한다.

하지만 처음 구현에서는 파일 미리보기까지는 나타났지만, `컴퓨터` 행 위에
올려도 아무 색상 변화가 없었고 파일도 이동하지 않았다.

## 먼저 알아둘 개념

드래그 앤 드롭은 한 기능처럼 보이지만 실제로는 세 부분으로 나뉜다.

### 1. 드래그 출발점

어떤 화면 요소를 끌 수 있는지 정한다.

```swift
.draggable(FileTreeDragItem(path: item.path))
```

파일 미리보기가 나타났다는 것은 이 부분은 정상이라는 뜻이다.

### 2. 전달 데이터

드래그 중인 항목이 무엇인지 도착점에 알려주는 데이터다. Codmes에서는
파일의 워크스페이스 경로를 전달한다.

```text
Notes/AI브리프_3월_260303.pdf
```

### 3. 드롭 도착점

어디에 놓을 수 있는지 정하고, 파일이 그 영역에 들어왔을 때와 실제로
놓였을 때의 동작을 처리한다.

```swift
.dropDestination(for: FileTreeDragItem.self) { items, _ in
    // 파일 이동
} isTargeted: { isTargeted in
    // 폴더 행 강조 표시
}
```

출발점만 정상이어도 미리보기는 나타난다. 따라서 **미리보기가 보인다고
드롭까지 정상이라는 뜻은 아니다.** 이번 문제는 출발점이 아니라 도착점이
드래그 이벤트를 받지 못해서 발생했다.

## 왜 처음에 한 번에 해결되지 않았는가

이번 문제에는 서로 다른 문제가 겹쳐 있었다. 한 문제를 수정하면 다음
문제가 드러나는 형태였기 때문에 단계별로 원인을 분리해야 했다.

### 1단계: 요구사항을 버튼 이동으로 잘못 이해함

처음에는 메뉴에서 `Move to folder`를 누르고 목적지 경로를 입력하는
방식으로 구현했다. 이 방식도 파일 이동 기능이지만 사용자가 원한 것은
파일 행을 직접 길게 눌러 폴더 위에 놓는 방식이었다.

따라서 메뉴 기반 이동은 제거하고 파일 행에 `draggable`, 폴더 행에
`dropDestination`을 적용했다.

### 2단계: 하위 폴더 데이터가 앱에 없었음

기존 `/api/tree` API는 현재 폴더의 바로 아래 항목만 반환했다.

```text
Notes
└── 컴퓨터
```

이 응답만으로는 `컴퓨터/테스트`처럼 더 깊은 폴더를 한 화면의 트리로
그릴 수 없다. 화면에서 `테스트` 폴더가 보이지 않았던 이유도 이 문제였다.

서버에 `recursive=true` 옵션을 추가해 모든 하위 항목을 한 번에 읽도록
수정했다.

```http
GET /api/tree?root=notes&recursive=true
```

응답은 다음 경로를 모두 포함한다.

```text
Notes/컴퓨터
Notes/컴퓨터/테스트
Notes/컴퓨터/테스트/README.md
```

클라이언트는 이 목록을 부모 경로별로 묶어 트리로 표시한다. 폴더를
클릭할 때마다 다른 화면으로 이동하지 않으므로 여러 폴더를 동시에 펼칠
수 있다.

### 3단계: 수정 전 서버 프로세스가 계속 실행 중이었음

코드를 수정해도 이미 실행 중인 서버는 자동으로 새 코드가 되지 않는다.
오래 실행 중이던 서버가 `recursive=true`를 무시하고 있었기 때문에
클라이언트 코드를 고친 뒤에도 하위 폴더가 보이지 않았다.

이때는 소스만 다시 읽는 것이 아니라 실제 앱이 연결한 서버 응답을 직접
확인해야 한다.

```bash
curl 'http://127.0.0.1:8787/api/tree?root=notes&recursive=true'
```

서버를 최신 코드로 다시 시작한 뒤 `컴퓨터/테스트`가 응답과 iPad 트리에
모두 나타나는 것을 확인했다.

### 4단계: `List` 안의 폴더 행이 드롭 이벤트를 받지 못함

초기 트리는 SwiftUI `List` 안에 있었다. iPad의 `List`는 스크롤, 행 선택,
스와이프와 같은 제스처를 자체적으로 처리한다. 파일 행에서는 드래그가
시작됐지만, 폴더 행의 `dropDestination`까지 이벤트가 안정적으로 전달되지
않았다.

가장 중요한 단서는 다음 두 가지였다.

- 파일명 미리보기는 나타남: 드래그 출발점은 정상
- 폴더 행의 색이 전혀 바뀌지 않음: 드롭 도착점의 `isTargeted`가 실행되지 않음

따라서 서버 이동 코드보다 먼저 화면 컨테이너의 이벤트 전달 구조를
확인해야 했다. 트리 컨테이너를 `List`에서 `ScrollView + LazyVStack`으로
변경해 각 폴더 행이 직접 드롭 이벤트를 받도록 했다.

```swift
ScrollView {
    LazyVStack(spacing: 1) {
        ForEach(visibleTreeEntries) { entry in
            treeRow(entry)
        }
    }
}
```

### 5단계: 일반 문자열 대신 앱 전용 전달 타입이 필요했음

처음에는 파일 경로를 일반 `String`으로 전달했다.

```swift
.draggable(item.path)
.dropDestination(for: String.self) { ... }
```

문자열은 여러 앱과 여러 UI 요소가 공통으로 사용하는 매우 넓은 타입이다.
iPadOS가 이 문자열을 Codmes 내부 파일 이동 데이터인지, 일반 텍스트
드래그인지 구분하기 어렵다.

최종 구현에서는 Codmes 파일 이동에만 사용하는 전용 타입과 UTType을
만들었다.

```swift
private struct FileTreeDragItem: Codable, Transferable, Sendable {
    let paths: [String]

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .codmesWorkspaceItem)
    }
}

private extension UTType {
    static let codmesWorkspaceItem = UTType(
        exportedAs: "com.codmes.workspace-item"
    )
}
```

이제 출발점과 도착점이 정확히 같은 `FileTreeDragItem`만 주고받는다.

### 6단계: 컨텍스트 메뉴 충돌 가능성을 분리해서 확인함

기존 파일 행의 컨텍스트 메뉴도 길게 눌러서 연다. 파일 드래그 역시 길게
눌러서 시작하므로 처음에는 두 제스처의 충돌 가능성을 확인하기 위해 iOS
컨텍스트 메뉴를 잠시 제거했다.

하지만 컨텍스트 메뉴를 제거한 상태에서도 폴더 행이 강조되지 않았다.
따라서 실제 원인은 컨텍스트 메뉴가 아니라 `List`의 이벤트 전달과 일반
문자열 드래그 데이터에 있었다.

이 두 부분을 수정한 뒤 컨텍스트 메뉴를 다시 적용했다. iOS의 여러 파일 앱과
같이 길게 누르면 바로 옵션이 표시되는 표준 동작을 유지한다.

- 길게 누른 뒤 움직이지 않고 놓음: Copy/Rename/Delete 메뉴 표시
- 길게 누른 뒤 움직임: 파일 드래그 시작

```swift
treeRow(entry)
    .contextMenu { itemManagementMenu(entry.item) }
```

행 오른쪽의 `...` 메뉴도 같은 기능을 제공하므로 드래그와 메뉴 선택이
불편한 상황에서는 해당 버튼을 사용할 수 있다.

행 오른쪽의 `...` 메뉴도 같은 기능을 계속 제공한다. 따라서 길게 누르기가
익숙하지 않은 사용자도 파일 관리 기능을 사용할 수 있다.

## 최종 해결 방법

### 트리 전체 데이터를 한 번에 불러오기

[server/index.mjs](../../server/index.mjs)의 트리 API에 재귀 조회를 추가하고,
[WorkspaceAPI.swift](../../client/apple/Sources/Codmes/WorkspaceAPI.swift)에서
`recursive` 값을 전달한다.

[WorkspaceStore.swift](../../client/apple/Sources/Codmes/WorkspaceStore.swift)는
Notes와 Code의 루트 트리를 재귀 방식으로 불러온다. 폴더 선택 경로는 새
파일을 만들 위치로만 사용하고, 트리 목록 자체는 항상 전체 계층을 가진다.

### 드롭 이벤트를 직접 받는 트리 행 만들기

[FileSectionView.swift](../../client/apple/Sources/Codmes/FileSectionView.swift)의
파일 목록을 `ScrollView + LazyVStack`으로 변경했다. 각 파일 행에는
`draggable`, 각 폴더 행에는 `dropDestination`을 직접 적용했다.

```swift
.draggable(FileTreeDragItem(path: item.path))

.dropDestination(for: FileTreeDragItem.self) { items, _ in
    moveDraggedItem(items.first?.path, into: item)
} isTargeted: { isTargeted in
    dropTargetPath = isTargeted ? item.path : nil
}
```

### 드롭 가능한 폴더를 눈에 보이게 표시하기

`isTargeted`가 `true`가 되면 현재 폴더 경로를 `dropTargetPath`에 저장한다.
해당 행은 강조색 배경과 2pt 테두리를 표시한다.

```swift
if dropTargetPath == entry.item.path {
    RoundedRectangle(cornerRadius: 4)
        .stroke(Color.accentColor, lineWidth: 2)
}
```

이 시각적 변화는 꾸미기만을 위한 것이 아니다. 사용자는 놓기 전에 이동
가능한 위치인지 알 수 있고, 개발자는 드롭 이벤트가 폴더까지 도착했는지
즉시 확인할 수 있다.

루트 폴더에는 트리 행이 없기 때문에 처음에는 작은 집 아이콘만 드롭
대상이었다. 폴더 안의 파일을 루트로 다시 빼기가 어려워 상단 파일 도구
막대 전체를 루트 드롭 영역으로 확장했다. 막대 위에 올리면 전체 배경과
테두리, 집 아이콘이 강조된다. 단일 드래그와 다중 선택 드래그에서 모두
같은 방식으로 루트로 이동할 수 있다.

### 실제 파일 이동하기

드롭하면 `WorkspaceStore.moveTreeItem`이 다음 순서로 처리한다.

1. 전달받은 경로와 일치하는 파일을 전체 트리에서 찾는다.
2. 대상이 실제 폴더인지 확인한다.
3. 폴더를 자기 자신이나 자신의 하위 폴더로 옮기는 잘못된 이동을 막는다.
4. 목적지 경로를 만든다.
5. 서버의 `PATCH /api/file/move`를 호출한다.
6. 이동 후 전체 트리를 다시 불러온다.

예를 들면 다음 경로 변경이 서버로 전달된다.

```text
from: Notes/AI브리프_3월_260303.pdf
to:   Notes/컴퓨터/AI브리프_3월_260303.pdf
```

### 여러 항목을 한 번에 선택하고 이동하기

길게 누르거나 `...`를 열면 `Select Multiple`을 선택할 수 있다. 선택 모드에
들어가면 각 행 왼쪽에 체크 버튼이 나타나고 상단에는 선택 개수와 Copy,
Delete 버튼이 표시된다.

```text
2 selected                         Copy  Delete

✓ AI브리프_3월_260303.pdf
✓ workbook_sw.pdf
```

선택된 행 중 하나를 드래그하면 `FileTreeDragItem.paths`에 선택된 모든 경로를
담아 전달한다. 드래그 미리보기에도 `2 items`처럼 묶음 개수를 표시한다.

```swift
private struct FileTreeDragItem: Codable, Transferable, Sendable {
    let paths: [String]
}
```

Copy와 Delete도 선택 묶음 전체에 적용한다. Rename은 여러 항목의 새 이름을
한 번에 정할 수 없으므로 한 항목만 선택했을 때만 제공한다.

폴더와 그 폴더 안의 파일을 동시에 선택하면 실제 처리에서는 상위 폴더만
남긴다. 폴더를 이동하거나 삭제하면 내부 파일도 함께 처리되기 때문에 같은
파일을 두 번 요청하지 않기 위해서다. 같은 이름의 항목을 한 목적지에
옮기는 경우와 선택한 폴더 자신의 하위로 이동하는 경우도 요청 전에
차단한다.

## 서버 문제와 UI 문제를 구분한 방법

드래그가 실패했다고 해서 곧바로 파일 이동 API가 고장 났다고 판단하면
안 된다. UI를 거치지 않고 임시 파일로 서버 이동 API를 직접 호출했다.

1. 테스트 폴더와 테스트 파일을 만든다.
2. `PATCH /api/file/move`로 파일을 테스트 폴더 안으로 옮긴다.
3. 재귀 트리 API로 새 경로가 존재하는지 확인한다.
4. 테스트 데이터를 삭제한다.

이 검사는 성공했다. 따라서 파일 시스템과 서버 이동 로직은 정상이고,
남은 문제는 iPad UI가 드롭 이벤트를 받지 못하는 것이라고 범위를 좁힐
수 있었다.

이처럼 UI 문제를 디버깅할 때는 아래 계층을 따로 검사하는 것이 좋다.

```text
화면 제스처
    ↓
드래그 데이터 전달
    ↓
WorkspaceStore 상태 처리
    ↓
서버 API
    ↓
실제 파일 시스템
```

아래 계층부터 직접 확인하면 어느 지점에서 끊겼는지 빠르게 찾을 수 있다.

## 검증 결과

다음 내용을 확인했다.

- 재귀 트리 API에 `컴퓨터/테스트`가 포함된다.
- iPad 시뮬레이터에서 중첩 폴더가 트리로 표시된다.
- 서버 API를 직접 호출한 파일 이동이 정상 동작한다.
- `Select Multiple`에서 두 파일을 동시에 선택하면 선택 개수가 2로 바뀐다.
- 선택 모드에 Copy와 Delete 묶음 작업 버튼이 표시된다.
- 잘못된 자기 자신 및 하위 폴더 이동을 클라이언트에서 차단한다.
- iOS 시뮬레이터 빌드가 성공한다.
- macOS 빌드가 성공한다.
- 서버 및 공통 테스트 149개가 모두 통과한다.

iPad의 실제 “길게 누른 뒤 손을 유지하며 끌기”는 일반 마우스 드래그 자동화와
동작 방식이 다르다. 자동화 도구만으로 최종 손가락 제스처를 완전히 재현하기
어려우므로 실제 iPad에서도 마지막 확인이 필요하다.

## 비슷한 문제를 디버깅할 때 확인할 것

### 미리보기 자체가 나타나지 않는 경우

- 파일 행에 `draggable`이 적용됐는지 확인한다.
- 버튼이나 컨텍스트 메뉴의 길게 누르기 제스처와 충돌하지 않는지 확인한다.
- 드래그 미리보기 뷰가 정상적으로 만들어지는지 확인한다.

### 미리보기는 나타나지만 폴더가 강조되지 않는 경우

- 폴더 행에 `dropDestination`이 직접 적용됐는지 확인한다.
- 출발점과 도착점의 `Transferable` 타입이 같은지 확인한다.
- `List`, 스크롤, 컨텍스트 메뉴가 드롭 이벤트를 먼저 처리하지 않는지
  확인한다.
- `isTargeted`에서 상태를 바꿨을 때 화면에 눈에 띄는 표시가 있는지
  확인한다.

### 폴더는 강조되지만 파일이 이동하지 않는 경우

- 드롭 콜백으로 전달된 파일 경로를 확인한다.
- 목적지 경로가 루트 기준으로 올바르게 만들어졌는지 확인한다.
- 서버 `PATCH /api/file/move` 응답과 오류 메시지를 확인한다.
- 이동 후 트리를 다시 불러오는지 확인한다.

### 코드 수정 후에도 화면이 그대로인 경우

- 앱이 최신 빌드로 설치됐는지 확인한다.
- 앱이 연결 중인 서버 주소와 포트를 확인한다.
- 이전 서버 프로세스가 남아 있지 않은지 확인한다.
- 실제 API 응답을 `curl`로 확인한다.

이번 문제에서 가장 중요한 교훈은 **사용자에게 보이는 한 가지 실패가 항상
한 가지 원인으로 생기지는 않는다**는 점이다. 데이터 조회, 실행 중인 서버,
SwiftUI 제스처 전달, 드래그 데이터 타입을 하나씩 분리해 확인해야 정확한
원인을 찾을 수 있다.
