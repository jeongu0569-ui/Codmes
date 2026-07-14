# PDF Annotations

Codmes PDF annotation state is intentionally stored outside any one UI toolkit.
Apple clients currently render with PDFKit, but the saved workspace state must
remain usable by future Windows and Android/Galaxy Tab clients.

## State Location

For a PDF file:

```text
Notes/mypage.pdf
```

Codmes stores editable annotation state next to the document folder:

```text
Notes/.codmes/annotations/mypage.codmes.json
```

This keeps the PDF visible in normal file lists while letting a folder move or
copy carry its editable notes with it. The server also migrates older state
paths when it reads annotations.

API:

```text
GET /api/file/annotations?path=Notes/mypage.pdf
PUT /api/file/annotations?path=Notes/mypage.pdf
```

After a successful `PUT`, the server refreshes search indexing for that PDF
path.

## Ink Strokes

The shared ink format is `PDFAnnotationPage.inkStrokes`.

Each stroke stores:

- `id`: stable stroke id
- `tool`: current tool name, usually `pen`
- `color`: CSS-style color string such as `#111111`
- `width`: logical stroke width
- `opacity`: optional alpha
- `points`: normalized page points

Each point stores:

- `x`: normalized horizontal position from `0` to `1`
- `y`: normalized vertical position from `0` to `1`, measured from the top of
  the page
- `pressure`: optional pointer pressure
- `timeOffset`: optional timestamp relative to stroke start

`inkStrokes` is the canonical portable path. The model still contains
`inkDataBase64` for older Apple/PencilKit-era state, but new ink input should
write `inkStrokes`.

Current Apple input does not depend on an interactive `PKCanvasView` as the
primary drawing surface. The visible path is:

1. `UIPanGestureRecognizer` receives drawing input from the PDF view.
2. A lightweight live overlay draws the in-progress stroke.
3. Finished points are normalized into PDF page coordinates.
4. The stroke is added to the visible page as a PDFKit `.ink` annotation.
5. The stroke is persisted through `PUT /api/file/annotations`.

## Text And Image Objects

Text boxes and attached images use `PDFAnnotationObject`.

Important fields:

- `id`: stable object id
- `type`: `text` or `image`
- `pageIndex`: zero-based PDF page
- `bbox`: normalized page-relative rectangle
- `text`: searchable text for text objects
- `dataBase64`: embedded image payload for image objects
- `metadata`: optional font size, color, mime type, file name, or UI hints

`bbox` uses top-left normalized coordinates:

```json
{
  "x": 0.2,
  "y": 0.2,
  "width": 0.4,
  "height": 0.1
}
```

Text annotation objects are indexed as `annotation-text`. Image annotation
objects are indexed as `annotation-image-ocr` when they have existing OCR text
or the configured VLM OCR path can extract text from their `dataBase64` payload.

## Current Client Support

Current Apple support:

- iOS/iPadOS: PDFKit preview, read/write mode, pen, partial eraser, pen
  color/width options, eraser width options, text boxes, image objects,
  object selection/move/resize/delete, export/import, and PDF insertion.
- macOS: PDFKit preview, mouse/trackpad pen input, stroke erasing, text/image
  object selection, object move/resize, text editing, inspector controls, pen
  color support, colored ink preview, and Delete-key object removal.
- Text boxes are placed by selecting the text tool and tapping the target page
  location. Existing text/image objects can be selected and edited through the
  inspector.
- Stored `inkStrokes` are rendered as PDFKit `.ink` annotations so strokes made
  on one Apple platform remain visible on the other.

The current lasso-style handwritten stroke selection/move workflow is not a
supported primary path. Portable stroke editing should be built on top of
`inkStrokes`, not on PencilKit-only selection state.

## Read And Write Modes

Read mode:

- PDFKit owns scroll and zoom gestures.
- Annotation drawing gestures do not reserve touch input.

iPad write mode:

- If pen or eraser is selected, Apple Pencil draws or erases.
- Finger touch remains available for scrolling.
- PDF scrolling is locked during an active Pencil stroke so vertical writing
  does not scroll the page.

iPhone write mode:

- If pen or eraser is selected, one-finger touch draws or erases.
- PDF pan requires two fingers.
- Pinch zoom remains a two-finger gesture.
- PDF scrolling is locked during an active touch stroke so vertical writing does
  not scroll the page.

## Search And RAG Sync

The PDF file and `.codmes` annotation state are separate but synchronized by the
server:

1. The client opens the PDF as the raw file.
2. The client loads editable annotation JSON through `GET /api/file/annotations`.
3. Drawing or object edits update local state.
4. The client saves state with `PUT /api/file/annotations`.
5. The server writes `Notes/.codmes/annotations/*.codmes.json`.
6. The server refreshes the search index for the PDF path.

Search indexing combines extracted PDF text with annotation text/image OCR
blocks where available. Handwritten `inkStrokes` are stored and rendered, but
handwriting OCR over ink is not implemented yet.

## Still Planned

- Windows and Android/Galaxy Tab render/edit adapters.
- PDF standard annotation round-trip.
- More advanced layer, shape, sticker, and object-inspector controls.
- Handwriting OCR over `inkStrokes`.
- Stable selectable OCR overlays for scanned PDF pages.

## Windows And Android Adapter Contract

A future Windows or Android client should:

1. Load the PDF through the platform-native PDF viewer.
2. Load the matching `.codmes/annotations/*.codmes.json` file through the
   Codmes Server API.
3. Render each `inkStrokes` point list over the page using normalized page
   coordinates.
4. Render each `PDFAnnotationObject` using its normalized `bbox`.
5. Save edits back to the same JSON model, not to a platform-specific binary
   drawing format.
6. Keep expensive OCR/embedding work on the server side after the annotation
   JSON is saved.

This keeps GoodNotes-style editing portable without locking Codmes to PDFKit,
PencilKit, Windows Ink, or Android Canvas as the storage format.
