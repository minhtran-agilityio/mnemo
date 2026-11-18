// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { ALL_ITEMS, APPS_ITEMS, GROUPS } from "./nav";
import {
  createSidebar,
  createSidebarFromSaved,
  readCollapsed,
  type Sidebar,
} from "./sidebar";

let toggled: boolean[];
let searched: string[];
let sidebar: Sidebar;

function build(collapsed = false): Sidebar {
  toggled = [];
  searched = [];
  document.body.replaceChildren();
  sidebar = createSidebar(document, {
    collapsed,
    onToggle: (value) => toggled.push(value),
    onSearch: (text) => searched.push(text),
  });
  document.body.append(sidebar.element);
  return sidebar;
}
beforeEach(() => build());

const names = (el: ParentNode) =>
  [...el.querySelectorAll("a, button")].map((e) =>
    (e.getAttribute("aria-label") ?? e.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  );
const toggle = () =>
  document.querySelector<HTMLButtonElement>(
    "button.sbmini",
  ) as HTMLButtonElement;

test("the top is the logo with a toggle, then Save or ask, then the search box", () => {
  const order = [...sidebar.element.children].map((c) => c.className);
  expect(order.slice(0, 3)).toEqual(["sb-logo", "sb-quick", "sbsearch"]);
  expect(sidebar.element.querySelector(".sb-name")?.textContent).toBe("Mnemo");
  expect(sidebar.element.querySelector("a.sb-quick")?.textContent).toBe(
    "Save or ask",
  );
  const input = sidebar.element.querySelector("input");
  expect(input?.placeholder).toBe("Search everything");
  expect(sidebar.element.querySelector("label")?.textContent).toBe(
    "Search everything",
  );
});

test("every item is a link with its name, and there is no Tags group, count or badge", () => {
  const all = names(sidebar.element);
  for (const item of ALL_ITEMS)
    expect(all.some((n) => n.startsWith(item.label))).toBe(true);
  expect(sidebar.element.querySelectorAll(".sb-label").length).toBe(
    GROUPS.length,
  );
  expect(sidebar.element.textContent).not.toMatch(/tags/i);
  expect(sidebar.element.textContent).not.toMatch(/\d/);
  expect(
    sidebar.element.querySelector("[class*=badge], [class*=cnt]"),
  ).toBeNull();
  for (const a of sidebar.element.querySelectorAll("a[data-item]"))
    expect(a.getAttribute("href")).toBe(`#/${(a as HTMLElement).dataset.item}`);
});

test("Later items carry a Later mark in their name and others do not", () => {
  const all = names(sidebar.element);
  expect(all).toContain("Files (PDF) Later");
  expect(all).toContain("Videos Later");
  expect(all).toContain("Today");
  expect(all.filter((n) => /\bLater\b/.test(n)).length).toBe(3);
});

test("the toggle collapses and opens the sidebar and says what it will do", () => {
  const t = toggle();
  expect(t.tagName).toBe("BUTTON");
  expect(t.getAttribute("aria-expanded")).toBe("true");
  expect(t.getAttribute("aria-label")).toBe("Collapse sidebar");
  t.click();
  expect(sidebar.isCollapsed()).toBe(true);
  expect(sidebar.element.dataset.collapsed).toBe("true");
  expect(t.getAttribute("aria-expanded")).toBe("false");
  expect(t.getAttribute("aria-label")).toBe("Expand sidebar");
  t.click();
  expect(sidebar.isCollapsed()).toBe(false);
  expect(toggled).toEqual([true, false]);
});

test("collapsed icons keep their name, and get it as a tooltip", () => {
  build(true);
  expect(sidebar.isCollapsed()).toBe(true);
  expect(toggled).toEqual([]);
  for (const a of sidebar.element.querySelectorAll<HTMLAnchorElement>(
    "a[data-item]",
  )) {
    expect(a.textContent?.trim()).toBeTruthy();
    expect(a.title).toBe(a.dataset.label);
  }
  expect(sidebar.element.querySelector("a[data-item=today]")?.textContent).toBe(
    "Today",
  );
  build(false);
  expect(
    sidebar.element.querySelector("a[data-item=today]")?.hasAttribute("title"),
  ).toBe(false);
});

test("a collapsed Later item keeps its Later status in the tooltip", () => {
  build(true);
  const videos = sidebar.element.querySelector<HTMLAnchorElement>(
    "a[data-item=videos]",
  );
  expect(videos?.title).toBe("Videos (Later)");
  expect(
    sidebar.element.querySelector<HTMLAnchorElement>("a[data-item=today]")
      ?.title,
  ).toBe("Today");
});

test("setCollapsed changes the look without telling the caller", () => {
  sidebar.setCollapsed(true);
  expect(sidebar.isCollapsed()).toBe(true);
  expect(toggled).toEqual([]);
});

test("Enter in the search box sends the word; the search button opens a collapsed sidebar", () => {
  const input = sidebar.element.querySelector("input") as HTMLInputElement;
  input.value = "zebra";
  (sidebar.element.querySelector("form") as HTMLFormElement).dispatchEvent(
    new Event("submit", { cancelable: true }),
  );
  expect(searched).toEqual(["zebra"]);
  sidebar.setCollapsed(true);
  const focus = vi.spyOn(input, "focus");
  (sidebar.element.querySelector(".sbsearchbtn") as HTMLButtonElement).click();
  expect(sidebar.isCollapsed()).toBe(false);
  expect(focus).toHaveBeenCalled();
  expect(toggled).toEqual([false]);
});

test("Apps and settings is the last control, starts closed and opens and closes its list", () => {
  const apps = sidebar.element.querySelector<HTMLButtonElement>(
    "button.sbtog",
  ) as HTMLButtonElement;
  const list = sidebar.element.querySelector<HTMLElement>(
    "#sidebar-apps",
  ) as HTMLElement;
  expect(sidebar.element.lastElementChild?.lastElementChild).toBe(apps);
  expect(apps.textContent).toBe("Apps and settings");
  expect(apps.getAttribute("aria-controls")).toBe("sidebar-apps");
  expect(list.hidden).toBe(true);
  expect(apps.getAttribute("aria-expanded")).toBe("false");
  apps.click();
  expect(list.hidden).toBe(false);
  expect(apps.getAttribute("aria-expanded")).toBe("true");
  expect(names(list)).toEqual(APPS_ITEMS.map((i) => i.label));
  apps.click();
  expect(list.hidden).toBe(true);
});

test("setCurrent marks one item as the current page and opens the list for an apps item", () => {
  sidebar.setCurrent("notes");
  expect(document.querySelectorAll("[aria-current=page]").length).toBe(1);
  expect(document.querySelector("[aria-current=page]")?.textContent).toBe(
    "Notes",
  );
  sidebar.setCurrent("settings");
  expect(document.querySelector("[aria-current=page]")?.textContent).toBe(
    "Settings",
  );
  expect((document.querySelector("#sidebar-apps") as HTMLElement).hidden).toBe(
    false,
  );
});

test("a saved collapsed state is applied when the sidebar is built, never open first", async () => {
  document.body.replaceChildren();
  const bar = await createSidebarFromSaved(document, async () => true, {
    onToggle: () => {},
    onSearch: () => {},
  });
  expect(bar.element.dataset.collapsed).toBe("true");
  expect(bar.isCollapsed()).toBe(true);
});

test("a slow read still gives the saved value, with no false error", async () => {
  vi.useFakeTimers();
  try {
    const errors: unknown[] = [];
    const result = readCollapsed(
      () => new Promise((resolve) => setTimeout(() => resolve("true"), 5000)),
      (e) => errors.push(e),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("a failed read gives an open sidebar and reports the error", async () => {
  const errors: unknown[] = [];
  const failure = new Error("boom");
  const result = await readCollapsed(
    () => Promise.reject(failure),
    (e) => errors.push(e),
  );
  expect(result).toBe(false);
  expect(errors).toEqual([failure]);
});
