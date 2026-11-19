// Tabs: a tab list with one selected tab. Arrow keys move between enabled tabs, Home and End jump.
// A disabled tab stays visible, is skipped by the keyboard and says why in its label.
import { el, uid } from "../surface-dom";
import "./tabs.css";

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** The id of the panel this tab shows, when there is one. */
  controls?: string;
}

export interface TabsOptions {
  /** Names the tab list for assistive technology. */
  label: string;
  tabs: readonly TabItem[];
  /** The id of the selected tab. Default: the first enabled tab. */
  selected?: string;
  onSelect?(id: string): void;
  doc?: Document;
}

export interface Tabs {
  element: HTMLElement;
  select(id: string): void;
  selected(): string;
}

export function createTabs(options: TabsOptions): Tabs {
  const doc = options.doc ?? document;
  const list = el(doc, "div", "mtabs");
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", options.label);
  const prefix = uid("tab");
  const buttons = new Map<string, HTMLButtonElement>();
  let current =
    options.selected ?? options.tabs.find((t) => !t.disabled)?.id ?? "";

  const enabled = () =>
    options.tabs.filter((t) => !t.disabled).map((t) => t.id);

  const paint = () => {
    for (const [id, button] of buttons) {
      const on = id === current;
      button.setAttribute("aria-selected", String(on));
      button.tabIndex = on ? 0 : -1;
    }
  };

  const select = (id: string, focus = false) => {
    if (!enabled().includes(id)) return;
    const changed = id !== current;
    current = id;
    paint();
    if (focus) buttons.get(id)?.focus();
    if (changed) options.onSelect?.(id);
  };

  for (const tab of options.tabs) {
    const button = el(doc, "button", undefined, tab.label);
    button.type = "button";
    button.id = `${prefix}-${tab.id}`;
    button.setAttribute("role", "tab");
    if (tab.controls) button.setAttribute("aria-controls", tab.controls);
    if (tab.disabled) button.disabled = true;
    button.addEventListener("click", () => select(tab.id));
    buttons.set(tab.id, button);
    list.append(button);
  }
  list.addEventListener("keydown", (event) => {
    const ids = enabled();
    const at = ids.indexOf(current);
    let next: string | undefined;
    if (event.key === "ArrowRight") next = ids[(at + 1) % ids.length];
    else if (event.key === "ArrowLeft")
      next = ids[(at - 1 + ids.length) % ids.length];
    else if (event.key === "Home") next = ids[0];
    else if (event.key === "End") next = ids[ids.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    select(next, true);
  });
  paint();
  return { element: list, select: (id) => select(id), selected: () => current };
}
