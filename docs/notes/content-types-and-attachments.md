# Notes Content Types And Attachments

This document only covers how content appears inside the Notes surface. The
workspace-wide indexing, extraction, OCR, and RAG design lives under
`docs/search`.

## Workspace Roots

Notes commonly works with:

```text
Codmes/
├── Notes/
├── Attachments/
└── .codmes/
```

Hidden Codmes state stays in `.codmes` folders. For PDF annotation state, the
hidden state is placed next to the document folder so copying or moving a folder
can carry editable PDF notes with it.

## Notes Surface Content

| Content | Typical location | Notes surface behavior |
| --- | --- | --- |
| Markdown: `.md`, `.markdown`, `.mdx` | `Notes/` | Read as text, rendered as Markdown, editable through the file API, and readable by Notes chat through `read_note_file`. |
| Plain text notes | `Notes/` | Read and edited as UTF-8 text when safe. |
| PDF: `.pdf` | `Notes/` or attached from `Attachments/` | Opened through raw file serving and PDFKit. Editable annotation state is stored in a hidden `.codmes/annotations` file beside the PDF folder. |
| PDF annotation state: `.codmes/annotations/*.codmes.json` | Hidden beside the PDF folder | Stores editable ink, text objects, and image objects. It is app state, not a user note to show in normal trees. |
| Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tif`, `.tiff`, `.heic` | `Attachments/` or PDF image objects | Can be attached to notes/PDFs. PDF image objects store payload and metadata in annotation JSON. |
| Other attached documents | `Attachments/` | Can be stored and opened/listed as workspace files. Their extraction behavior is not owned by the Notes surface. |

## Attachment Rules

Attachments are normal workspace files unless they are embedded inside a PDF
annotation object. Embedded PDF image annotations store their payload in
`PDFAnnotationObject.dataBase64` and metadata such as MIME type, file name, and
OCR text when available.

When the workspace-wide search layer indexes a PDF, annotation objects can
become additional searchable blocks:

- Text annotation objects become `source: "annotation-text"` blocks.
- Image annotation objects become `source: "annotation-image-ocr"` blocks if
  they already have text metadata or if VLM OCR is enabled and succeeds.
- Image OCR cache files live under `.codmes/index/annotation-ocr/`.

## OCR Boundary

Notes-specific statement:

- Text annotation objects are plain text and can be indexed.
- Embedded PDF image objects can provide OCR text through the server-side
  extraction layer.
- Handwritten pen `inkStrokes` are not OCRed yet.

Detailed OCR provider behavior belongs under `docs/search`.
