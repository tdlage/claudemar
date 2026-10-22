import type { docs_v1, slides_v1 } from "googleapis";

export const DOC_MIME = "application/vnd.google-apps.document";
export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const SLIDES_MIME = "application/vnd.google-apps.presentation";

const EMU_PER_POINT = 12_700;

export interface DocTab {
  id: string;
  title: string;
  depth: number;
  body: docs_v1.Schema$Body | undefined;
}

export interface Truncatable {
  text: string;
  truncated: boolean;
}

export function flattenDocTabs(tabs: docs_v1.Schema$Tab[] | undefined, depth = 0): DocTab[] {
  return (tabs ?? []).flatMap((tab) => [
    { id: tab.tabProperties?.tabId ?? "", title: tab.tabProperties?.title ?? "", depth, body: tab.documentTab?.body },
    ...flattenDocTabs(tab.childTabs, depth + 1),
  ]);
}

function paragraphText(paragraph: docs_v1.Schema$Paragraph): string {
  return (paragraph.elements ?? []).map((element) => element.textRun?.content ?? (element.inlineObjectElement ? "[image]" : "")).join("").replace(/\n$/, "");
}

function cellText(content: docs_v1.Schema$StructuralElement[] | undefined): string {
  return (content ?? []).map((element) => (element.paragraph ? paragraphText(element.paragraph) : "")).join(" / ").trim();
}

export function formatDocBody(body: docs_v1.Schema$Body | undefined, fromIndex: number, maxChars: number): Truncatable {
  const lines: string[] = [];
  let size = 0;
  for (const element of body?.content ?? []) {
    if ((element.endIndex ?? 0) <= fromIndex) continue;
    const range = `[${element.startIndex ?? 0}-${element.endIndex ?? 0}]`;
    let line: string | null = null;
    if (element.paragraph) {
      const style = element.paragraph.paragraphStyle?.namedStyleType;
      const bullet = element.paragraph.bullet ? "• " : "";
      const label = style && style !== "NORMAL_TEXT" ? ` (${style})` : "";
      line = `${range}${label} ${bullet}${paragraphText(element.paragraph)}`;
    } else if (element.table) {
      const rows = element.table.tableRows ?? [];
      const cells = rows.flatMap((row, r) =>
        (row.tableCells ?? []).map((cell, c) => `  r${r + 1}c${c + 1} [${cell.startIndex ?? 0}-${cell.endIndex ?? 0}] ${cellText(cell.content)}`),
      );
      line = [`${range} TABLE ${rows.length}x${element.table.columns ?? 0}`, ...cells].join("\n");
    } else if (element.tableOfContents) {
      line = `${range} TABLE OF CONTENTS`;
    }
    if (line === null) continue;
    if (size + line.length > maxChars && lines.length > 0) {
      lines.push(`… truncated: continue with from_index=${element.startIndex ?? 0}`);
      return { text: lines.join("\n"), truncated: true };
    }
    lines.push(line);
    size += line.length + 1;
  }
  return { text: lines.join("\n"), truncated: false };
}

function shapeText(shape: slides_v1.Schema$Shape | undefined): string {
  return (shape?.text?.textElements ?? []).map((element) => element.textRun?.content ?? "").join("").trim();
}

function points(dimension: slides_v1.Schema$Dimension | undefined): number {
  if (!dimension?.magnitude) return 0;
  return Math.round(dimension.unit === "EMU" ? dimension.magnitude / EMU_PER_POINT : dimension.magnitude);
}

function scaled(dimension: slides_v1.Schema$Dimension | undefined, scale: number | null | undefined): slides_v1.Schema$Dimension | undefined {
  return dimension ? { ...dimension, magnitude: (dimension.magnitude ?? 0) * (scale ?? 1) } : dimension;
}

function describeElement(element: slides_v1.Schema$PageElement, indent: string): string[] {
  const id = element.objectId ?? "?";
  const transform = element.transform;
  const unit = transform?.unit ?? "EMU";
  const box = element.size
    ? ` ${points(scaled(element.size.width, transform?.scaleX))}x${points(scaled(element.size.height, transform?.scaleY))}pt @${points({ magnitude: transform?.translateX ?? 0, unit })},${points({ magnitude: transform?.translateY ?? 0, unit })}`
    : "";
  if (element.elementGroup) {
    return [`${indent}- ${id} group${box}`, ...(element.elementGroup.children ?? []).flatMap((child) => describeElement(child, `${indent}  `))];
  }
  if (element.shape) {
    const placeholder = element.shape.placeholder?.type ? ` placeholder=${element.shape.placeholder.type}` : "";
    const text = shapeText(element.shape);
    return [`${indent}- ${id} shape ${element.shape.shapeType ?? ""}${placeholder}${box}${text ? `: ${text.replace(/\n/g, " ⏎ ")}` : ""}`];
  }
  if (element.table) {
    const rows = element.table.tableRows ?? [];
    return [
      `${indent}- ${id} table ${rows.length}x${element.table.columns ?? 0}${box}`,
      ...rows.flatMap((row, r) => (row.tableCells ?? []).map((cell, c) => `${indent}  r${r + 1}c${c + 1}: ${shapeText({ text: cell.text })}`)),
    ];
  }
  if (element.image) return [`${indent}- ${id} image${box}`];
  if (element.video) return [`${indent}- ${id} video${box}`];
  if (element.line) return [`${indent}- ${id} line${box}`];
  if (element.sheetsChart) return [`${indent}- ${id} sheets chart${box}`];
  return [`${indent}- ${id} element${box}`];
}

function speakerNotes(slide: slides_v1.Schema$Page): string {
  const notesId = slide.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;
  const notes = slide.slideProperties?.notesPage?.pageElements?.find((element) => element.objectId === notesId);
  return shapeText(notes?.shape);
}

export function formatPresentation(presentation: slides_v1.Schema$Presentation, slideNumbers: number[] | null, maxChars: number): Truncatable {
  const slides = presentation.slides ?? [];
  const lines = [
    `Presentation "${presentation.title ?? ""}" — ${slides.length} slide(s), page ${points(presentation.pageSize?.width)}x${points(presentation.pageSize?.height)}pt, revision ${presentation.revisionId ?? "?"}`,
  ];
  let size = lines[0].length;
  for (const [index, slide] of slides.entries()) {
    const number = index + 1;
    if (slideNumbers && !slideNumbers.includes(number)) continue;
    const notes = speakerNotes(slide);
    const block = [
      `Slide ${number} (objectId ${slide.objectId ?? "?"}, layout ${slide.slideProperties?.layoutObjectId ?? "?"})`,
      ...(slide.pageElements ?? []).flatMap((element) => describeElement(element, "  ")),
      ...(notes ? [`  notes: ${notes.replace(/\n/g, " ⏎ ")}`] : []),
    ].join("\n");
    if (size + block.length > maxChars && lines.length > 1) {
      lines.push(`… truncated: read the remaining slides with slide_numbers starting at ${number}`);
      return { text: lines.join("\n"), truncated: true };
    }
    lines.push(block);
    size += block.length + 1;
  }
  return { text: lines.join("\n"), truncated: false };
}

function columnNumber(letters: string): number {
  return [...letters.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function columnLetters(number: number): string {
  let letters = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

export function formatSheetValues(range: string, values: unknown[][], maxCells: number): Truncatable {
  const start = /!?\$?([A-Za-z]+)\$?(\d+)/.exec(range.includes("!") ? range.slice(range.lastIndexOf("!")) : range);
  const firstColumn = start ? columnNumber(start[1]) : 1;
  const firstRow = start ? Number(start[2]) : 1;
  const lines = [`Range ${range}`];
  let cells = 0;
  for (const [offset, row] of values.entries()) {
    if (cells + row.length > maxCells && lines.length > 1) {
      lines.push(`… truncated after ${cells} cells: read from row ${firstRow + offset} onwards`);
      return { text: lines.join("\n"), truncated: true };
    }
    const rendered = row.map((value, column) => `${columnLetters(firstColumn + column)}${firstRow + offset}=${value === "" || value === null || value === undefined ? "∅" : String(value)}`);
    lines.push(rendered.join(" | "));
    cells += row.length;
  }
  if (values.length === 0) lines.push("(empty)");
  return { text: lines.join("\n"), truncated: false };
}
