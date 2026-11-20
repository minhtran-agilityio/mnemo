// @vitest-environment happy-dom
import { beforeEach, expect, test } from "vitest";
import { cssRule } from "../../../css-rule";
import {
  createLabelPicker,
  EMPTY_TEXT,
  type LabelPickerNode,
} from "./label-picker";

const TREE: readonly LabelPickerNode[] = [
  { name: "Work", children: [{ name: "Mnemo", current: true }] },
  { name: "Personal" },
  { name: "Cá nhân", children: [{ name: "Sức khoẻ" }] },
];

beforeEach(() => document.body.replaceChildren());

const items = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLButtonElement>("[role=treeitem]"),
];
const item = (root: HTMLElement, path: string) =>
  items(root).find((b) => b.dataset.path === path) as HTMLButtonElement;

test("single: shows paths, the top level and the current parent", () => {
  const seen: (readonly string[])[] = [];
  const p = createLabelPicker(document, {
    label: "Move under",
    mode: "single",
    topLevel: true,
    nodes: TREE,
    value: ["Work / Mnemo"],
    onChange: (v) => seen.push(v),
  });
  document.body.append(p.element);
  expect(items(p.element).map((b) => b.getAttribute("aria-label"))).toEqual([
    "(Top level)",
    "Work",
    "Work / Mnemo",
    "Personal",
    "Cá nhân",
    "Cá nhân / Sức khoẻ",
  ]);
  expect(
    p.element.querySelector("[role=tree]")?.getAttribute("aria-label"),
  ).toBe(null);
  expect(
    p.element.querySelector("[role=tree]")?.getAttribute("aria-labelledby"),
  ).toBeTruthy();
  expect(item(p.element, "Work / Mnemo").textContent).toContain("Current");
  expect(item(p.element, "Work / Mnemo").getAttribute("aria-selected")).toBe(
    "true",
  );
  item(p.element, "").click();
  expect(p.value()).toEqual([""]);
  expect(seen).toEqual([[""]]);
  expect(item(p.element, "Work / Mnemo").getAttribute("aria-selected")).toBe(
    "false",
  );
});

test("a disabled node shows its reason and cannot be chosen", () => {
  const seen: unknown[] = [];
  const p = createLabelPicker(document, {
    label: "Move Work under",
    mode: "single",
    nodes: [
      { name: "Work", disabled: "A label cannot go under itself." },
      { name: "Personal" },
    ],
    onChange: (v) => seen.push(v),
  });
  document.body.append(p.element);
  const work = item(p.element, "Work");
  expect(work.getAttribute("aria-disabled")).toBe("true");
  expect(work.textContent).toContain("A label cannot go under itself.");
  const why = document.getElementById(
    work.getAttribute("aria-describedby") as string,
  );
  expect(why?.textContent).toBe("A label cannot go under itself.");
  work.click();
  expect(seen).toEqual([]);
});

test("multiple: chooses several, shows removable chips with paths", () => {
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "multiple",
    nodes: TREE,
    value: ["Work / Mnemo"],
  });
  document.body.append(p.element);
  item(p.element, "Cá nhân / Sức khoẻ").click();
  expect(p.value()).toEqual(["Work / Mnemo", "Cá nhân / Sức khoẻ"]);
  const chips = [...p.element.querySelectorAll(".label-picker-chip-text")];
  expect(chips.map((c) => c.textContent)).toEqual(p.value());
  const remove = p.element.querySelector<HTMLButtonElement>(
    "[aria-label='Remove label Work / Mnemo']",
  ) as HTMLButtonElement;
  remove.click();
  expect(p.value()).toEqual(["Cá nhân / Sức khoẻ"]);
  expect(item(p.element, "Work / Mnemo").getAttribute("aria-selected")).toBe(
    "false",
  );
});

test("error shows the text and marks the tree invalid", () => {
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "multiple",
    nodes: TREE,
  });
  document.body.append(p.element);
  const err = p.element.querySelector<HTMLElement>(".label-picker-error");
  expect(err?.textContent).toBe("");
  expect(err?.getAttribute("role")).toBe("status");
  p.setError("Choose at least one label before saving");
  expect(err?.textContent).toContain("Choose at least one label before saving");
  expect(
    p.element.querySelector("[role=tree]")?.getAttribute("aria-invalid"),
  ).toBe("true");
  p.setError(null);
  expect(err?.textContent).toBe("");
  expect(err?.isConnected).toBe(true);
});

test("empty says how to create a label", () => {
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "multiple",
    nodes: [],
  });
  expect(p.element.querySelector(".is-empty")?.textContent).toBe(EMPTY_TEXT);
  expect(p.element.querySelector("[role=tree]")).toBeNull();
});

test("keyboard: arrows, Home and End move focus; one item is in the tab order", () => {
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "single",
    nodes: TREE,
  });
  document.body.append(p.element);
  const list = items(p.element);
  expect(list.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  list[0].focus();
  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  press(list[0], "ArrowDown");
  expect(document.activeElement).toBe(list[1]);
  press(list[1], "End");
  expect(document.activeElement).toBe(list[list.length - 1]);
  press(list[list.length - 1], "Home");
  expect(document.activeElement).toBe(list[0]);
  expect(list[0].tabIndex).toBe(0);
  expect(list[1].tabIndex).toBe(-1);
});

test("a disabled picker cannot be changed", () => {
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "multiple",
    nodes: TREE,
    value: ["Work"],
    disabled: true,
  });
  item(p.element, "Personal").click();
  expect(p.value()).toEqual(["Work"]);
  expect(
    p.element.querySelector<HTMLButtonElement>(".label-picker-chip-remove")
      ?.disabled,
  ).toBe(true);
});

test("long and Vietnamese names go in as text and keep the full path", () => {
  const long = "Tài liệu tham khảo về trí tuệ nhân tạo ".repeat(6).trim();
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "multiple",
    nodes: [{ name: `<b>${long}</b>`, children: [{ name: "Sức khoẻ" }] }],
    value: [`<b>${long}</b> / Sức khoẻ`],
  });
  const chip = p.element.querySelector<HTMLElement>(".label-picker-chip-text");
  expect(chip?.title).toBe(`<b>${long}</b> / Sức khoẻ`);
  expect(p.element.querySelector("b")).toBeNull();
  expect(
    cssRule(import.meta.dirname, "label-picker.css", ".label-picker-chip-text"),
  ).toMatchObject({ overflow: "hidden", "text-overflow": "ellipsis" });
  expect(
    cssRule(import.meta.dirname, "label-picker.css", ".label-picker-name"),
  ).toMatchObject({ "overflow-wrap": "anywhere" });
});

test("duplicate paths and empty names are left out, so each path has one button", () => {
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "single",
    topLevel: true,
    nodes: [
      { name: "Work", children: [{ name: "Mnemo" }] },
      { name: "Work" },
      { name: "Work / Mnemo" },
      { name: "" },
      { name: "  " },
    ],
  });
  document.body.append(p.element);
  expect(items(p.element).map((b) => b.dataset.path)).toEqual([
    "",
    "Work",
    "Work / Mnemo",
  ]);
  const ids = [...p.element.querySelectorAll("[id]")].map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the Current marker is announced with the item", () => {
  const p = createLabelPicker(document, {
    label: "Move under",
    mode: "single",
    nodes: [
      {
        name: "Work",
        children: [{ name: "Mnemo", current: true, disabled: "No." }],
      },
    ],
  });
  document.body.append(p.element);
  const btn = item(p.element, "Work / Mnemo");
  const text = (btn.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((i) => document.getElementById(i)?.textContent)
    .join(" ");
  expect(text).toBe("Current No.");
});

test("a disabled node does not take the chosen look from a forced state", () => {
  const css = cssRule(
    import.meta.dirname,
    "label-picker.css",
    '.label-picker-item[aria-disabled="true"]',
  );
  expect(css.cursor).toBe("not-allowed");
});

test("removing a chip moves focus to the next chip, then the previous, then the tree", () => {
  const p = createLabelPicker(document, {
    label: "Labels",
    mode: "multiple",
    nodes: TREE,
    value: ["Work", "Personal", "Cá nhân"],
  });
  document.body.append(p.element);
  const remove = (path: string) =>
    p.element
      .querySelector<HTMLButtonElement>(`[aria-label='Remove label ${path}']`)
      ?.click();
  remove("Personal");
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "Remove label Cá nhân",
  );
  remove("Cá nhân");
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "Remove label Work",
  );
  remove("Work");
  expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
});

test("an error on an empty picker marks the empty box", () => {
  const p = createLabelPicker(document, {
    label: "L",
    mode: "multiple",
    nodes: [],
  });
  p.setError("Choose at least one label before saving");
  expect(
    p.element.querySelector(".is-empty")?.getAttribute("aria-invalid"),
  ).toBe("true");
});
