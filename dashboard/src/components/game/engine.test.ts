import { describe, expect, it } from "vitest";
import { isComplete, isSolved, pourAmount, replay, transfer } from "./engine";
import { TubeShape, areaBelow, levelForArea, polygonArea } from "./geometry";

describe("regras do jogo", () => {
  it("despeja a sequência do topo até onde cabe", () => {
    expect(pourAmount([[0, 1, 1, 1], [0, 0, 1], []], 0, 1, 4)).toBe(1);
    expect(pourAmount([[0, 1, 1], [], []], 0, 2, 4)).toBe(2);
    expect(transfer([[0, 1, 1], [1]], 0, 1, 2)).toEqual([[0], [1, 1, 1]]);
  });

  it("recusa cor diferente, destino cheio e frasco lacrado", () => {
    expect(pourAmount([[0, 1], [0]], 0, 1, 4)).toBe(0);
    expect(pourAmount([[1], [1, 1, 1, 1]], 0, 1, 4)).toBe(0);
    expect(pourAmount([[2, 2, 2], []], 0, 1, 3)).toBe(0);
    expect(isComplete([2, 2, 2], 3)).toBe(true);
  });

  it("reconstrói o tabuleiro e o histórico a partir das jogadas salvas", () => {
    const { tubes, history } = replay([[0, 1], [1, 0], []], [[0, 2], [1, 0], [1, 2]], 2);
    expect(tubes).toEqual([[0, 0], [], [1, 1]]);
    expect(history).toEqual([{ from: 0, to: 2, amount: 1 }, { from: 1, to: 0, amount: 1 }, { from: 1, to: 2, amount: 1 }]);
    expect(isSolved(tubes, 2)).toBe(true);
  });
});

describe("geometria do líquido", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it("mede a área abaixo de uma linha e encontra a linha para uma área", () => {
    expect(polygonArea(square)).toBe(100);
    expect(areaBelow(square, 4)).toBeCloseTo(60);
    expect(levelForArea(square, 25)).toBeCloseTo(7.5, 3);
  });

  it("preserva o volume quando o frasco inclina", () => {
    const shape = new TubeShape(40, 4);
    const pose = { x: 200, y: 100, angle: (70 * Math.PI) / 180, side: 1 as const };
    const world = shape.interior.map((point) => shape.toWorld(pose, point));
    const volume = shape.area(2.5);
    expect(areaBelow(world, levelForArea(world, volume))).toBeCloseTo(volume, 0);
    const local = shape.toLocal(pose, shape.toWorld(pose, { x: 7, y: 33 }));
    expect(local.x).toBeCloseTo(7);
    expect(local.y).toBeCloseTo(33);
  });

  it("cada unidade de líquido ocupa uma faixa crescente do frasco", () => {
    const shape = new TubeShape(40, 6);
    for (let units = 1; units <= 6; units++) expect(shape.area(units)).toBeGreaterThan(shape.area(units - 1));
    expect(shape.surface(6)).toBeGreaterThan(0);
  });
});
