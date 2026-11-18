// The sidebar: logo with a collapse toggle, Save or ask, the search box, the groups, and
// "Apps and settings" pinned at the bottom. It is plain DOM built with createElement, so no
// text from outside ever becomes markup. It holds no data of its own: the caller passes
// the collapsed state in and hears about changes.
import {
  APPS_ITEMS,
  APPS_LABEL,
  GROUPS,
  hashItemPath,
  type IconShape,
  type NavItem,
  SAVE_OR_ASK,
} from "./nav";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface SidebarOptions {
  collapsed: boolean;
  /** Called after the owner opens or collapses the sidebar. */
  onToggle(collapsed: boolean): void;
  /** Called when the owner presses Enter in the search box. */
  onSearch(text: string): void;
}

export interface Sidebar {
  element: HTMLElement;
  /** Marks the item for `id` as the current screen. */
  setCurrent(id: string): void;
  setCollapsed(collapsed: boolean): void;
  isCollapsed(): boolean;
}

function icon(
  doc: Document,
  shapes: readonly IconShape[],
  size = 18,
): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  }))
    svg.setAttribute(name, value);
  for (const [tag, attrs] of shapes) {
    const shape = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs))
      shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

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
  item: NavItem,
  className: string,
): HTMLAnchorElement {
  const a = make(doc, "a", className);
  a.href = hashItemPath(item.id);
  a.dataset.item = item.id;
  // The collapsed tooltip is this text, so a Later item keeps its Later status there.
  a.dataset.label = item.later ? `${item.label} (Later)` : item.label;
  a.append(icon(doc, item.icon), make(doc, "span", "sb-text", item.label));
  if (item.later) {
    // A real space keeps the accessible name readable: "Videos Later".
    a.append(" ", make(doc, "span", "navlater", "Later"));
  }
  return a;
}

export function createSidebar(doc: Document, options: SidebarOptions): Sidebar {
  let collapsed = options.collapsed;
  let appsOpen = false;

  const nav = make(doc, "nav", "sidebar");
  nav.setAttribute("aria-label", "Main");

  // Logo and collapse toggle.
  const logo = make(doc, "div", "sb-logo");
  const mark = make(doc, "span", "logo-mark", "M");
  mark.setAttribute("aria-hidden", "true");
  const toggle = make(doc, "button", "sbmini");
  toggle.type = "button";
  const arrow = doc.createElementNS(SVG_NS, "path");
  arrow.setAttribute("d", "M15.5 10l-2 2 2 2");
  arrow.setAttribute("class", "sbarr");
  const toggleIcon = icon(doc, [
    ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }],
    ["path", { d: "M9 4v16" }],
  ]);
  toggleIcon.append(arrow);
  toggle.append(toggleIcon);
  logo.append(mark, make(doc, "span", "sb-name", "Mnemo"), toggle);

  // Save or ask.
  const quick = link(doc, SAVE_OR_ASK, "sb-quick");

  // Search: a form with a real label. Enter submits it.
  const form = make(doc, "form", "sbsearch");
  form.setAttribute("role", "search");
  const label = make(doc, "label", "sb-sr", "Search everything");
  label.htmlFor = "sidebar-search";
  const input = make(doc, "input", "input sbq");
  input.id = "sidebar-search";
  input.type = "search";
  input.autocomplete = "off";
  input.placeholder = "Search everything";
  form.append(
    label,
    icon(doc, [
      ["circle", { cx: "11", cy: "11", r: "7" }],
      ["path", { d: "M21 21l-4.3-4.3" }],
    ]),
    input,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    options.onSearch(input.value);
  });
  // With the sidebar collapsed the box is hidden; this button opens it and focuses the box.
  const searchButton = make(doc, "button", "navb sbsearchbtn");
  searchButton.type = "button";
  searchButton.append(
    icon(doc, [
      ["circle", { cx: "11", cy: "11", r: "7" }],
      ["path", { d: "M21 21l-4.3-4.3" }],
    ]),
    make(doc, "span", "sb-text", "Search everything"),
  );
  searchButton.addEventListener("click", () => {
    setCollapsed(false, true);
    input.focus();
  });

  // The groups.
  const scroll = make(doc, "div", "sb-scroll");
  for (const group of GROUPS) {
    const heading = make(doc, "h2", "sb-label", group.label);
    heading.id = `sb-group-${group.id}`;
    const list = make(doc, "ul", "sidenav");
    list.setAttribute("aria-labelledby", heading.id);
    for (const item of group.items) {
      const li = make(doc, "li");
      li.append(link(doc, item, "navb"));
      list.append(li);
    }
    scroll.append(heading, list);
  }

  // Apps and settings, pinned at the bottom. The list sits above its button, so the
  // button stays at the bottom when the list opens.
  const bottom = make(doc, "div", "sidebot");
  const appsList = make(doc, "ul", "sbbotlist");
  appsList.id = "sidebar-apps";
  appsList.hidden = true;
  for (const item of APPS_ITEMS) {
    const li = make(doc, "li");
    li.append(link(doc, item, "navb"));
    appsList.append(li);
  }
  const appsToggle = make(doc, "button", "navb sbtog");
  appsToggle.type = "button";
  appsToggle.setAttribute("aria-controls", appsList.id);
  const chevron = icon(doc, [["path", { d: "M6 9l6 6 6-6" }]], 16);
  chevron.classList.add("sbchev");
  appsToggle.append(
    icon(doc, APPS_ITEMS[0]?.icon ?? []),
    make(doc, "span", "sb-text", APPS_LABEL),
    chevron,
  );
  appsToggle.addEventListener("click", () => setApps(!appsOpen));
  bottom.append(appsList, appsToggle);

  nav.append(logo, quick, form, searchButton, scroll, bottom);

  function setApps(open: boolean): void {
    appsOpen = open;
    appsList.hidden = !open;
    appsToggle.setAttribute("aria-expanded", String(open));
  }

  function setCollapsed(next: boolean, notify = false): void {
    const changed = next !== collapsed;
    collapsed = next;
    nav.dataset.collapsed = String(next);
    const name = next ? "Expand sidebar" : "Collapse sidebar";
    toggle.setAttribute("aria-label", name);
    toggle.title = name;
    toggle.setAttribute("aria-expanded", String(!next));
    // Collapsed items show only an icon, so each one gets its name as a tooltip.
    for (const a of nav.querySelectorAll<HTMLAnchorElement>("a[data-label]"))
      if (next) a.title = a.dataset.label ?? "";
      else a.removeAttribute("title");
    for (const b of [appsToggle, searchButton])
      if (next) b.title = b.textContent?.trim() ?? "";
      else b.removeAttribute("title");
    if (changed && notify) options.onToggle(next);
  }

  toggle.addEventListener("click", () => setCollapsed(!collapsed, true));
  setApps(false);
  setCollapsed(collapsed);

  return {
    element: nav,
    setCurrent(id) {
      for (const a of nav.querySelectorAll<HTMLAnchorElement>("a[data-item]")) {
        if (a.dataset.item === id) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
      if (APPS_ITEMS.some((item) => item.id === id)) setApps(true);
    },
    setCollapsed: (next) => setCollapsed(next),
    isCollapsed: () => collapsed,
  };
}

/**
 * Builds the sidebar after the saved collapsed state is known, so a collapsed sidebar
 * is collapsed from its first paint and never shows open first.
 */
export async function createSidebarFromSaved(
  doc: Document,
  loadCollapsed: () => Promise<boolean>,
  options: Omit<SidebarOptions, "collapsed">,
): Promise<Sidebar> {
  return createSidebar(doc, { ...options, collapsed: await loadCollapsed() });
}

/**
 * The saved collapsed state from a read of the setting. It waits for the read as long as
 * it takes, so a slow read still gives the saved value. Only a failed read gives an open
 * sidebar, and `onError` hears about it so the owner can see a line.
 */
export async function readCollapsed(
  read: () => Promise<string | null>,
  onError: (error: unknown) => void,
): Promise<boolean> {
  try {
    return (await read()) === "true";
  } catch (error) {
    onError(error);
    return false;
  }
}
