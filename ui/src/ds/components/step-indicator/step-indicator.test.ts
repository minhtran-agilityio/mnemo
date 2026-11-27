// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createStepIndicator } from "./step-indicator";

const STEPS = ["Pick a file", "Check", "Import", "Done"];
const make = (current: number, steps = STEPS) =>
  createStepIndicator(document, { label: "Import steps", steps, current });
const items = (list: HTMLElement) => [...list.querySelectorAll("li")];

test("it is an ordered list with an accessible name", () => {
  const list = make(3);
  expect(list.tagName).toBe("OL");
  expect(list.getAttribute("aria-label")).toBe("Import steps");
  expect(items(list)).toHaveLength(4);
});

test("earlier steps are done, the current one is marked, later ones are to come", () => {
  const list = items(make(3));
  expect(list.map((li) => li.className)).toEqual([
    "steps-item steps-done",
    "steps-item steps-done",
    "steps-item steps-current",
    "steps-item steps-todo",
  ]);
  expect(list.map((li) => li.getAttribute("aria-current"))).toEqual([
    null,
    null,
    "step",
    null,
  ]);
});

test("each state is also text for screen readers, with number and label", () => {
  const list = items(make(3));
  expect(list[0]?.textContent).toBe("1Pick a file (step 1 of 4, done)");
  expect(list[2]?.textContent).toBe("3Import (step 3 of 4, current step)");
  expect(list[3]?.textContent).toBe("4Done (step 4 of 4, to come)");
});

test("step 1 and step 4 current", () => {
  expect(items(make(1))[0]?.getAttribute("aria-current")).toBe("step");
  const last = items(make(4));
  expect(last.filter((li) => li.classList.contains("steps-done"))).toHaveLength(
    3,
  );
  expect(last[3]?.getAttribute("aria-current")).toBe("step");
});

test("it is not interactive: nothing to focus or click", () => {
  expect(make(2).querySelector("button, a, [tabindex]")).toBeNull();
});

test("a long label stays whole in its item", () => {
  const long = "Pick a very long bookmarks export file ".repeat(5).trim();
  const list = items(make(1, [long, "Check"]));
  expect(list[0]?.querySelector(".steps-label")?.textContent).toBe(long);
});

test("a current step outside the list moves to the nearest end", () => {
  expect(items(make(0))[0]?.getAttribute("aria-current")).toBe("step");
  const past = items(make(9));
  expect(past[3]?.getAttribute("aria-current")).toBe("step");
  expect(past.filter((li) => li.classList.contains("steps-done"))).toHaveLength(
    3,
  );
});

test("empty words leave no separator or brackets", () => {
  const list = createStepIndicator(document, {
    label: "Steps",
    steps: ["A", "B"],
    current: 1,
    words: { done: "", current: "", todo: "", position: () => "" },
  });
  expect(items(list)[0]?.textContent).toBe("1A");
});
