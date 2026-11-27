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

test("the trigger takes size and variant, and keeps the default look without them", () => {
  const plain = createMenu(document, { label: "Plain", items: [] });
  const quiet = createMenu(document, {
    label: "Move to folder",
    items: [],
    size: "sm",
    variant: "ghost",
  });
  const a = plain.anchor.querySelector("button") as HTMLButtonElement;
  const b = quiet.anchor.querySelector("button") as HTMLButtonElement;
  expect(a.className).not.toContain("btn-sm");
  expect(a.className).not.toContain("btn-ghost");
  expect(b.classList.contains("btn-sm")).toBe(true);
  expect(b.classList.contains("btn-ghost")).toBe(true);
  expect(b.textContent).toContain("Move to folder");
});

test("a disabled trigger does not open, and it has its name", () => {
  const menu = createMenu(document, {
    label: "Move to folder",
    items: [{ label: "Cooking" }],
    disabled: true,
  });
  document.body.append(menu.anchor);
  const trigger = menu.anchor.querySelector("button") as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  trigger.click();
  expect(menu.isOpen()).toBe(false);
  expect(trigger.textContent).toContain("Move to folder");
});

test("setDisabled closes an open menu and disables the trigger, and enabling restores it", () => {
  const menu = createMenu(document, { label: "Move", items: [{ label: "A" }] });
  document.body.append(menu.anchor);
  const trigger = menu.anchor.querySelector("button") as HTMLButtonElement;
  trigger.click();
  expect(menu.isOpen()).toBe(true);
  menu.setDisabled(true);
  expect(menu.isOpen()).toBe(false);
  expect(trigger.disabled).toBe(true);
  menu.setDisabled(false);
  expect(trigger.disabled).toBe(false);
  trigger.click();
  expect(menu.isOpen()).toBe(true);
});

test("a long name sits in a cut label; the title is set only when it is cut", () => {
  const name = "Đọc sau – bài dài về cơ sở dữ liệu và WAL ".repeat(4).trim();
  const m = createMenuPanel(document, [{ label: name }]);
  const item = m.querySelector<HTMLElement>('[role="menuitem"]');
  expect(item?.querySelector(".menu-label")?.textContent).toBe(name);
  const text = item?.querySelector(".menu-label") as HTMLElement;
  // happy-dom has no layout: fake a cut label, then an uncut one.
  Object.defineProperty(text, "scrollWidth", {
    value: 300,
    configurable: true,
  });
  Object.defineProperty(text, "clientWidth", { value: 100 });
  item?.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(item?.title).toBe(name);
  Object.defineProperty(text, "scrollWidth", { value: 50, configurable: true });
  item?.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(item?.hasAttribute("title")).toBe(false);
});

test("a disabled item keeps its label as the title", () => {
  const m = createMenuPanel(document, [
    { label: "Summarise (AI off)", disabled: true },
  ]);
  expect(m.querySelector<HTMLElement>('[role="menuitem"]')?.title).toBe(
    "Summarise (AI off)",
  );
});

test("a list of 25 folders keeps every item and keyboard reach", () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({
    label: `Folder ${i}`,
  }));
  const m = createMenuPanel(document, entries);
  document.body.append(m);
  const items = [...m.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items).toHaveLength(25);
  items[0]?.focus();
  key(items[0] as Element, "End");
  expect(document.activeElement).toBe(items[24]);
});
