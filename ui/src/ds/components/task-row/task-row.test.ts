// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createTaskRow } from "./task-row";

test("it renders a labelled checkbox, the title as text and a status pill", () => {
  const li = createTaskRow(document, {
    id: "t1",
    title: "<b>Check</b>",
    meta: "Due today",
    badge: { text: "Today", tone: "warn" },
  });
  document.body.append(li);
  const box = li.querySelector("input") as HTMLInputElement;
  expect(box.type).toBe("checkbox");
  expect(li.querySelector("label")?.htmlFor).toBe("t1");
  expect(li.querySelector(".row-title")?.textContent).toBe("<b>Check</b>");
  expect(li.querySelector("b")).toBeNull();
  expect(li.querySelector(".pill-warn")?.textContent).toBe("Today");
  expect(li.classList.contains("done")).toBe(false);
  li.remove();
});

test("a done task is checked, struck through by class and says Done in text", () => {
  const li = createTaskRow(document, {
    id: "t2",
    title: "Write",
    meta: "Done yesterday",
    done: true,
    badge: { text: "Today", tone: "warn" },
  });
  expect((li.querySelector("input") as HTMLInputElement).checked).toBe(true);
  expect(li.classList.contains("done")).toBe(true);
  expect(li.querySelector(".pill-good")?.textContent).toBe("Done");
});

test("toggling the checkbox flips the done state and tells the caller", () => {
  const seen: boolean[] = [];
  const li = createTaskRow(document, {
    id: "t3",
    title: "A",
    meta: "B",
    onToggle: (d) => seen.push(d),
  });
  const box = li.querySelector("input") as HTMLInputElement;
  box.checked = true;
  box.dispatchEvent(new Event("change"));
  expect(li.classList.contains("done")).toBe(true);
  expect(li.querySelector(".pill-good")?.textContent).toBe("Done");
  box.checked = false;
  box.dispatchEvent(new Event("change"));
  expect(li.classList.contains("done")).toBe(false);
  expect(li.querySelector(".pill")).toBeNull();
  expect(seen).toEqual([true, false]);
});
