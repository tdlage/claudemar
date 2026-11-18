import { describe, expect, it } from "vitest";
import { totalImageBytes, visionSize, type ImageBlock } from "./imageBlock";

const tokens = ({ width, height }: { width: number; height: number }) => Math.ceil(width / 28) * Math.ceil(height / 28);

describe("visionSize", () => {
  it("keeps images that already fit the model resolution", () => {
    expect(visionSize(1834, 1150)).toEqual({ width: 1834, height: 1150 });
    expect(visionSize(2576, 1449)).toEqual({ width: 2576, height: 1449 });
  });

  it("limits the long edge and the visual tokens preserving the aspect ratio", () => {
    for (const [width, height] of [[4032, 3024], [3000, 3000], [5760, 3240], [8000, 120], [1200, 7000]]) {
      const size = visionSize(width, height);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2576);
      expect(tokens(size)).toBeLessThanOrEqual(4784);
      expect(Math.abs(size.width / size.height - width / height)).toBeLessThan(0.05 * (width / height));
    }
  });

  it("does not shrink more than needed", () => {
    const size = visionSize(4032, 3024);
    expect(tokens(size)).toBeGreaterThan(4784 * 0.95);
  });
});

describe("totalImageBytes", () => {
  it("sums the base64 payload of every image", () => {
    const block = (data: string): ImageBlock => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
    expect(totalImageBytes([block("AAAA"), block("BBBBBBBB")])).toBe(12);
    expect(totalImageBytes([])).toBe(0);
  });
});
