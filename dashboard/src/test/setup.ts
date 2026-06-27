import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

const rect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
} as DOMRect;

function rectList(): DOMRectList {
  const list = [rect] as unknown as DOMRectList & DOMRect[];
  (list as unknown as { item: (i: number) => DOMRect | null }).item = (i: number) => list[i] ?? null;
  return list;
}

type Geom = {
  getClientRects?: () => DOMRectList;
  getBoundingClientRect?: () => DOMRect;
  scrollIntoView?: () => void;
};

const nodeProto = Node.prototype as unknown as Geom;
nodeProto.getClientRects ??= () => rectList();
nodeProto.getBoundingClientRect ??= () => rect;
(Element.prototype as unknown as Geom).scrollIntoView ??= () => {};
Range.prototype.getClientRects = () => rectList();
Range.prototype.getBoundingClientRect = () => rect;

const doc = document as unknown as { elementFromPoint?: () => Element | null };
doc.elementFromPoint ??= () => null;

afterEach(() => {
  cleanup();
});
