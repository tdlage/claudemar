import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenDocTabs, formatDocBody, formatPresentation, formatSheetValues } from "../src/google-drive/native-format.js";

const run = (content: string, start: number) => ({ startIndex: start, endIndex: start + content.length, textRun: { content } });

test("documents list nested tabs and expose paragraph, heading, bullet and table cell indexes", () => {
  const tabs = flattenDocTabs([
    { tabProperties: { tabId: "t.0", title: "Main" }, documentTab: { body: { content: [] } }, childTabs: [{ tabProperties: { tabId: "t.1", title: "Appendix" } }] },
  ]);
  assert.deepEqual(tabs.map((tab) => [tab.id, tab.title, tab.depth]), [["t.0", "Main", 0], ["t.1", "Appendix", 1]]);

  const body = {
    content: [
      { endIndex: 1, sectionBreak: {} },
      { startIndex: 1, endIndex: 8, paragraph: { paragraphStyle: { namedStyleType: "HEADING_1" }, elements: [run("Report\n", 1)] } },
      { startIndex: 8, endIndex: 15, paragraph: { bullet: { listId: "l" }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [run("First\n", 8)] } },
      {
        startIndex: 15, endIndex: 30, table: {
          columns: 2, tableRows: [{ tableCells: [
            { startIndex: 16, endIndex: 20, content: [{ paragraph: { elements: [run("A1\n", 17)] } }] },
            { startIndex: 20, endIndex: 24, content: [{ paragraph: { elements: [run("B1\n", 21)] } }] },
          ] }],
        },
      },
    ],
  };
  assert.equal(formatDocBody(body, 0, 10_000).text, [
    "[1-8] (HEADING_1) Report",
    "[8-15] • First",
    "[15-30] TABLE 1x2",
    "  r1c1 [16-20] A1",
    "  r1c2 [20-24] B1",
  ].join("\n"));
  assert.equal(formatDocBody(body, 8, 10_000).text.split("\n")[0], "[8-15] • First");
  const truncated = formatDocBody(body, 0, 30);
  assert.equal(truncated.truncated, true);
  assert.match(truncated.text, /continue with from_index=8/);
});

test("presentations list slides, elements with points, placeholders, tables and speaker notes", () => {
  const presentation = {
    title: "Pitch",
    revisionId: "rev-1",
    pageSize: { width: { magnitude: 9_144_000, unit: "EMU" }, height: { magnitude: 5_143_500, unit: "EMU" } },
    slides: [
      {
        objectId: "s1",
        slideProperties: {
          layoutObjectId: "layout-title",
          notesPage: { notesProperties: { speakerNotesObjectId: "n1" }, pageElements: [{ objectId: "n1", shape: { text: { textElements: [{ textRun: { content: "Say hello\n" } }] } } }] },
        },
        pageElements: [
          {
            objectId: "title",
            size: { width: { magnitude: 6_350_000, unit: "EMU" }, height: { magnitude: 1_270_000, unit: "EMU" } },
            transform: { translateX: 127_000, translateY: 254_000, unit: "EMU" },
            shape: { shapeType: "TEXT_BOX", placeholder: { type: "TITLE" }, text: { textElements: [{ textRun: { content: "Q3 results\n" } }] } },
          },
          {
            objectId: "box",
            size: { width: { magnitude: 3_000_000, unit: "EMU" }, height: { magnitude: 3_000_000, unit: "EMU" } },
            transform: { scaleX: 2.5, scaleY: 0.5, translateX: 0, translateY: 0, unit: "EMU" },
            shape: { shapeType: "RECTANGLE" },
          },
          { objectId: "grid", table: { columns: 1, tableRows: [{ tableCells: [{ text: { textElements: [{ textRun: { content: "Revenue\n" } }] } }] }] } },
          { objectId: "group", elementGroup: { children: [{ objectId: "logo", image: {} }] } },
        ],
      },
      { objectId: "s2", slideProperties: { layoutObjectId: "layout-blank" }, pageElements: [] },
    ],
  };
  assert.equal(formatPresentation(presentation, null, 10_000).text, [
    'Presentation "Pitch" — 2 slide(s), page 720x405pt, revision rev-1',
    "Slide 1 (objectId s1, layout layout-title)",
    "  - title shape TEXT_BOX placeholder=TITLE 500x100pt @10,20: Q3 results",
    "  - box shape RECTANGLE 591x118pt @0,0",
    "  - grid table 1x1",
    "    r1c1: Revenue",
    "  - group group",
    "    - logo image",
    "  notes: Say hello",
    "Slide 2 (objectId s2, layout layout-blank)",
  ].join("\n"));
  assert.equal(formatPresentation(presentation, [2], 10_000).text.split("\n").length, 2);
});

test("sheet values carry their A1 addresses from the returned range", () => {
  assert.equal(
    formatSheetValues("'Budget 2026'!B3:D4", [["Item", 10, ""], ["Total", "=SUM(C3)"]], 100).text,
    ["Range 'Budget 2026'!B3:D4", "B3=Item | C3=10 | D3=∅", "B4=Total | C4==SUM(C3)"].join("\n"),
  );
  assert.equal(formatSheetValues("Sheet1!Z1:AB1", [["a", "b", "c"]], 100).text.split("\n")[1], "Z1=a | AA1=b | AB1=c");
  const limited = formatSheetValues("Sheet1!A1:B3", [["1", "2"], ["3", "4"], ["5", "6"]], 4);
  assert.equal(limited.truncated, true);
  assert.match(limited.text, /read from row 3 onwards/);
  assert.equal(formatSheetValues("Sheet1!A1", [], 10).text, "Range Sheet1!A1\n(empty)");
});
