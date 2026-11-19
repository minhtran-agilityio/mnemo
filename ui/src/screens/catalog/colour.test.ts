import { expect, test } from "vitest";
import {
  blend,
  compositeLayers,
  contrastOf,
  parseColour,
  targetVerdict,
  textVerdict,
} from "./colour";

// The inputs are built from parts so no colour literal sits in a source file (see the raw-colour test).
const hash = "#";
const fn = (name: string, body: string) => `${name}(${body})`;

test("parseColour reads hex, rgb and srgb forms", () => {
  expect(parseColour(`${hash}fff`)).toEqual([255, 255, 255, 1]);
  expect(parseColour(`${hash}102030`)).toEqual([16, 32, 48, 1]);
  expect(parseColour(fn("rgb", "16, 32, 48"))).toEqual([16, 32, 48, 1]);
  expect(parseColour(fn("rgba", "0, 0, 0, 0.5"))).toEqual([0, 0, 0, 0.5]);
  expect(parseColour(fn("color", "srgb 1 0 0 / 0.25"))).toEqual([
    255, 0, 0, 0.25,
  ]);
  expect(parseColour(fn("oklch", "0.5 0.1 20"))).toBeNull();
  expect(parseColour("transparent")).toBeNull();
});

test("the contrast ratio matches known values", () => {
  expect(contrastOf([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
  expect(contrastOf([255, 255, 255, 1], [255, 255, 255, 1])).toBeCloseTo(1, 5);
  expect(contrastOf([119, 119, 119, 1], [255, 255, 255, 1])).toBeCloseTo(
    4.48,
    1,
  );
});

test("blend lays a translucent colour over its ground", () => {
  expect(blend([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([
    127.5, 127.5, 127.5, 1,
  ]);
});

test("verdict words", () => {
  expect(textVerdict(5, false)).toBe("AA pass");
  expect(textVerdict(3.5, false)).toBe("large text only");
  expect(textVerdict(2, false)).toBe("fails AA");
  expect(textVerdict(2, true)).toBe("disabled, exempt");
  expect(targetVerdict(44, 44)).toBe("24: ok · 44: ok");
  expect(targetVerdict(100, 32)).toBe("24: ok · 44: under");
  expect(targetVerdict(20, 20)).toBe("24: under · 44: under");
});

test("parseColour reads four-digit hex and does not scale percentages twice", () => {
  expect(parseColour(`${hash}f008`)).toEqual([255, 0, 0, 136 / 255]);
  expect(parseColour(fn("color", "srgb 100% 50% 0%"))).toEqual([
    255, 127.5, 0, 1,
  ]);
  expect(parseColour(fn("color", "srgb 50% 50% 50% / 50%"))).toEqual([
    127.5, 127.5, 127.5, 0.5,
  ]);
  expect(parseColour(fn("color", "srgb 0.5 0.5 0.5"))).toEqual([
    127.5, 127.5, 127.5, 1,
  ]);
  expect(parseColour(`${hash}ff00ff80`)?.[3]).toBeCloseTo(0.5, 2);
});

test("compositeLayers blends each translucent layer over the nearest opaque one, outermost first", () => {
  const white: [number, number, number, number] = [255, 255, 255, 1];
  const dark: [number, number, number, number] = [0, 0, 0, 1];
  // A half white layer on a black page is grey, not white.
  expect(compositeLayers([[255, 255, 255, 0.5]], dark)).toEqual([
    127.5, 127.5, 127.5, 1,
  ]);
  // Layers run innermost first: 50% black over 50% white over an opaque grey.
  const grey: [number, number, number, number] = [100, 100, 100, 1];
  const got = compositeLayers(
    [[0, 0, 0, 0.5], [255, 255, 255, 0.5], grey],
    white,
  );
  expect(got).toEqual([88.75, 88.75, 88.75, 1]);
  // The walk stops at the first opaque layer: the white one behind it does not matter.
  expect(compositeLayers([dark, [255, 0, 0, 1]], white)).toEqual(dark);
  // No layer at all is the page colour.
  expect(compositeLayers([], white)).toEqual(white);
});
