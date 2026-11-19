// Context menu: opens on right-click, or on Shift+F10 or the Menu key from the focused target.
// Arrow keys move, Home and End jump, Escape closes and puts focus back on the target.
import { el } from "../surface-dom";
import "./context-menu.css";

export interface ContextMenuItem {
  label: string;
  /** A destructive item. It is only coloured and set after a divider, never the only warning. */
  danger?: boolean;
  /** A divider before this item. */
  separated?: boolean;
  onSelect(): void;
}

export interface ContextMenuOptions {
  /** Names the menu, for example "Link actions". */
  label: string;
  /** The element that opens the menu. It should be focusable (tabindex 0). */
  target: HTMLElement;
  items: readonly ContextMenuItem[];
  doc?: Document;
}

export interface ContextMenu {
  /** Put this in the page, next to the target. It is hidden until it opens. */
  element: HTMLElement;
  open(x: number, y: number): void;
  close(returnFocus?: boolean): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createContextMenu(options: ContextMenuOptions): ContextMenu {
  const doc = options.doc ?? document;
  const { target } = options;
  const menu = el(doc, "div", "ctx-menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", options.label);
  target.setAttribute("aria-haspopup", "menu");

  const itemNodes: HTMLButtonElement[] = [];
  for (const item of options.items) {
    if (item.separated) menu.append(el(doc, "hr"));
    const button = el(
      doc,
      "button",
      item.danger ? "danger" : undefined,
      item.label,
    );
    button.type = "button";
    button.tabIndex = -1;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      close(true);
      item.onSelect();
    });
    itemNodes.push(button);
    menu.append(button);
  }

  const view = doc.defaultView;
  let isOpen = false;
  const onDocClick = (event: Event) => {
    if (!menu.contains(event.target as Node)) close(false);
  };

  function open(x: number, y: number) {
    isOpen = true;
    menu.hidden = false;
    const width = view?.innerWidth ?? x;
    const height = view?.innerHeight ?? y;
    // Keep the menu inside the window.
    menu.style.left = `${Math.max(0, Math.min(x, width - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, height - menu.offsetHeight))}px`;
    itemNodes[0]?.focus();
    doc.addEventListener("click", onDocClick);
  }
  function close(returnFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    doc.removeEventListener("click", onDocClick);
    if (returnFocus) target.focus();
  }

  const onContext = (event: MouseEvent) => {
    event.preventDefault();
    open(event.clientX, event.clientY);
  };
  const onTargetKey = (event: KeyboardEvent) => {
    if (
      (event.shiftKey && event.key === "F10") ||
      event.key === "ContextMenu"
    ) {
      event.preventDefault();
      const box = target.getBoundingClientRect();
      open(box.left, box.bottom);
    }
  };
  target.addEventListener("contextmenu", onContext);
  target.addEventListener("keydown", onTargetKey);

  menu.addEventListener("keydown", (event) => {
    const at = itemNodes.indexOf(doc.activeElement as HTMLButtonElement);
    const last = itemNodes.length - 1;
    let next: number | undefined;
    if (event.key === "ArrowDown") next = at >= last ? 0 : at + 1;
    else if (event.key === "ArrowUp") next = at <= 0 ? last : at - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key === "Tab") {
      close(true);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    itemNodes[next]?.focus();
  });

  return {
    element: menu,
    open,
    close,
    isOpen: () => isOpen,
    destroy() {
      close(false);
      target.removeEventListener("contextmenu", onContext);
      target.removeEventListener("keydown", onTargetKey);
      menu.remove();
    },
  };
}
