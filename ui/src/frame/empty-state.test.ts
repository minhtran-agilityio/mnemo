// @vitest-environment happy-dom
import { beforeEach, expect, test } from "vitest";
import { renderEmptyState } from "./empty-state";
import { ALL_ITEMS, EVERYTHING_ID, findItem, type NavItem } from "./nav";

let main: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  main = document.createElement("main");
  document.body.append(main);
});

const open = (id: string, query: string | null = null) =>
  renderEmptyState(main, { item: findItem(id) as NavItem, query });

test("every item shows its name and its phase", () => {
  for (const item of ALL_ITEMS) {
    open(item.id);
    expect(main.querySelector("h1")?.textContent).toBe(item.label);
    expect(main.textContent).toContain(`Phase ${item.phase}`);
  }
});

test("Later items say Later and share one empty state apart from the name", () => {
  open("files");
  const files = main.textContent?.replace("Files (PDF)", "X");
  open("videos");
  const videos = main.textContent?.replace("Videos", "X");
  expect(files).toContain("Later");
  expect(files).toBe(videos);
  open("notes");
  expect(main.textContent).not.toContain("Later");
});

test("the searched word is shown as text, never as markup", () => {
  const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
  open(EVERYTHING_ID, evil);
  expect(main.textContent).toContain(evil);
  expect(main.querySelectorAll("img, b").length).toBe(0);
  expect(main.querySelector("strong")?.textContent).toBe(evil);
});

test("Everything without a search shows no search line, and a new screen replaces the old one", () => {
  open(EVERYTHING_ID);
  expect(main.querySelector(".empty-query")).toBeNull();
  open(EVERYTHING_ID, "zebra");
  open("today");
  expect(main.querySelectorAll("section").length).toBe(1);
  expect(main.textContent).not.toContain("zebra");
});
