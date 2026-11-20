// The app's sidebar: the nav items of ./nav handed to the sidebar part of the design system
// (ui/src/ds, createSidebar). This file maps the data and keeps the start-up helpers; the look and
// the behaviour live in the part. It holds no data of its own: the caller passes the collapsed
// state in and hears about changes.
import type { IconNode } from "lucide";
import {
  createSidebar as createSidebarPart,
  type Sidebar,
  type SidebarLink,
} from "../ds";
import {
  APPS_ITEMS,
  APPS_LABEL,
  GROUPS,
  hashItemPath,
  type IconShape,
  type NavItem,
  SAVE_OR_ASK,
} from "./nav";

export type { Sidebar };

export interface SidebarOptions {
  collapsed: boolean;
  /** Called after the owner opens or collapses the sidebar. */
  onToggle(collapsed: boolean): void;
  /** Called when the owner presses Enter in the search box. */
  onSearch(text: string): void;
}

/** The nav icon shapes as a Lucide icon node, which the icon helper draws. */
function iconNode(shapes: readonly IconShape[]): IconNode {
  return shapes.map(([tag, attrs]) => [tag, { ...attrs }]);
}

function toLink(item: NavItem): SidebarLink {
  return {
    id: item.id,
    label: item.label,
    href: hashItemPath(item.id),
    icon: iconNode(item.icon),
    later: item.later,
  };
}

export function createSidebar(doc: Document, options: SidebarOptions): Sidebar {
  const sidebar = createSidebarPart(doc, {
    label: "Main",
    brand: "Mnemo",
    brandMark: "M",
    quick: toLink(SAVE_OR_ASK),
    searchLabel: "Search everything",
    groups: GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      items: group.items.map(toLink),
    })),
    bottom: {
      label: APPS_LABEL,
      icon: iconNode(APPS_ITEMS[0]?.icon ?? []),
      items: APPS_ITEMS.map(toLink),
    },
    collapsed: options.collapsed,
    onToggle: options.onToggle,
    onSearch: options.onSearch,
  });
  // The frame's layout class: it keeps the sidebar in view, as high as the window.
  sidebar.element.classList.add("app-sidebar");
  return sidebar;
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

/** How long start-up waits for the saved sidebar state before it shows the sidebar open. */
export const READ_LIMIT_MS = 10_000;

/** The error `readCollapsed` reports when the read takes longer than its limit. */
export class ReadTimeoutError extends Error {
  constructor(limitMs: number) {
    super(`The saved setting did not load within ${limitMs / 1000} seconds.`);
    this.name = "ReadTimeoutError";
  }
}

/**
 * The saved collapsed state from a read of the setting. A slow read still gives the saved
 * value, up to `limitMs`. A failed read, or one that takes longer than `limitMs`, gives an
 * open sidebar, and `onError` hears about it so the owner can see a line. Start-up never
 * waits forever on a stuck read.
 */
export async function readCollapsed(
  read: () => Promise<string | null>,
  onError: (error: unknown) => void,
  limitMs: number = READ_LIMIT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReadTimeoutError(limitMs)), limitMs);
  });
  try {
    return (await Promise.race([read(), limit])) === "true";
  } catch (error) {
    onError(error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
