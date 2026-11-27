// Menu: a list of actions. Arrow keys, Home and End move between items; Escape closes and returns
// focus to the button. A disabled item stays in the list with aria-disabled and says why.
import { ChevronDown } from "lucide";
import { createIcon } from "../../icon";
import { type ButtonVariant, createButton } from "../button/button";
import { nextControlId } from "../field/id";
import { createKbd } from "../kbd/kbd";
import { createPopover, type Popover } from "../popover/popover";
import "./menu.css";

export interface MenuItem {
  readonly label: string;
  /** A key hint on the right, for example "↵". */
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** A fixed highlight (the catalog shows an open menu this way). */
  readonly highlighted?: boolean;
  readonly onSelect?: () => void;
}
export type MenuEntry = MenuItem | "separator";

export interface MenuPanelOptions {
  readonly ariaLabel?: string;
  readonly labelledBy?: string;
  readonly static?: boolean;
  /** Runs after an enabled item is chosen. */
  readonly onChoose?: (item: MenuItem) => void;
}

function enabled(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

export function createMenuPanel(
  doc: Document,
  entries: readonly MenuEntry[],
  options: MenuPanelOptions = {},
): HTMLElement {
  const menu = doc.createElement("div");
  menu.className = options.static ? "menu static" : "menu";
  menu.setAttribute("role", "menu");
  if (options.ariaLabel) menu.setAttribute("aria-label", options.ariaLabel);
  if (options.labelledBy)
    menu.setAttribute("aria-labelledby", options.labelledBy);
  for (const entry of entries) {
    if (entry === "separator") {
      const hr = doc.createElement("hr");
      hr.setAttribute("role", "separator");
      menu.append(hr);
      continue;
    }
    const item = doc.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    if (entry.danger) item.classList.add("danger");
    if (entry.highlighted) item.classList.add("is-hover");
    if (entry.disabled) item.setAttribute("aria-disabled", "true");
    const text = doc.createElement("span");
    text.className = "menu-label";
    text.textContent = entry.label;
    // A disabled item keeps its full label as the title: the label holds the reason.
    if (entry.disabled) item.title = entry.label;
    item.append(text);
    if (entry.shortcut) item.append(createKbd(doc, entry.shortcut));
    item.addEventListener("click", () => {
      if (entry.disabled) return;
      entry.onSelect?.();
      options.onChoose?.(entry);
    });
    menu.append(item);
  }
  // The full name is the title only when the label is cut (checked when the pointer or focus
  // reaches the item, when the item has a width).
  const titleIfCut = (event: Event) => {
    const item = (event.target as Element).closest<HTMLElement>(
      '[role="menuitem"]',
    );
    const text = item?.querySelector<HTMLElement>(".menu-label");
    if (!item || !text || item.getAttribute("aria-disabled") === "true") return;
    if (text.scrollWidth > text.clientWidth)
      item.title = text.textContent ?? "";
    else item.removeAttribute("title");
  };
  menu.addEventListener("pointerover", titleIfCut);
  menu.addEventListener("focusin", titleIfCut);
  menu.addEventListener("keydown", (event) => {
    const items = enabled(menu);
    if (!items.length) return;
    const i = items.indexOf(doc.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (i + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (i - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  });
  return menu;
}

export interface MenuOptions {
  readonly label: string;
  readonly items: readonly MenuEntry[];
  readonly onChoose?: (item: MenuItem) => void;
  /** The trigger button's size. Default "md". */
  readonly size?: "md" | "sm";
  /** The trigger button's variant. Default "default". */
  readonly variant?: ButtonVariant;
  /** The trigger starts disabled. To change it later, call setDisabled on the menu. */
  readonly disabled?: boolean;
  /** When it aborts, an open menu closes and its document listener goes. */
  readonly signal?: AbortSignal;
}

export interface Menu extends Popover {
  /** Disables or enables the trigger (for example while a move runs). Disabling closes an open menu. */
  setDisabled(disabled: boolean): void;
}

/** A button that opens a menu. */
export function createMenu(doc: Document, options: MenuOptions): Menu {
  const trigger = createButton(doc, {
    label: options.label,
    size: options.size,
    variant: options.variant,
    disabled: options.disabled,
  });
  trigger.append(createIcon(ChevronDown));
  trigger.id = nextControlId("menu");
  let pop: Popover | undefined;
  const panel = createMenuPanel(doc, options.items, {
    labelledBy: trigger.id,
    onChoose: (item) => {
      pop?.close(true);
      options.onChoose?.(item);
    },
  });
  pop = createPopover(doc, {
    trigger,
    panel,
    haspopup: "menu",
    signal: options.signal,
    firstFocus: () => enabled(panel)[0] ?? null,
  });
  const popover = pop;
  return {
    ...popover,
    setDisabled(disabled: boolean) {
      if (disabled) popover.close(false);
      trigger.disabled = disabled;
    },
  };
}
