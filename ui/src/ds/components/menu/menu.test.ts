// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createMenu, createMenuPanel } from "./menu";

function key(target: Element, k: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

test("items have role=menuitem and labels go in as text", () => {
  const m = createMenuPanel(document, [
    { label: "<b>Open</b>", shortcut: "↵" },
    "separator",
    { label: "Delete…", danger: true },
  ]);
  const items = m.querySelectorAll('[role="menuitem"]');
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toBe("<b>Open</b>↵");
  expect(m.querySelector("b")).toBeNull();
  expect(items[1]?.classList.contains("danger")).toBe(true);
  expect(m.querySelector("kbd")).not.toBeNull();
});

test("a disabled item sets aria-disabled and does not run", () => {
  const onSelect = vi.fn();
  const m = createMenuPanel(document, [
    { label: "Again", disabled: true, onSelect },
  ]);
  const item = m.querySelector<HTMLElement>('[role="menuitem"]');
  expect(item?.getAttribute("aria-disabled")).toBe("true");
  item?.click();
  expect(onSelect).not.toHaveBeenCalled();
});

test("arrow keys, Home and End move focus", () => {
  const m = createMenuPanel(document, [
    { label: "A" },
    { label: "B" },
    { label: "C" },
  ]);
  document.body.append(m);
  const items = [...m.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  items[0]?.focus();
  key(items[0] as Element, "ArrowDown");
  expect(document.activeElement).toBe(items[1]);
  key(items[1] as Element, "End");
  expect(document.activeElement).toBe(items[2]);
  key(items[2] as Element, "ArrowDown");
  expect(document.activeElement).toBe(items[0]);
  key(items[0] as Element, "ArrowUp");
  expect(document.activeElement).toBe(items[2]);
  key(items[2] as Element, "Home");
  expect(document.activeElement).toBe(items[0]);
});

test("a menu button opens, focuses the first item, runs the choice and closes", () => {
  const onSelect = vi.fn();
  const menu = createMenu(document, {
    label: "Actions",
    items: [{ label: "Open", onSelect }],
  });
  document.body.append(menu.anchor);
  const trigger = menu.anchor.querySelector("button") as HTMLButtonElement;
  trigger.click();
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const item = menu.anchor.querySelector<HTMLElement>('[role="menuitem"]');
  expect(document.activeElement).toBe(item);
  item?.click();
  expect(onSelect).toHaveBeenCalledOnce();
  expect(menu.isOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
