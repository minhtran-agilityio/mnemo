import { expect, test } from "vitest";
import { ALL_ITEMS, APPS_ITEMS, findItem, GROUPS, SAVE_OR_ASK } from "./nav";

const labels = (id: string) =>
  GROUPS.find((g) => g.id === id)?.items.map((i) => i.label);

test("the groups and items match the ticket", () => {
  expect(GROUPS.map((g) => g.label)).toEqual([
    "Daily",
    "Library",
    "Life",
    "Knowledge",
    "Agents",
  ]);
  expect(labels("daily")).toEqual([
    "Today",
    "Ask Mnemo",
    "Calendar",
    "Daily digest",
    "Goals",
    "Trending",
  ]);
  expect(labels("library")).toEqual([
    "Bookmarks",
    "Deep research",
    "Notes",
    "Ideas",
    "Projects",
    "Files (PDF)",
    "Videos",
    "Shared",
    "Learning",
    "Everything",
  ]);
  expect(labels("life")).toEqual(["Workout", "Diary"]);
  expect(labels("knowledge")).toEqual(["About me", "Graph"]);
  expect(labels("agents")).toEqual([
    "Background runs",
    "Needs approval",
    "Mnemo memory",
    "Daily report",
    "Quiet notifications",
  ]);
  expect(APPS_ITEMS.map((i) => i.label)).toEqual([
    "Apps and account",
    "AI control",
    "Settings",
  ]);
});

test("every item has a unique id, a phase and an icon", () => {
  const ids = ALL_ITEMS.map((i) => i.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const item of ALL_ITEMS) {
    expect(Number.isInteger(item.phase) && item.phase >= 1).toBe(true);
    expect(item.icon.length).toBeGreaterThan(0);
    expect(findItem(item.id)).toBe(item);
  }
  expect(ALL_ITEMS).toContain(SAVE_OR_ASK);
});

test("Files (PDF), Videos and Shared are the Later items, and nothing else is", () => {
  const later = ALL_ITEMS.filter((i) => i.later).map((i) => i.label);
  expect(later).toEqual(["Files (PDF)", "Videos", "Shared"]);
});

test("there is no Tags group and no count or badge in the data", () => {
  expect(JSON.stringify(GROUPS).toLowerCase()).not.toContain('"tags"');
  for (const item of ALL_ITEMS)
    expect(Object.keys(item).sort()).toEqual(
      ["icon", "id", "label", "phase", ...(item.later ? ["later"] : [])].sort(),
    );
});
