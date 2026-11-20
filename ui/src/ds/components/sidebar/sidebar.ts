// Sidebar: the app's side menu. The logo with a collapse toggle, a quick link, the search box, the
// groups of links, and a list that opens and closes at the bottom. It holds no data of its own: the
// caller passes the items and the collapsed state in and hears about changes. It collapses only
// when the owner presses the toggle, and shows no counts or badges. Collapsed, every item keeps its
// name for a screen reader and gets it as a tooltip. All text goes in as text, never as markup.
import type { IconNode } from "lucide";
import { createIcon } from "../../icon";
import { buildLaterMark } from "../later-mark/later-mark";
import "./sidebar.css";

export interface SidebarLink {
  id: string;
  label: string;
  href: string;
  icon: IconNode;
  /** Planned for later: shows a Later mark, and "(Later)" in the collapsed tooltip. */
  later?: boolean;
  /** Draws a state without the pointer or the keyboard, for the UI Catalog. */
  forceState?: "hover" | "focus";
}

export interface SidebarGroup {
  id: string;
  label: string;
  items: readonly SidebarLink[];
}

export interface SidebarOptions {
  /** Names the nav landmark. */
  label: string;
  brand: string;
  /** The letter in the logo square. It is decoration, hidden from screen readers. */
  brandMark: string;
  /** The quick link under the logo. */
  quick: SidebarLink;
  /** The label and placeholder of the search box. */
  searchLabel: string;
  groups: readonly SidebarGroup[];
  /** The list at the bottom, with the button that opens and closes it. */
  bottom: { label: string; icon: IconNode; items: readonly SidebarLink[] };
  collapsed: boolean;
  /** Opens the bottom list from the start. */
  bottomOpen?: boolean;
  /** The start of every id in the sidebar. Two sidebars on one page need two prefixes. */
  idPrefix?: string;
  /** Called after the owner opens or collapses the sidebar. */
  onToggle?(collapsed: boolean): void;
  /** Called when the owner presses Enter in the search box. */
  onSearch?(text: string): void;
}

export interface Sidebar {
  element: HTMLElement;
  /** Marks the item for `id` as the current page. An item of the bottom list opens that list. */
  setCurrent(id: string): void;
  /** Changes the look without calling onToggle. */
  setCollapsed(collapsed: boolean): void;
  isCollapsed(): boolean;
}

/** The panel icon of the toggle; its arrow flips when the sidebar is collapsed. */
const TOGGLE_ICON: IconNode = [
  ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }],
  ["path", { d: "M9 4v16" }],
  ["path", { d: "M15.5 10l-2 2 2 2", class: "sidebar-arrow" }],
];
const SEARCH_ICON: IconNode = [
  ["circle", { cx: "11", cy: "11", r: "7" }],
  ["path", { d: "M21 21l-4.3-4.3" }],
];
const CHEVRON_ICON: IconNode = [["path", { d: "M6 9l6 6 6-6" }]];

function make<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function link(
  doc: Document,
  item: SidebarLink,
  className: string,
): HTMLAnchorElement {
  const a = make(doc, "a", className);
  a.href = item.href;
  a.dataset.item = item.id;
  // The collapsed tooltip is this text, so a Later item keeps its Later status there.
  a.dataset.label = item.later ? `${item.label} (Later)` : item.label;
  if (item.forceState) a.classList.add(`is-${item.forceState}`);
  a.append(
    createIcon(item.icon, "nav"),
    make(doc, "span", "sidebar-text", item.label),
  );
  // A real space keeps the accessible name readable: "Videos Later".
  if (item.later) a.append(" ", buildLaterMark(doc));
  return a;
}

export function createSidebar(doc: Document, options: SidebarOptions): Sidebar {
  const prefix = options.idPrefix ?? "sidebar";
  let collapsed = options.collapsed;
  let bottomOpen = false;

  const nav = make(doc, "nav", "sidebar");
  nav.setAttribute("aria-label", options.label);

  // Logo and collapse toggle.
  const logo = make(doc, "div", "sidebar-logo");
  const mark = make(doc, "span", "sidebar-mark", options.brandMark);
  mark.setAttribute("aria-hidden", "true");
  const toggle = make(doc, "button", "sidebar-toggle");
  toggle.type = "button";
  toggle.append(createIcon(TOGGLE_ICON, "nav"));
  logo.append(mark, make(doc, "span", "sidebar-name", options.brand), toggle);

  const quick = link(doc, options.quick, "sidebar-quick");

  // Search: a form with a real label. Enter submits it.
  const form = make(doc, "form", "sidebar-search");
  form.setAttribute("role", "search");
  const label = make(doc, "label", "sidebar-sr", options.searchLabel);
  label.htmlFor = `${prefix}-search`;
  const input = make(doc, "input", "input sidebar-search-field");
  input.id = `${prefix}-search`;
  input.type = "search";
  input.autocomplete = "off";
  input.placeholder = options.searchLabel;
  form.append(label, createIcon(SEARCH_ICON, "nav"), input);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    options.onSearch?.(input.value);
  });
  // With the sidebar collapsed the box is hidden; this button opens it and focuses the box.
  const searchButton = make(
    doc,
    "button",
    "sidebar-item sidebar-search-button",
  );
  searchButton.type = "button";
  searchButton.append(
    createIcon(SEARCH_ICON, "nav"),
    make(doc, "span", "sidebar-text", options.searchLabel),
  );
  searchButton.addEventListener("click", () => {
    setCollapsed(false, true);
    input.focus();
  });

  // The groups.
  const scroll = make(doc, "div", "sidebar-scroll");
  for (const group of options.groups) {
    const heading = make(doc, "h2", "sidebar-label", group.label);
    heading.id = `${prefix}-group-${group.id}`;
    const list = make(doc, "ul", "sidebar-list");
    list.setAttribute("aria-labelledby", heading.id);
    for (const item of group.items) {
      const li = make(doc, "li");
      li.append(link(doc, item, "sidebar-item"));
      list.append(li);
    }
    scroll.append(heading, list);
  }

  // The bottom list. It sits above its button, so the button stays at the bottom when it opens.
  const bottom = make(doc, "div", "sidebar-bottom");
  const bottomList = make(doc, "ul", "sidebar-list sidebar-bottom-list");
  bottomList.id = `${prefix}-apps`;
  for (const item of options.bottom.items) {
    const li = make(doc, "li");
    li.append(link(doc, item, "sidebar-item"));
    bottomList.append(li);
  }
  const bottomToggle = make(
    doc,
    "button",
    "sidebar-item sidebar-bottom-toggle",
  );
  bottomToggle.type = "button";
  bottomToggle.setAttribute("aria-controls", bottomList.id);
  bottomToggle.append(
    createIcon(options.bottom.icon, "nav"),
    make(doc, "span", "sidebar-text", options.bottom.label),
    createIcon(CHEVRON_ICON, "sm", "sidebar-chevron"),
  );
  bottomToggle.addEventListener("click", () => setBottom(!bottomOpen));
  bottom.append(bottomList, bottomToggle);

  nav.append(logo, quick, form, searchButton, scroll, bottom);

  function setBottom(open: boolean): void {
    bottomOpen = open;
    bottomList.hidden = !open;
    bottomToggle.setAttribute("aria-expanded", String(open));
  }

  function setCollapsed(next: boolean, notify = false): void {
    const changed = next !== collapsed;
    collapsed = next;
    nav.dataset.collapsed = String(next);
    const name = next ? "Expand sidebar" : "Collapse sidebar";
    toggle.setAttribute("aria-label", name);
    toggle.title = name;
    toggle.setAttribute("aria-expanded", String(!next));
    // Collapsed items show only an icon, and a long label is cut when open, so each item always
    // carries its full name as a tooltip.
    for (const a of nav.querySelectorAll<HTMLAnchorElement>("a[data-label]"))
      a.title = a.dataset.label ?? "";
    for (const b of [bottomToggle, searchButton])
      if (next) b.title = b.textContent?.trim() ?? "";
      else b.removeAttribute("title");
    if (changed && notify) options.onToggle?.(next);
  }

  toggle.addEventListener("click", () => setCollapsed(!collapsed, true));
  setBottom(options.bottomOpen ?? false);
  setCollapsed(collapsed);

  return {
    element: nav,
    setCurrent(id) {
      for (const a of nav.querySelectorAll<HTMLAnchorElement>("a[data-item]")) {
        if (a.dataset.item === id) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
      if (options.bottom.items.some((item) => item.id === id)) setBottom(true);
    },
    setCollapsed: (next) => setCollapsed(next),
    isCollapsed: () => collapsed,
  };
}
