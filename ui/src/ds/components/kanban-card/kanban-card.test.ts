// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { ref } from "../../catalog/types";
import { createKanbanCard } from "./kanban-card";

test("it renders the title and meta as text and can take focus", () => {
  const card = createKanbanCard(document, {
    title: "<b>Fonts</b>",
    meta: [ref(104), "2 d"],
  });
  expect(card.querySelector(".k-title")?.textContent).toBe("<b>Fonts</b>");
  expect(card.querySelector("b")).toBeNull();
  expect(card.querySelector<HTMLElement>(".k-title")?.title).toBe(
    "<b>Fonts</b>",
  );
  expect(card.querySelector(".meta")?.textContent).toContain(ref(104));
  expect(card.tabIndex).toBe(0);
});

test("forced states add their class", () => {
  for (const s of ["hover", "focus", "dragging"] as const) {
    expect(
      createKanbanCard(document, { title: "A", forceState: s }).classList,
    ).toContain(`is-${s}`);
  }
});

test("a working card says so as a status", () => {
  const card = createKanbanCard(document, { title: "A", working: true });
  expect(card.querySelector('[role="status"]')?.textContent).toBe("AI working");
});

test("a button card is a real button that opens on click and is not a grab target", () => {
  let opened = 0;
  const card = createKanbanCard(document, {
    title: "Garden robot that waters by soil moisture",
    meta: ["3 of 4 checks", "2 tags"],
    onOpen: () => {
      opened += 1;
    },
  });
  expect(card.tagName).toBe("BUTTON");
  expect((card as HTMLButtonElement).type).toBe("button");
  expect(card.hasAttribute("aria-current")).toBe(false);
  expect(card.textContent).toContain("Garden robot");
  expect(card.querySelector<HTMLElement>(".k-title")?.title).toContain(
    "Garden robot",
  );
  card.click();
  expect(opened).toBe(1);
});

test("the open card has aria-current and a check mark, not colour alone", () => {
  const card = createKanbanCard(document, {
    title: "A",
    onOpen: () => {},
    current: true,
  });
  expect(card.getAttribute("aria-current")).toBe("true");
  expect(card.classList).toContain("is-current");
  expect(card.querySelector("svg.k-mark")).not.toBeNull();
});

test("a long title stays in the card as text", () => {
  const long = "word ".repeat(80).trim();
  const card = createKanbanCard(document, { title: long, onOpen: () => {} });
  expect(card.querySelector(".k-title")?.textContent).toBe(long);
});

test("Enter and Space are left to the button and click opens once", () => {
  let opened = 0;
  const card = createKanbanCard(document, {
    title: "A",
    onOpen: () => {
      opened += 1;
    },
  });
  document.body.append(card);
  for (const key of ["Enter", " "]) {
    const e = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    card.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  }
  expect(opened).toBe(0);
  card.focus();
  expect(document.activeElement).toBe(card);
  card.click();
  expect(opened).toBe(1);
  card.remove();
});

test("an open card with a 60-character unbroken title keeps it as text", () => {
  const long = "x".repeat(60);
  const card = createKanbanCard(document, {
    title: long,
    onOpen: () => {},
    current: true,
  });
  expect(card.querySelector(".k-head .k-title")?.textContent).toBe(long);
  expect(card.querySelector<HTMLElement>(".k-title")?.title).toBe(long);
});
