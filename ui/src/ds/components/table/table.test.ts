// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createTable } from "./table";

const opts = {
  label: "Links",
  columns: [
    { label: "Title" },
    { label: "Saved" },
    { label: "Opens", numeric: true },
  ],
  rows: [
    [{ text: "B" }, { text: "19 Nov", sort: 20261119 }, { text: "4" }],
    [{ text: "A" }, { text: "7 Nov", sort: 20261107 }, { text: "12" }],
    [{ text: "C" }, { text: "30 Oct", sort: 20261030 }, { text: "0" }],
  ],
} as const;
const firstCol = (t: HTMLElement) =>
  [...t.querySelectorAll("tbody tr")].map((r) => r.children[0].textContent);

test("it renders headers as buttons with aria-sort and cells as text", () => {
  const t = createTable(document, {
    ...opts,
    rows: [[{ text: "<b>x</b>" }, { text: "d" }, { text: "1" }]],
  });
  expect(t.querySelectorAll("th")).toHaveLength(3);
  expect(
    [...t.querySelectorAll("th")].map((th) => th.getAttribute("aria-sort")),
  ).toEqual(["none", "none", "none"]);
  expect(t.querySelector("th button")?.textContent).toBe("Title");
  expect(t.querySelector("td")?.textContent).toBe("<b>x</b>");
  expect(t.querySelector("b")).toBeNull();
  expect(t.tabIndex).toBe(0);
  expect(t.getAttribute("role")).toBe("region");
});

test("a click sorts ascending, then descending, and moves aria-sort", () => {
  const t = createTable(document, opts);
  const btn = (i: number) =>
    t.querySelectorAll("th button")[i] as HTMLButtonElement;
  const sortOf = () =>
    [...t.querySelectorAll("th")].map((th) => th.getAttribute("aria-sort"));
  btn(0).click();
  expect(firstCol(t)).toEqual(["A", "B", "C"]);
  expect(sortOf()).toEqual(["ascending", "none", "none"]);
  btn(0).click();
  expect(firstCol(t)).toEqual(["C", "B", "A"]);
  expect(sortOf()).toEqual(["descending", "none", "none"]);
  btn(2).click();
  expect(firstCol(t)).toEqual(["C", "B", "A"]);
  expect(sortOf()).toEqual(["none", "none", "ascending"]);
});

test("a date sorts by its sort value, not its text", () => {
  const t = createTable(document, opts);
  (t.querySelectorAll("th button")[1] as HTMLButtonElement).click();
  expect(firstCol(t)).toEqual(["C", "A", "B"]);
});

test("a start sort is applied", () => {
  const t = createTable(document, {
    ...opts,
    sort: { column: 1, direction: "descending" },
  });
  expect(firstCol(t)).toEqual(["B", "A", "C"]);
  expect(t.querySelectorAll("th")[1].getAttribute("aria-sort")).toBe(
    "descending",
  );
});

test("a numeric column sorts text that is not a number as the lowest, and a short row does not crash", () => {
  const t = createTable(document, {
    label: "Links",
    columns: [{ label: "Title" }, { label: "Opens", numeric: true }],
    rows: [
      [{ text: "a" }, { text: "1,200" }],
      [{ text: "b" }, { text: "5" }],
      [{ text: "c" }, { text: "—" }],
      [{ text: "d" }],
      [{ text: "e" }, { text: "30" }],
    ],
    sort: { column: 1, direction: "ascending" },
  });
  const order = firstCol(t);
  expect(order.slice(-2)).toEqual(["b", "e"]);
  expect(new Set(order.slice(0, 3))).toEqual(new Set(["a", "c", "d"]));
  t.querySelectorAll("th button")[1].dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
  expect(firstCol(t).slice(0, 2)).toEqual(["e", "b"]);
});
