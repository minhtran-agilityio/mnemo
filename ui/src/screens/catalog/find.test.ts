// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createFinder, type FindItem, fold, matchItems } from "./find";

const make = (label: string, where = "Records", run = () => {}): FindItem => ({
  label,
  where,
  run,
});

test("fold drops Vietnamese marks and reads đ as d", () => {
  expect(fold("Tiếng Việt, Đọc sau")).toBe("tieng viet, doc sau");
});

test("matchItems needs every word and ignores marks and case", () => {
  const items = [
    make("tiếng việt", "Tokens"),
    make("Link card"),
    make("Note row"),
  ];
  expect(matchItems(items, "TIENG viet").map((i) => i.label)).toEqual([
    "tiếng việt",
  ]);
  expect(matchItems(items, "row note").map((i) => i.label)).toEqual([
    "Note row",
  ]);
  expect(matchItems(items, "records").length).toBe(2);
  expect(matchItems(items, "").length).toBe(3);
  expect(matchItems(items, "zzz")).toEqual([]);
});

const stop = new AbortController();
afterEach(() => {
  document.body.innerHTML = "";
});

function setup(run = vi.fn()) {
  const wrap = document.createElement("div");
  const opener = document.createElement("button");
  document.body.append(opener, wrap);
  opener.focus();
  const finder = createFinder(wrap, stop.signal, () => [
    make("Button", "Controls", run),
    make("Banner", "Feedback", run),
    make("--accent", "Tokens"),
  ]);
  return { wrap, opener, finder, run };
}
const key = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

test("the dialog lists everything, filters while typing and opens the active match on Enter", () => {
  const { wrap, finder, run } = setup();
  finder.open();
  const input = wrap.querySelector("input") as HTMLInputElement;
  expect(wrap.querySelectorAll('[role="option"]').length).toBe(3);
  input.value = "ban";
  input.dispatchEvent(new Event("input"));
  const options = wrap.querySelectorAll('[role="option"]');
  expect(options.length).toBe(1);
  expect(options[0].textContent).toContain("Banner");
  key(input, "Enter");
  expect(run).toHaveBeenCalledTimes(1);
  expect(finder.isOpen()).toBe(false);
});

test("arrows move the selection and wrap", () => {
  const { wrap, finder } = setup();
  finder.open();
  const input = wrap.querySelector("input") as HTMLInputElement;
  const selected = () =>
    [...wrap.querySelectorAll('[role="option"]')].findIndex(
      (o) => o.getAttribute("aria-selected") === "true",
    );
  expect(selected()).toBe(0);
  key(input, "ArrowDown");
  expect(selected()).toBe(1);
  key(input, "ArrowUp");
  key(input, "ArrowUp");
  expect(selected()).toBe(2);
  expect(input.getAttribute("aria-activedescendant")).toBe("pal-o2");
});

test("a query with no match says so, and closing gives focus back", () => {
  const { wrap, opener, finder } = setup();
  finder.open();
  const input = wrap.querySelector("input") as HTMLInputElement;
  input.value = "zzz";
  input.dispatchEvent(new Event("input"));
  expect(wrap.querySelector(".none")?.textContent).toContain("Nothing matches");
  expect(wrap.querySelector(".num")?.textContent).toBe("0 results");
  wrap.querySelector("dialog")?.close();
  expect(document.activeElement).toBe(opener);
});
