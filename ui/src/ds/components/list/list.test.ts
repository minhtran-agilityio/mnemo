// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createListRow } from "../list-row/list-row";
import { createList, createListbox } from "./list";

const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

test("a list is a labelled ul with its rows", () => {
  const ul = createList(document, "Links", [
    createListRow(document, { title: "A" }),
  ]);
  expect(ul.className).toBe("list");
  expect(ul.getAttribute("aria-label")).toBe("Links");
  expect(ul.querySelectorAll(".row")).toHaveLength(1);
});

test("a listbox moves with the arrow keys and selects with Enter", () => {
  const ul = createListbox(document, "Links", [
    { title: "A" },
    { title: "B" },
    { title: "C" },
  ]);
  document.body.append(ul);
  const rows = [...ul.querySelectorAll<HTMLElement>(".row")];
  expect(ul.getAttribute("role")).toBe("listbox");
  expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  rows[0].focus();
  key(rows[0], "ArrowDown");
  expect(document.activeElement).toBe(rows[1]);
  expect(rows.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  key(rows[1], "Enter");
  expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual([
    "false",
    "true",
    "false",
  ]);
  key(rows[1], "End");
  expect(document.activeElement).toBe(rows[2]);
  key(rows[2], "ArrowDown");
  expect(document.activeElement).toBe(rows[2]);
  ul.remove();
});
