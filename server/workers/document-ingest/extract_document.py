#!/usr/bin/env python3
"""Codmes document extraction worker.

This worker uses explicit, format-specific extractors installed by Codmes
runtime bootstrap:

- PyMuPDF4LLM: PDF to Markdown/table-oriented extraction
- PyMuPDF: PDF text extraction and PDF block coordinates
- MarkItDown/python-docx/python-pptx/openpyxl/xlrd: document/table extraction
- openpyxl/xlrd: spreadsheet extraction

Codmes intentionally does not depend on native OCR or office-conversion
binaries such as tesseract, pdftoppm, LibreOffice, or soffice. MarkItDown is
used through its default local/free converter path.

The Node server owns scheduling, caching, and indexing. This script only turns
one workspace file into normalized JSON text blocks.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover - optional dependency
    fitz = None

try:
    import pymupdf4llm
except Exception:  # pragma: no cover - optional dependency
    pymupdf4llm = None

try:
    import pdfplumber
except Exception:  # pragma: no cover - optional dependency
    pdfplumber = None


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"}
OFFICE_EXTS = {".doc", ".docx", ".ppt", ".pptx", ".hwp", ".hwpx", ".odt", ".odp"}
SHEET_EXTS = {".xlsx", ".xls"}
SUPPORTED_ZIP_EXTS = {".zip", ".pdf", ".hwpx", ".hwp", ".xlsx", ".xls", ".ppt", ".pptx", ".doc", ".docx", *IMAGE_EXTS}
HWPX_PARA_NS = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract text for Codmes Search.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--relative", default="")
    parser.add_argument("--max-zip-members", type=int, default=int(os.getenv("CODMES_EXTRACT_MAX_ZIP_MEMBERS", "40")))
    parser.add_argument("--max-zip-depth", type=int, default=int(os.getenv("CODMES_EXTRACT_MAX_ZIP_DEPTH", "2")))
    args = parser.parse_args()

    input_path = Path(args.input)
    relative = args.relative or input_path.name
    try:
        result = extract_path(input_path, relative, args)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:  # Keep stdout valid JSON for Node callers.
        print(json.dumps({
            "schemaVersion": 1,
            "path": relative,
            "kind": kind_for_path(relative),
            "text": "",
            "blocks": [],
            "warnings": [f"{type(exc).__name__}: {exc}"],
            "extractor": "codmes-document-worker",
        }, ensure_ascii=False))
        return 0


def extract_path(path: Path, relative: str, args: argparse.Namespace) -> dict[str, Any]:
    data = path.read_bytes()
    return extract_bytes(data, relative, args, depth=0)


def extract_bytes(data: bytes, name: str, args: argparse.Namespace, depth: int) -> dict[str, Any]:
    ext = Path(name.lower()).suffix
    warnings: list[str] = []
    blocks: list[dict[str, Any]] = []
    markdown = ""
    tables: list[dict[str, Any]] = []

    if ext == ".pdf":
        text, markdown, tables, pdf_blocks, pdf_warnings = extract_pdf(data, name)
        blocks.extend(pdf_blocks)
        warnings.extend(pdf_warnings)
    elif ext in IMAGE_EXTS:
        text, warning = markitdown_to_text(data, name)
        if warning:
            warnings.append(warning)
        if text:
            blocks.append(block(name, text, source="markitdown", page=None, kind="image"))
    elif ext == ".hwpx":
        text = hwpx_to_text(data)
        if text:
            blocks.append(block(name, text, source="hwpx", page=None, kind="document"))
    elif ext == ".hwp":
        text, warning = office_or_hwp_to_text(data, name)
        if warning:
            warnings.append(warning)
        if text:
            blocks.append(block(name, text, source="office", page=None, kind="document"))
    elif ext in {".docx", ".pptx"}:
        text = openxml_to_text(data, name)
        warning = None
        if not text:
            text, warning = office_to_text(data, name)
        if warning:
            warnings.append(warning)
        if text:
            blocks.append(block(name, text, source="openxml" if warning is None else "office", page=None, kind="document"))
    elif ext in {".doc", ".ppt", ".odt", ".odp"}:
        text, warning = office_to_text(data, name)
        if warning:
            warnings.append(warning)
        if text:
            blocks.append(block(name, text, source="office", page=None, kind="document"))
    elif ext == ".xlsx":
        text, warning = xlsx_to_text(data)
        if warning:
            warnings.append(warning)
        if text:
            blocks.append(block(name, text, source="spreadsheet", page=None, kind="spreadsheet"))
    elif ext == ".xls":
        text, warning = xls_to_text(data)
        if warning:
            warnings.append(warning)
        if text:
            blocks.append(block(name, text, source="spreadsheet", page=None, kind="spreadsheet"))
    elif ext == ".zip":
        text, zip_blocks, zip_warnings = zip_to_text(data, name, args, depth)
        blocks.extend(zip_blocks)
        warnings.extend(zip_warnings)
    else:
        text = data.decode("utf-8", "ignore")
        if text.strip():
            blocks.append(block(name, text, source="text", page=None, kind="file"))

    normalized = normalize_text(text)
    if not blocks and normalized:
        blocks.append(block(name, normalized, source="text", page=None, kind=kind_for_path(name)))

    return {
        "schemaVersion": 2,
        "path": name,
        "kind": kind_for_path(name),
        "text": normalized,
        "markdown": markdown or normalized,
        "tables": tables,
        "blocks": blocks,
        "warnings": warnings,
        "extractor": "codmes-document-worker",
    }


def extract_pdf(data: bytes, name: str) -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    blocks: list[dict[str, Any]] = []
    structured_text, tables, structured_warning = pymupdf4llm_pdf_to_markdown(data, name)
    if structured_warning:
        warnings.append(structured_warning)

    fallback_tables, fallback_warning = pdfplumber_fallback_tables(data, name, tables)
    tables.extend(fallback_tables)
    if fallback_warning:
        warnings.append(fallback_warning)

    _pymupdf_text, pymupdf_blocks, pymupdf_warning = pymupdf_pdf_to_blocks(data, name)
    if pymupdf_warning:
        warnings.append(pymupdf_warning)
    if structured_text:
        if pymupdf_blocks:
            blocks.extend(pymupdf_blocks)
        else:
            blocks.append(block(name, structured_text, source="pdf-markdown", page=None, kind="pdf", metadata={"pdfEngine": "pymupdf4llm"}))
        markdown = append_recovered_tables(structured_text, fallback_tables)
        return structured_text, markdown, tables, blocks, warnings

    return "", "", tables, blocks, warnings or ["PyMuPDF4LLM produced no PDF text."]


def pymupdf4llm_pdf_to_markdown(data: bytes, name: str) -> tuple[str, list[dict[str, Any]], str | None]:
    if pymupdf4llm is None:
        return "", [], "PyMuPDF4LLM not installed; PDF Markdown/table extraction unavailable."
    if fitz is None:
        return "", [], "PyMuPDF not installed; PyMuPDF4LLM unavailable."
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        return "", [], f"PyMuPDF4LLM could not open PDF: {exc}"
    try:
        page_chunks = pymupdf4llm.to_markdown(
            doc,
            page_chunks=True,
            write_images=False,
            embed_images=False,
            ignore_images=True,
            page_separators=True,
            table_strategy=os.getenv("CODMES_PDF_TABLE_STRATEGY", "lines_strict"),
            show_progress=False,
        )
        markdown = "\n\n".join(str(page.get("text") or "").strip() for page in page_chunks).strip()
        tables = markdown_tables_from_page_chunks(page_chunks, doc, name)
        text = normalize_text(markdown)
        return text, tables, None if text else "PyMuPDF4LLM returned no text."
    except Exception as exc:
        return "", [], f"PyMuPDF4LLM failed: {exc}"
    finally:
        doc.close()


def markdown_tables_from_page_chunks(page_chunks: list[dict[str, Any]], doc: Any, name: str) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    for page_chunk in page_chunks:
        page_number = int((page_chunk.get("metadata") or {}).get("page_number") or len(tables) + 1)
        page_text = str(page_chunk.get("text") or "")
        page = doc[page_number - 1]
        for box in page_chunk.get("page_boxes") or []:
            if box.get("class") != "table":
                continue
            start, end = (box.get("pos") or [0, 0])[:2]
            table_markdown = page_text[int(start):int(end)].strip()
            parsed = parse_markdown_table(table_markdown)
            if not parsed:
                continue
            tables.append(table_record(
                name,
                page_number,
                len(tables) + 1,
                parsed[0],
                parsed[1],
                table_markdown,
                box.get("bbox"),
                float(page.rect.width),
                float(page.rect.height),
                "pymupdf4llm",
            ))
    return tables


def parse_markdown_table(markdown: str) -> tuple[list[str], list[list[str]]] | None:
    lines = [line.strip() for line in str(markdown or "").splitlines() if line.strip().startswith("|")]
    parsed = [split_markdown_row(line) for line in lines]
    parsed = [row for row in parsed if row and not all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in row)]
    if len(parsed) < 2 or len(parsed[0]) < 2:
        return None
    width = max(len(row) for row in parsed)
    normalized = [row + [""] * (width - len(row)) for row in parsed]
    return normalize_table_headers(normalized[0]), normalized[1:]


def split_markdown_row(line: str) -> list[str]:
    value = line.strip().strip("|")
    cells = re.split(r"(?<!\\)\|", value)
    return [clean_table_cell(cell) for cell in cells]


def clean_table_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = text.replace("**", "").replace("__", "").replace("\\|", "|")
    return re.sub(r"\s+", " ", text).strip()


def normalize_table_headers(headers: list[str]) -> list[str]:
    normalized = [clean_table_cell(header) for header in headers]
    for index in range(len(normalized) - 1):
        left = normalized[index]
        right = normalized[index + 1]
        if not re.match(r"^Pri\b", left, flags=re.IGNORECASE) or not re.match(r"^ce\b", right, flags=re.IGNORECASE):
            continue
        left_body = re.sub(r"^Pri\b", "", left, flags=re.IGNORECASE).strip()
        right_body = re.sub(r"^ce\b", "", right, flags=re.IGNORECASE).strip()
        left_body = re.sub(r"\bInput$", "", left_body, flags=re.IGNORECASE).strip()
        right_body = re.sub(r"\bOutput$", "", right_body, flags=re.IGNORECASE).strip()
        shared = re.sub(r"\s+", " ", f"Price {left_body} {right_body}").strip()
        normalized[index] = f"{shared} Input"
        normalized[index + 1] = f"{shared} Output"
    return normalized


def table_record(
    name: str,
    page: int,
    index: int,
    headers: list[str],
    rows: list[list[str]],
    markdown: str,
    bbox_values: Any,
    page_width: float,
    page_height: float,
    engine: str,
) -> dict[str, Any]:
    bbox = None
    if bbox_values and len(bbox_values) >= 4:
        x0, y0, x1, y1 = map(float, bbox_values[:4])
        bbox = {
            "unit": "pdf-point",
            "x": x0,
            "y": y0,
            "width": max(0.0, x1 - x0),
            "height": max(0.0, y1 - y0),
            "pageWidth": page_width,
            "pageHeight": page_height,
            "normalized": {
                "x": x0 / page_width if page_width else 0,
                "y": y0 / page_height if page_height else 0,
                "width": max(0.0, x1 - x0) / page_width if page_width else 0,
                "height": max(0.0, y1 - y0) / page_height if page_height else 0,
            },
        }
    return {
        "id": f"table-page-{page}-{index}",
        "path": name,
        "page": page,
        "source": "pdf-table",
        "headers": headers,
        "rows": rows,
        "markdown": markdown.strip() or markdown_table(headers, rows),
        "bbox": bbox,
        "metadata": {"tableEngine": engine, "rowCount": len(rows), "columnCount": len(headers)},
    }


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    def row(values: list[str]) -> str:
        return "| " + " | ".join(str(value or "").replace("\n", "<br>").replace("|", "\\|") for value in values) + " |"
    return "\n".join([row(headers), row(["---"] * len(headers)), *(row(item) for item in rows)])


def append_recovered_tables(markdown: str, tables: list[dict[str, Any]]) -> str:
    if not tables:
        return markdown
    sections = [markdown.rstrip(), "", "## Recovered tables"]
    for table in tables:
        sections.extend([
            "",
            f"### Page {int(table.get('page') or 0)}",
            "",
            str(table.get("markdown") or "").strip(),
        ])
    return "\n".join(sections).strip()


def pdfplumber_fallback_tables(
    data: bytes,
    name: str,
    existing: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str | None]:
    if pdfplumber is None:
        return [], "pdfplumber not installed; fallback table extraction unavailable."
    existing_pages = {int(table.get("page") or 0) for table in existing}
    results: list[dict[str, Any]] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as document:
            for page_number, page in enumerate(document.pages, start=1):
                if page_number in existing_pages:
                    continue
                for candidate in page.find_tables():
                    extracted = candidate.extract() or []
                    headers = normalize_table_headers(list(extracted[0] if extracted else []))
                    if sum(bool(value) for value in headers) < 2:
                        continue
                    rows = [[clean_table_cell(value) for value in row] for row in extracted[1:]]
                    bbox = list(candidate.bbox)
                    if not rows:
                        expanded = expand_header_table(page, candidate)
                        if expanded:
                            headers, rows, bbox = expanded
                    rows = [row for row in rows if any(row)]
                    if not rows:
                        continue
                    width = max(len(headers), *(len(row) for row in rows))
                    headers += [""] * (width - len(headers))
                    rows = [row + [""] * (width - len(row)) for row in rows]
                    results.append(table_record(
                        name,
                        page_number,
                        len(existing) + len(results) + 1,
                        headers,
                        rows,
                        markdown_table(headers, rows),
                        bbox,
                        float(page.width),
                        float(page.height),
                        "pdfplumber",
                    ))
        return results, None
    except Exception as exc:
        return results, f"pdfplumber table extraction failed: {exc}"


def expand_header_table(page: Any, candidate: Any) -> tuple[list[str], list[list[str]], list[float]] | None:
    x0, top, x1, bottom = map(float, candidate.bbox)
    boundaries = sorted({round(float(cell[0]), 3) for cell in candidate.cells} | {round(float(cell[2]), 3) for cell in candidate.cells})
    if len(boundaries) < 3:
        return None
    horizontal_edges = [
        edge for edge in page.horizontal_edges
        if float(edge.get("top", -1)) >= top - 2
        and min(float(edge.get("x1", 0)), x1) - max(float(edge.get("x0", 0)), x0) >= (x1 - x0) * 0.65
    ]
    if len(horizontal_edges) < 3:
        return None
    extended_bottom = max(float(edge["top"]) for edge in horizontal_edges)
    cropped = page.crop((x0, top, x1, min(float(page.height), extended_bottom + 1)))
    extracted = cropped.extract_table({
        "vertical_strategy": "explicit",
        "explicit_vertical_lines": boundaries,
        "horizontal_strategy": "lines",
        "snap_tolerance": 4,
        "join_tolerance": 4,
        "intersection_tolerance": 5,
    }) or []
    if len(extracted) < 2:
        return None
    headers = normalize_table_headers(list(extracted[0]))
    rows = [[clean_table_cell(value) for value in row] for row in extracted[1:]]
    return headers, rows, [x0, top, x1, extended_bottom]


def pymupdf_pdf_to_blocks(data: bytes, name: str) -> tuple[str, list[dict[str, Any]], str | None]:
    if fitz is None:
        return "", [], "PyMuPDF not installed; PDF coordinates unavailable."
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        return "", [], f"PyMuPDF could not open PDF: {exc}"
    blocks: list[dict[str, Any]] = []
    page_texts: list[str] = []
    try:
        for page_index, page in enumerate(doc, start=1):
            page_text = normalize_text(page.get_text("text") or "")
            if page_text:
                page_texts.append(page_text)
            rect = page.rect
            page_width = float(rect.width or 0)
            page_height = float(rect.height or 0)
            for block_index, item in enumerate(page.get_text("blocks") or [], start=1):
                if len(item) < 5:
                    continue
                x0, y0, x1, y1, text = item[:5]
                text = normalize_text(text)
                if not text:
                    continue
                bbox = {
                    "unit": "pdf-point",
                    "x": float(x0),
                    "y": float(y0),
                    "width": max(0.0, float(x1) - float(x0)),
                    "height": max(0.0, float(y1) - float(y0)),
                    "pageWidth": page_width,
                    "pageHeight": page_height,
                }
                if page_width > 0 and page_height > 0:
                    bbox["normalized"] = {
                        "x": float(x0) / page_width,
                        "y": float(y0) / page_height,
                        "width": max(0.0, float(x1) - float(x0)) / page_width,
                        "height": max(0.0, float(y1) - float(y0)) / page_height,
                    }
                blocks.append(block(
                    name,
                    text,
                    source="pdf-text",
                    page=page_index,
                    kind="pdf",
                    metadata={
                        "pdfEngine": "pymupdf",
                        "pageCount": doc.page_count,
                        "blockIndex": block_index,
                    },
                    bbox=bbox,
                ))
    finally:
        doc.close()
    return normalize_text("\n\n".join(page_texts)), blocks, None


def hwpx_to_text(data: bytes) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = sorted(name for name in zf.namelist() if name.startswith("Contents/section") and name.endswith(".xml"))
        for name in names:
            root = ET.fromstring(zf.read(name))
            for item in root.iter(f"{HWPX_PARA_NS}t"):
                if item.text:
                    parts.append(item.text)
    return normalize_text("\n".join(parts))


def office_or_hwp_to_text(data: bytes, filename: str) -> tuple[str, str | None]:
    text, warning = office_to_text(data, filename)
    if text:
        return text, warning
    ole_text = hwp_ole_strings_to_text(data)
    if ole_text:
        return ole_text, warning
    return "", warning or "HWP extraction failed."


def openxml_to_text(data: bytes, filename: str) -> str:
    ext = Path(filename.lower()).suffix
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if ext == ".docx":
                names = ["word/document.xml"]
            elif ext == ".pptx":
                names = sorted(name for name in zf.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
            else:
                return ""
            parts: list[str] = []
            for name in names:
                if name not in zf.namelist():
                    continue
                root = ET.fromstring(zf.read(name))
                texts = [
                    node.text or ""
                    for node in root.iter()
                    if (node.tag.endswith("}t") or node.tag == "t") and node.text
                ]
                if texts:
                    if ext == ".pptx":
                        parts.append(f"[Slide: {Path(name).stem}]\n" + "\n".join(texts))
                    else:
                        parts.append("\n".join(texts))
            return normalize_text("\n\n".join(parts))
    except Exception:
        return ""


def office_to_text(data: bytes, filename: str) -> tuple[str, str | None]:
    markitdown_text, markitdown_warning = markitdown_to_text(data, filename)
    if markitdown_text:
        return markitdown_text, markitdown_warning
    return "", markitdown_warning or "No library extractor available for this document."


def markitdown_to_text(data: bytes, filename: str) -> tuple[str, str | None]:
    try:
        from markitdown import MarkItDown  # type: ignore
    except Exception:
        return "", "MarkItDown not installed."
    suffix = Path(filename).suffix or ".bin"
    with tempfile.TemporaryDirectory(prefix="codmes-markitdown-") as tmp:
        input_path = Path(tmp) / f"input{suffix}"
        input_path.write_bytes(data)
        try:
            result = MarkItDown().convert(str(input_path))
            text = normalize_text(getattr(result, "text_content", "") or "")
            return text, None if text else "MarkItDown returned no text."
        except Exception as exc:
            return "", f"MarkItDown failed: {exc}"


def hwp_ole_strings_to_text(data: bytes) -> str:
    decoded = data.decode("utf-16le", "ignore")
    runs: list[str] = []
    pattern = r"[\uAC00-\uD7A3A-Za-z0-9\s().,/%·\\-:]{3,}"
    for match in re.finditer(pattern, decoded):
        text = " ".join(match.group(0).split())
        if any("가" <= ch <= "힣" for ch in text):
            runs.append(text)
    return normalize_text("\n".join(dict.fromkeys(runs)))


def xlsx_to_text(data: bytes) -> tuple[str, str | None]:
    try:
        import openpyxl  # type: ignore
    except Exception:
        return xlsx_to_text_minimal(data), "openpyxl not found; used minimal XLSX XML extractor."
    workbook = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    out: list[str] = []
    for sheet in workbook.worksheets:
        out.append(f"[Sheet: {sheet.title}]")
        headers: list[str] | None = None
        rows: list[list[str]] = []
        for row in sheet.iter_rows(values_only=True):
            cells = trim_empty_tail(["" if value is None else str(value).strip() for value in row])
            if any(cell.strip() for cell in cells):
                rows.append(cells)
        for index, row in enumerate(rows):
            if headers is None and looks_like_header(row, rows[index + 1:index + 4]):
                headers = dedupe_headers(row)
                out.append("[표 헤더] " + " | ".join(headers))
                continue
            row_text = " | ".join(cell for cell in row if cell)
            if row_text:
                out.append(("[행] " if headers else "") + row_text)
        out.append(f"[End Sheet: {sheet.title}]")
    return normalize_text("\n".join(out)), None


def xlsx_to_text_minimal(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.iter():
                if si.tag.endswith("}si") or si.tag == "si":
                    text = "".join(t.text or "" for t in si.iter() if t.tag.endswith("}t") or t.tag == "t")
                    shared.append(text)
        parts: list[str] = []
        for name in sorted(n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")):
            parts.append(f"[Sheet: {Path(name).stem}]")
            root = ET.fromstring(zf.read(name))
            for row in root.iter():
                if not (row.tag.endswith("}row") or row.tag == "row"):
                    continue
                values: list[str] = []
                for cell in row:
                    if not (cell.tag.endswith("}c") or cell.tag == "c"):
                        continue
                    cell_type = cell.attrib.get("t")
                    value = ""
                    for child in cell:
                        if child.tag.endswith("}v") or child.tag == "v":
                            value = child.text or ""
                    if cell_type == "s" and value.isdigit() and int(value) < len(shared):
                        value = shared[int(value)]
                    if value:
                        values.append(value)
                if values:
                    parts.append(" | ".join(values))
        return normalize_text("\n".join(parts))


def xls_to_text(data: bytes) -> tuple[str, str | None]:
    try:
        import xlrd  # type: ignore
    except Exception:
        return "", "xlrd not found; XLS extraction skipped."
    book = xlrd.open_workbook(file_contents=data)
    out: list[str] = []
    for sheet in book.sheets():
        out.append(f"[Sheet: {sheet.name}]")
        headers: list[str] | None = None
        rows: list[list[str]] = []
        for row_index in range(sheet.nrows):
            cells = trim_empty_tail([
                "" if sheet.cell_value(row_index, col) is None else str(sheet.cell_value(row_index, col)).strip()
                for col in range(sheet.ncols)
            ])
            if any(cell.strip() for cell in cells):
                rows.append(cells)
        for index, row in enumerate(rows):
            if headers is None and looks_like_header(row, rows[index + 1:index + 4]):
                headers = dedupe_headers(row)
                out.append("[표 헤더] " + " | ".join(headers))
                continue
            row_text = " | ".join(cell for cell in row if cell)
            if row_text:
                out.append(("[행] " if headers else "") + row_text)
        out.append(f"[End Sheet: {sheet.name}]")
    return normalize_text("\n".join(out)), None


def zip_to_text(data: bytes, name: str, args: argparse.Namespace, depth: int) -> tuple[str, list[dict[str, Any]], list[str]]:
    if depth > args.max_zip_depth:
        return "", [], ["ZIP depth limit reached."]
    texts: list[str] = []
    blocks: list[dict[str, Any]] = []
    warnings: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        members = [item for item in zf.infolist() if not item.is_dir() and "__MACOSX/" not in item.filename and not Path(item.filename).name.startswith(".")]
        handled = 0
        for item in members:
            if handled >= args.max_zip_members:
                warnings.append(f"ZIP member limit reached: {args.max_zip_members}/{len(members)}")
                break
            ext = Path(item.filename.lower()).suffix
            if ext not in SUPPORTED_ZIP_EXTS:
                continue
            handled += 1
            child_name = f"{name}/{item.filename}"
            try:
                extracted = extract_bytes(zf.read(item), child_name, args, depth + 1)
                child_text = extracted.get("text") or ""
                if child_text:
                    labelled = f"[압축 내부 파일: {item.filename}]\n{child_text}"
                    texts.append(labelled)
                    blocks.extend(extracted.get("blocks") or [block(child_name, labelled, source="zip", page=None, kind=kind_for_path(child_name))])
                warnings.extend(extracted.get("warnings") or [])
            except Exception as exc:
                warnings.append(f"{item.filename}: {type(exc).__name__}: {exc}")
    return normalize_text("\n\n".join(texts)), blocks, warnings


def block(
    path: str,
    text: str,
    *,
    source: str,
    page: int | None,
    kind: str,
    metadata: dict[str, Any] | None = None,
    bbox: dict[str, Any] | None = None,
    confidence: float | None = None,
) -> dict[str, Any]:
    return {
        "path": path,
        "kind": kind,
        "source": source,
        "page": page,
        "text": normalize_text(text),
        "bbox": bbox,
        "confidence": confidence,
        "metadata": metadata or {},
    }


def trim_empty_tail(cells: list[str]) -> list[str]:
    end = len(cells)
    while end > 0 and not cells[end - 1].strip():
        end -= 1
    return cells[:end]


def looks_like_header(row: list[str], following: list[list[str]]) -> bool:
    if len([cell for cell in row if cell.strip()]) < 2:
        return False
    if not following:
        return True
    numeric_below = 0
    checked = 0
    for next_row in following:
        for cell in next_row:
            if not cell:
                continue
            checked += 1
            if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", cell.replace(",", "")):
                numeric_below += 1
    return checked == 0 or numeric_below >= max(1, checked // 4)


def dedupe_headers(row: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    headers: list[str] = []
    for index, cell in enumerate(row):
        base = cell.strip() or f"열{index + 1}"
        seen[base] = seen.get(base, 0) + 1
        headers.append(base if seen[base] == 1 else f"{base}_{seen[base]}")
    return headers


def kind_for_path(path: str) -> str:
    ext = Path(path.lower()).suffix
    if ext == ".pdf":
        return "pdf"
    if ext in IMAGE_EXTS:
        return "image"
    if ext in SHEET_EXTS:
        return "spreadsheet"
    if ext in OFFICE_EXTS:
        return "document"
    if ext == ".zip":
        return "archive"
    return "file"


def normalize_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+\n", "\n", str(text or ""))).strip()


if __name__ == "__main__":
    raise SystemExit(main())
