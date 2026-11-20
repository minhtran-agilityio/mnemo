// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { mountKanban } from "./kanban";

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }),
  );

test("the sample board moves a card with the plain arrows, Alt+Arrow and a drag", async () => {
  const boardEl = document.createElement("div");
  const statusEl = document.createElement("p");
  document.body.append(boardEl, statusEl);
  mountKanban(boardEl, statusEl);
  const cols = boardEl.querySelectorAll<HTMLElement>(".kcol");
  const card = cols[0].querySelector(".kcard") as HTMLElement;
  key(card, "ArrowRight");
  expect(cols[1].contains(card)).toBe(true);
  key(card, "ArrowRight", { altKey: true });
  expect(cols[2].contains(card)).toBe(true);
  document.elementsFromPoint = () => [cols[3]];
  const ptr = (type: string) =>
    card.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
  ptr("pointerdown");
  ptr("pointerup");
  expect(cols[3].contains(card)).toBe(true);
  // One live region speaks; the status copy is hidden from screen readers and follows it.
  await Promise.resolve();
  expect(statusEl.getAttribute("aria-hidden")).toBe("true");
  expect(statusEl.textContent).toBe(
    boardEl.querySelector(".board-live")?.textContent,
  );
});
