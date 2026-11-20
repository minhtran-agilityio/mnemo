// @vitest-environment happy-dom
import { beforeEach, expect, test } from "vitest";
import { cssRule, MARKS_ROOM } from "../../../css-rule";
import { createSectionList, type SectionList } from "./section-list";

let list: SectionList;
let picked: string[];

beforeEach(() => {
  picked = [];
  document.body.replaceChildren();
  list = createSectionList(document, {
    label: "Settings sections",
    sections: [
      { id: "appearance", label: "Appearance", value: "System" },
      { id: "ai", label: "AI", value: "Not built yet" },
    ],
    current: "appearance",
    onSelect: (id) => picked.push(id),
  });
  document.body.append(list.element);
});

const row = (name: string) =>
  [
    ...list.element.querySelectorAll<HTMLButtonElement>(
      "button.section-list-row",
    ),
  ].find(
    (b) => b.querySelector(".section-list-name")?.textContent === name,
  ) as HTMLButtonElement;

test("it is a labelled nav of row buttons, each with its name and value", () => {
  expect(list.element.tagName).toBe("NAV");
  expect(list.element.getAttribute("aria-label")).toBe("Settings sections");
  expect(row("Appearance").type).toBe("button");
  expect(row("Appearance").textContent).toBe("Appearance System");
  expect(row("AI").textContent).toBe("AI Not built yet");
});

test("one row is current", () => {
  expect(row("Appearance").getAttribute("aria-current")).toBe("true");
  expect(row("AI").hasAttribute("aria-current")).toBe(false);
});

test("a click marks the row current, tells the caller and keeps focus on the row", () => {
  const ai = row("AI");
  ai.focus();
  ai.click();
  expect(picked).toEqual(["ai"]);
  expect(ai.getAttribute("aria-current")).toBe("true");
  expect(row("Appearance").hasAttribute("aria-current")).toBe(false);
  expect(document.activeElement).toBe(ai);
});

test("setValue updates the value in place, and the full value is the title", () => {
  const before = row("Appearance");
  list.setValue("appearance", "Dark");
  expect(row("Appearance")).toBe(before);
  expect(before.textContent).toBe("Appearance Dark");
  const long = "A very long value that does not fit in the row ".repeat(4);
  list.setValue("ai", long);
  const value = row("AI").querySelector<HTMLElement>(".section-list-value");
  expect(value?.textContent).toBe(long);
  expect(value?.title).toBe(long);
});

test("setCurrent moves the current row without a click", () => {
  list.setCurrent("ai");
  expect(row("AI").getAttribute("aria-current")).toBe("true");
  expect(picked).toEqual([]);
});

test("a forced state draws hover or focus for the UI Catalog", () => {
  const forced = createSectionList(document, {
    label: "x",
    sections: [{ id: "a", label: "A", value: "1" }],
    forceState: { id: "a", state: "hover" },
  });
  expect(
    forced.element
      .querySelector(".section-list-row")
      ?.classList.contains("is-hover"),
  ).toBe(true);
});

test("text goes in as text, never as markup", () => {
  list.setValue("ai", "<b>bold</b>");
  expect(list.element.querySelector("b")).toBeNull();
});

// The Limits tab fix (issue 113): a long value is cut with an ellipsis and keeps room for stacked marks.
test("a long unbroken value is whole text in .section-list-value, which has room for stacked marks", () => {
  const value = `${"ẪẬẲỖỮỰ".repeat(12)}${"z".repeat(90)}`;
  list.setValue("ai", value);
  const el = row("AI").querySelector(".section-list-value") as HTMLElement;
  expect(el.textContent).toBe(value);
  expect(el.title).toBe(value);
  const rule = cssRule(
    import.meta.dirname,
    "section-list.css",
    ".section-list-value",
  );
  expect(rule).toMatchObject(MARKS_ROOM);
  expect(rule["max-width"]).toBe("100%");
  expect(rule.overflow).toBe("hidden");
  const nav = cssRule(import.meta.dirname, "section-list.css", ".section-list");
  expect(nav["max-width"]).toBe("100%");
});
