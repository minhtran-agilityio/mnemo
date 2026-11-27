// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { cssRule } from "../../../css-rule";
import { createFolderHeading } from "./folder-heading";

const toggleOf = (h: { element: HTMLElement }) =>
  h.element.querySelector<HTMLButtonElement>("button") as HTMLButtonElement;

test("collapsed shows name, count and Show all N", () => {
  const h = createFolderHeading(document, {
    name: "Kỹ thuật / Rust",
    count: 24,
  });
  expect(h.element.querySelector("h3")?.textContent).toBe("Kỹ thuật / Rust 24");
  const b = toggleOf(h);
  expect(b.textContent).toBe("Show all 24");
  expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(b.getAttribute("aria-label")).toBe("Show all 24 in Kỹ thuật / Rust");
});

test("a click expands, reports it, and toggles back", () => {
  const seen: boolean[] = [];
  const h = createFolderHeading(document, {
    name: "Đọc sau",
    count: 7,
    controls: "list-1",
    onToggle: (e) => seen.push(e),
  });
  const b = toggleOf(h);
  expect(b.type).toBe("button");
  expect(b.getAttribute("aria-controls")).toBe("list-1");
  b.click();
  expect(b.textContent).toBe("Show less");
  expect(b.getAttribute("aria-expanded")).toBe("true");
  b.click();
  expect(b.textContent).toBe("Show all 7");
  expect(seen).toEqual([true, false]);
});

test("a folder of 0 is hidden and shows again with a count", () => {
  const h = createFolderHeading(document, { name: "Empty", count: 0 });
  expect(h.element.hidden).toBe(true);
  h.setCount(3);
  expect(h.element.hidden).toBe(false);
  expect(toggleOf(h).textContent).toBe("Show all 3");
});

test("no toggle when every link already shows", () => {
  const h = createFolderHeading(document, {
    name: "Small",
    count: 2,
    canToggle: false,
  });
  expect(h.element.querySelector("button")).toBeNull();
});

test("setCanToggle adds and drops the toggle on a heading on screen", () => {
  const h = createFolderHeading(document, { name: "Small", count: 2 });
  h.setCanToggle(false);
  expect(h.element.querySelector("button")).toBeNull();
  h.setCanToggle(true);
  expect(toggleOf(h).textContent).toBe("Show all 2");
});

test("a count of 1234 reads the same in the count and the toggle", () => {
  const h = createFolderHeading(document, { name: "Big", count: 1234 });
  expect(h.element.querySelector(".folder-heading-count")?.textContent).toBe(
    "1,234",
  );
  expect(toggleOf(h).textContent).toBe("Show all 1,234");
  expect(toggleOf(h).getAttribute("aria-label")).toBe("Show all 1,234 in Big");
});

test("text goes in as text; long name and count 500 keep their text", () => {
  const name = `<i>x</i>${"Thư mục rất dài ".repeat(4)}`;
  const h = createFolderHeading(document, { name, count: 500 });
  expect(h.element.querySelector("i")).toBeNull();
  expect(h.element.querySelector(".folder-heading-name")?.textContent).toBe(
    name,
  );
  expect(toggleOf(h).textContent).toBe("Show all 500");
  h.setExpanded(true);
  expect(toggleOf(h).getAttribute("aria-expanded")).toBe("true");
});

test("a long name wraps instead of widening the heading", () => {
  const rule = cssRule(
    __dirname,
    "folder-heading.css",
    ".folder-heading-title",
  );
  expect(rule["overflow-wrap"]).toBe("anywhere");
});
