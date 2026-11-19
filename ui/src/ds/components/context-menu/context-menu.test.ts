// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createContextMenu } from "./context-menu";

afterEach(() => {
  document.body.innerHTML = "";
});

function make(onSelect = vi.fn()) {
  const target = document.createElement("li");
  target.tabIndex = 0;
  const menu = createContextMenu({
    label: "Link actions",
    target,
    items: [
      { label: "Open", onSelect },
      { label: "Copy link", onSelect: vi.fn() },
      { label: "Delete…", danger: true, separated: true, onSelect: vi.fn() },
    ],
  });
  document.body.append(target, menu.element);
  return { target, menu };
}
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }),
  );
const items = (m: HTMLElement) => [
  ...m.querySelectorAll<HTMLElement>('[role="menuitem"]'),
];

test("hidden at first, a labelled menu of menuitems", () => {
  const { menu, target } = make();
  expect(menu.element.hidden).toBe(true);
  expect(menu.element.getAttribute("role")).toBe("menu");
  expect(menu.element.getAttribute("aria-label")).toBe("Link actions");
  expect(items(menu.element).map((i) => i.textContent)).toEqual([
    "Open",
    "Copy link",
    "Delete…",
  ]);
  expect(menu.element.querySelector("hr")).not.toBeNull();
  expect(target.getAttribute("aria-haspopup")).toBe("menu");
});

test("right-click opens and focuses the first item", () => {
  const { menu, target } = make();
  target.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  expect(menu.isOpen()).toBe(true);
  expect(document.activeElement).toBe(items(menu.element)[0]);
});

test("Shift+F10 and the Menu key open it from the keyboard", () => {
  const a = make();
  key(a.target, "F10", { shiftKey: true });
  expect(a.menu.isOpen()).toBe(true);
  document.body.innerHTML = "";
  const b = make();
  key(b.target, "ContextMenu");
  expect(b.menu.isOpen()).toBe(true);
});

test("arrows wrap, Home and End jump", () => {
  const { menu } = make();
  menu.open(0, 0);
  const list = items(menu.element);
  key(list[0] as HTMLElement, "ArrowUp");
  expect(document.activeElement).toBe(list[2]);
  key(list[2] as HTMLElement, "ArrowDown");
  expect(document.activeElement).toBe(list[0]);
  key(list[0] as HTMLElement, "End");
  expect(document.activeElement).toBe(list[2]);
  key(list[2] as HTMLElement, "Home");
  expect(document.activeElement).toBe(list[0]);
});

test("Escape closes and returns focus to the target", () => {
  const { menu, target } = make();
  menu.open(0, 0);
  key(items(menu.element)[0] as HTMLElement, "Escape");
  expect(menu.isOpen()).toBe(false);
  expect(document.activeElement).toBe(target);
});

test("choosing an item closes the menu and runs it", () => {
  const onSelect = vi.fn();
  const { menu } = make(onSelect);
  menu.open(0, 0);
  items(menu.element)[0]?.click();
  expect(onSelect).toHaveBeenCalledOnce();
  expect(menu.isOpen()).toBe(false);
});

test("a click outside closes it", () => {
  const { menu } = make();
  menu.open(0, 0);
  document.body.click();
  expect(menu.isOpen()).toBe(false);
});
