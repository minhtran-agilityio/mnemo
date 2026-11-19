// @vitest-environment happy-dom

import { Bookmark, FileText } from "lucide";
import { expect, test, vi } from "vitest";
import { createNavRail } from "./nav-rail";

const make = (collapsed = false) =>
  createNavRail({
    label: "Main",
    collapsed,
    current: "bm",
    groups: [
      {
        label: "Library",
        items: [
          { id: "bm", label: "Bookmarks", icon: Bookmark },
          { id: "files", label: "Files (PDF)", icon: FileText, later: true },
        ],
      },
    ],
  });

test("it is a labelled nav with groups, a current item and a Later mark", () => {
  const rail = make().element;
  expect(rail.tagName).toBe("NAV");
  expect(rail.getAttribute("aria-label")).toBe("Main");
  expect(rail.querySelector(".rail-label")?.textContent).toBe("Library");
  expect(rail.querySelector('[aria-current="page"]')?.textContent).toBe(
    "Bookmarks",
  );
  expect(rail.querySelector(".navlater")?.textContent).toBe("Later");
});

test("it has no counts and no badges", () => {
  const rail = make().element;
  expect(rail.querySelector(".cnt, .badge, .count")).toBeNull();
});

test("the toggle folds the rail, says so in aria, and names the icon-only buttons", () => {
  const onToggle = vi.fn();
  const r = createNavRail({
    label: "Main",
    onToggle,
    groups: [
      {
        label: "L",
        items: [{ id: "f", label: "Files", icon: FileText, later: true }],
      },
    ],
  });
  const toggle = r.element.querySelector(".rail-toggle") as HTMLButtonElement;
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.getAttribute("aria-label")).toBe("Collapse menu");
  toggle.click();
  expect(r.isCollapsed()).toBe(true);
  expect(r.element.classList.contains("collapsed")).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.getAttribute("aria-label")).toBe("Expand menu");
  expect(r.element.querySelector(".navb")?.getAttribute("aria-label")).toBe(
    "Files, planned for later",
  );
  expect(onToggle).toHaveBeenCalledWith(true);
  toggle.click();
  expect(r.element.querySelector(".navb")?.hasAttribute("aria-label")).toBe(
    false,
  );
});

test("a click moves the current mark and reports the id", () => {
  const onSelect = vi.fn();
  const r = createNavRail({
    label: "Main",
    onSelect,
    groups: [
      {
        label: "L",
        items: [
          { id: "a", label: "A", icon: Bookmark },
          { id: "b", label: "B", icon: Bookmark },
        ],
      },
    ],
  });
  (r.element.querySelectorAll(".navb")[1] as HTMLButtonElement).click();
  expect(r.element.querySelector('[aria-current="page"]')?.textContent).toBe(
    "B",
  );
  expect(onSelect).toHaveBeenCalledWith("b");
});

test("it can start collapsed", () => {
  expect(make(true).element.classList.contains("collapsed")).toBe(true);
});
