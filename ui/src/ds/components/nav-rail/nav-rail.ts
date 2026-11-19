// Nav rail sample: the shape of the app's side menu, open and collapsed. Groups, a current item,
// a "Later" mark on planned items, no counts and no badges. The app's own sidebar is in ui/src/frame.
import { type IconNode, PanelLeft } from "lucide";
import { createIcon } from "../../icon";
import { el, uid } from "../surface-dom";
import "./nav-rail.css";

export interface NavRailItem {
  id: string;
  label: string;
  icon: IconNode;
  /** Planned for later: shows a "Later" mark. */
  later?: boolean;
  /** Draws the hover look, for the catalog. Live hover works as well. */
  hover?: boolean;
}

export interface NavRailGroup {
  label: string;
  items: readonly NavRailItem[];
}

export interface NavRailOptions {
  /** Names the nav landmark. */
  label: string;
  brand?: string;
  groups: readonly NavRailGroup[];
  collapsed?: boolean;
  /** The id of the current item. */
  current?: string;
  onSelect?(id: string): void;
  onToggle?(collapsed: boolean): void;
  doc?: Document;
}

export interface NavRail {
  element: HTMLElement;
  setCollapsed(collapsed: boolean): void;
  isCollapsed(): boolean;
  setCurrent(id: string): void;
}

export function createNavRail(options: NavRailOptions): NavRail {
  const doc = options.doc ?? document;
  const rail = el(doc, "nav", "rail");
  rail.id = uid("rail");
  rail.setAttribute("aria-label", options.label);
  let collapsed = options.collapsed ?? false;

  const top = el(doc, "div", "rail-top");
  const brand = el(doc, "span", "rail-brand", options.brand ?? "Mnemo");
  const toggle = el(doc, "button", "rail-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-controls", rail.id);
  toggle.append(createIcon(PanelLeft, "md"));
  top.append(brand, toggle);
  rail.append(top);

  const buttons = new Map<string, HTMLButtonElement>();
  const items = new Map<string, NavRailItem>();
  for (const group of options.groups) {
    rail.append(el(doc, "div", "rail-label", group.label));
    rail.append(el(doc, "hr", "rail-sep"));
    for (const item of group.items) {
      const button = el(doc, "button", "navb");
      button.type = "button";
      if (item.later) button.classList.add("later");
      if (item.hover) button.classList.add("is-hover");
      button.title = item.later
        ? `${item.label}, planned for later`
        : item.label;
      button.append(
        createIcon(item.icon, "md"),
        el(doc, "span", "txt", item.label),
      );
      if (item.later) button.append(el(doc, "span", "navlater", "Later"));
      button.addEventListener("click", () => {
        setCurrent(item.id);
        options.onSelect?.(item.id);
      });
      buttons.set(item.id, button);
      items.set(item.id, item);
      rail.append(button);
    }
  }

  function setCurrent(id: string) {
    for (const [key, button] of buttons) {
      if (key === id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  const paint = () => {
    rail.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute(
      "aria-label",
      collapsed ? "Expand menu" : "Collapse menu",
    );
    // A collapsed button shows only an icon, so its name must be an attribute.
    for (const [id, button] of buttons) {
      const item = items.get(id);
      if (collapsed && item)
        button.setAttribute(
          "aria-label",
          item.later ? `${item.label}, planned for later` : item.label,
        );
      else button.removeAttribute("aria-label");
    }
  };
  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    paint();
    options.onToggle?.(collapsed);
  });

  if (options.current) setCurrent(options.current);
  paint();
  return {
    element: rail,
    setCollapsed(next) {
      collapsed = next;
      paint();
    },
    isCollapsed: () => collapsed,
    setCurrent,
  };
}
