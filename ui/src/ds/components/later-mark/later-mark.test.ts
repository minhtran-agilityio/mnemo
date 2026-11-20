// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildLaterMark } from "./later-mark";

test("it is the word Later in a span with the base class", () => {
  const mark = buildLaterMark(document);
  expect(mark.tagName).toBe("SPAN");
  expect(mark.className).toBe("later-mark");
  expect(mark.textContent).toBe("Later");
});

test("it is plain text: not focusable, no role and no number", () => {
  const mark = buildLaterMark(document);
  expect(mark.tabIndex).toBe(-1);
  expect(mark.getAttribute("role")).toBeNull();
  expect(mark.textContent).not.toMatch(/\d/);
});

test("next to a name with a space, the accessible name reads 'Videos Later'", () => {
  const row = document.createElement("span");
  row.append("Videos", " ", buildLaterMark(document));
  expect(row.textContent).toBe("Videos Later");
});
