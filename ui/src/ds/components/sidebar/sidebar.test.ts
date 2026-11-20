// @vitest-environment happy-dom
import { Bookmark, Settings, StickyNote, Video } from "lucide";
import { beforeEach, expect, test, vi } from "vitest";
import { createSidebar, type Sidebar, type SidebarOptions } from "./sidebar";

let toggled: boolean[];
let searched: string[];
let sidebar: Sidebar;

const link = (id: string, label: string, extra = {}) => ({
  id,
  label,
  href: `#/${id}`,
  icon: Bookmark,
  ...extra,
});

function options(extra: Partial<SidebarOptions> = {}): SidebarOptions {
  return {
    label: "Main",
    brand: "Mnemo",
    brandMark: "M",
    quick: link("save", "Save or ask"),
    searchLabel: "Search everything",
    groups: [
      {
        id: "library",
        label: "Library",
        items: [
          link("bookmarks", "Bookmarks"),
          link("notes", "Notes", { icon: StickyNote }),
          link("videos", "Videos", { icon: Video, later: true }),
        ],
      },
    ],
    bottom: {
      label: "Apps and settings",
      icon: Settings,
      items: [link("settings", "Settings", { icon: Settings })],
    },
    collapsed: false,
    onToggle: (v) => toggled.push(v),
    onSearch: (t) => searched.push(t),
    ...extra,
  };
}

function build(extra: Partial<SidebarOptions> = {}): Sidebar {
  toggled = [];
  searched = [];
  document.body.replaceChildren();
  sidebar = createSidebar(document, options(extra));
  document.body.append(sidebar.element);
  return sidebar;
}
beforeEach(() => build());

const q = <T extends Element = HTMLElement>(sel: string) =>
  sidebar.element.querySelector<T>(sel) as T;

test("it is a labelled nav: logo with a toggle, the quick link, the search form, the groups, the bottom list", () => {
  expect(sidebar.element.tagName).toBe("NAV");
  expect(sidebar.element.getAttribute("aria-label")).toBe("Main");
  expect([...sidebar.element.children].map((c) => c.className)).toEqual([
    "sidebar-logo",
    "sidebar-quick",
    "sidebar-search",
    "sidebar-item sidebar-search-button",
    "sidebar-scroll",
    "sidebar-bottom",
  ]);
  expect(q(".sidebar-name").textContent).toBe("Mnemo");
  expect(q(".sidebar-mark").getAttribute("aria-hidden")).toBe("true");
  expect(q<HTMLAnchorElement>("a.sidebar-quick").getAttribute("href")).toBe(
    "#/save",
  );
});

test("the search box has a real label, and Enter sends the word", () => {
  const input = q<HTMLInputElement>("input");
  expect(input.id).toBe("sidebar-search");
  expect(q("label").getAttribute("for")).toBe("sidebar-search");
  expect(q("label").textContent).toBe("Search everything");
  expect(input.classList.contains("input")).toBe(true);
  input.value = "zebra";
  q("form").dispatchEvent(new Event("submit", { cancelable: true }));
  expect(searched).toEqual(["zebra"]);
});

test("each group is a heading and a list named by it; icons are decorative and nav sized", () => {
  const heading = q("h2.sidebar-label");
  expect(heading.textContent).toBe("Library");
  expect(q("ul.sidebar-list").getAttribute("aria-labelledby")).toBe(heading.id);
  const icon = q<SVGElement>("a[data-item=bookmarks] svg");
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  expect(icon.style.width).toBe("var(--icon-nav)");
});

test("a Later item carries the Later mark in its name, and no item has a count or badge", () => {
  expect(q("a[data-item=videos]").textContent).toBe("Videos Later");
  expect(q("a[data-item=videos] .later-mark")).not.toBeNull();
  expect(q("a[data-item=notes] .later-mark")).toBeNull();
  expect(sidebar.element.textContent).not.toMatch(/\d/);
  expect(
    sidebar.element.querySelector("[class*=badge], [class*=count]"),
  ).toBeNull();
});

test("the toggle collapses and opens, says what it will do, and tells the caller", () => {
  const t = q<HTMLButtonElement>("button.sidebar-toggle");
  expect(t.getAttribute("aria-label")).toBe("Collapse sidebar");
  expect(t.getAttribute("aria-expanded")).toBe("true");
  t.click();
  expect(sidebar.isCollapsed()).toBe(true);
  expect(sidebar.element.dataset.collapsed).toBe("true");
  expect(t.getAttribute("aria-label")).toBe("Expand sidebar");
  expect(t.title).toBe("Expand sidebar");
  t.click();
  expect(toggled).toEqual([true, false]);
});

test("every item keeps its full name as a tooltip, collapsed or open, Later included", () => {
  build({ collapsed: true });
  expect(q<HTMLAnchorElement>("a[data-item=notes]").title).toBe("Notes");
  expect(q<HTMLAnchorElement>("a[data-item=videos]").title).toBe(
    "Videos (Later)",
  );
  expect(q<HTMLButtonElement>(".sidebar-bottom-toggle").title).toBe(
    "Apps and settings",
  );
  sidebar.setCollapsed(false);
  // Open, a long label ends in an ellipsis, so the full name stays as the title.
  expect(q<HTMLAnchorElement>("a[data-item=notes]").title).toBe("Notes");
  expect(q<HTMLAnchorElement>("a[data-item=videos]").title).toBe(
    "Videos (Later)",
  );
  expect(toggled).toEqual([]);
});

test("the collapsed search button opens the sidebar and focuses the box", () => {
  build({ collapsed: true });
  const input = q<HTMLInputElement>("input");
  const focus = vi.spyOn(input, "focus");
  q<HTMLButtonElement>(".sidebar-search-button").click();
  expect(sidebar.isCollapsed()).toBe(false);
  expect(focus).toHaveBeenCalled();
  expect(toggled).toEqual([false]);
});

test("the bottom list starts closed, opens and closes, and opens for a current bottom item", () => {
  const toggle = q<HTMLButtonElement>("button.sidebar-bottom-toggle");
  const list = q<HTMLElement>("#sidebar-apps");
  expect(toggle.getAttribute("aria-controls")).toBe("sidebar-apps");
  expect(sidebar.element.lastElementChild?.lastElementChild).toBe(toggle);
  expect(list.hidden).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  toggle.click();
  expect(list.hidden).toBe(false);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  toggle.click();
  expect(list.hidden).toBe(true);
  sidebar.setCurrent("settings");
  expect(list.hidden).toBe(false);
  expect(build({ bottomOpen: true }) && q("#sidebar-apps").hidden).toBe(false);
});

test("setCurrent marks exactly one item as the current page", () => {
  sidebar.setCurrent("notes");
  expect(sidebar.element.querySelectorAll("[aria-current=page]").length).toBe(
    1,
  );
  expect(q("[aria-current=page]").textContent).toBe("Notes");
});

test("idPrefix keeps the ids of two sidebars apart", () => {
  const other = createSidebar(document, options({ idPrefix: "cat-sb" }));
  expect(other.element.querySelector("input")?.id).toBe("cat-sb-search");
  expect(other.element.querySelector("ul.sidebar-bottom-list")?.id).toBe(
    "cat-sb-apps",
  );
  expect(other.element.querySelector("h2")?.id).toBe("cat-sb-group-library");
});

test("a forced state draws hover or focus for the UI Catalog", () => {
  build({
    groups: [
      {
        id: "g",
        label: "G",
        items: [link("a", "A", { forceState: "hover" })],
      },
    ],
  });
  expect(q("a[data-item=a]").classList.contains("is-hover")).toBe(true);
});

test("labels go in as text, and a long label stays whole in the name", () => {
  const long = "<b>Quiet notifications from every connected app</b>";
  build({
    groups: [{ id: "g", label: "G", items: [link("a", long)] }],
  });
  expect(sidebar.element.querySelector("b")).toBeNull();
  expect(q("a[data-item=a]").textContent).toBe(long);
});
