// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createConfirmDialog, createConfirmSample } from "./confirm-dialog";

afterEach(() => {
  document.body.innerHTML = "";
});

const base = () => ({
  title: "Delete the folder?",
  message: "It cannot be restored:",
  lose: ["42 links", "3 notes"] as [string, ...string[]],
  keepLabel: "Keep folder",
  confirmLabel: "Delete 45 items",
  onConfirm: vi.fn(),
  onKeep: vi.fn(),
});

test("it names what will be lost", () => {
  const h = createConfirmDialog(base());
  const lines = [...h.element.querySelectorAll(".lose li")].map(
    (l) => l.textContent,
  );
  expect(lines).toEqual(["42 links", "3 notes"]);
});

test("the safe button has the focus when it opens", () => {
  const h = createConfirmDialog(base());
  h.open(null);
  expect(document.activeElement?.textContent).toBe("Keep folder");
});

test("only the danger button confirms", async () => {
  const o = base();
  const h = createConfirmDialog(o);
  h.open(null);
  (h.element.querySelector(".btn-danger") as HTMLButtonElement).click();
  expect(o.onConfirm).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(h.isOpen()).toBe(false));
});

test("Keep closes without confirming", () => {
  const o = base();
  const h = createConfirmDialog(o);
  h.open(null);
  (document.activeElement as HTMLButtonElement).click();
  expect(o.onConfirm).not.toHaveBeenCalled();
  expect(o.onKeep).toHaveBeenCalledOnce();
});

test("the sample shows the same words in the page", () => {
  const s = createConfirmSample(base());
  expect(s.getAttribute("role")).toBe("group");
  expect(s.querySelector(".btn-danger")?.textContent).toBe("Delete 45 items");
  expect(s.querySelectorAll(".lose li").length).toBe(2);
});

const typed = () => ({
  ...base(),
  typeToConfirm: { word: "RESET", label: "Type RESET to confirm" },
});
const typeInto = (root: ParentNode, text: string) => {
  const input = root.querySelector("input") as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const danger = (root: ParentNode) =>
  root.querySelector(".btn-danger") as HTMLButtonElement;

test("typed word: the confirm is disabled and the reason is in words", () => {
  const h = createConfirmDialog(typed());
  h.open(null);
  expect(danger(h.element).disabled).toBe(true);
  const input = h.element.querySelector("input") as HTMLInputElement;
  const hint = document.getElementById(
    input.getAttribute("aria-describedby") ?? "",
  );
  expect(hint?.textContent).toContain("RESET");
  expect(h.element.querySelector("label")?.textContent).toBe(
    "Type RESET to confirm",
  );
});

test("typed word: the exact word enables the confirm", () => {
  const o = typed();
  const h = createConfirmDialog(o);
  h.open(null);
  typeInto(h.element, "RESET");
  expect(danger(h.element).disabled).toBe(false);
  danger(h.element).click();
  expect(o.onConfirm).toHaveBeenCalledOnce();
});

test("typed word: wrong case, extra space and part of the word stay disabled", () => {
  const h = createConfirmDialog(typed());
  h.open(null);
  for (const text of ["reset", "Reset", "RESET ", " RESET", "RES", "RESETT"]) {
    typeInto(h.element, text);
    expect(danger(h.element).disabled).toBe(true);
  }
  typeInto(h.element, "RESET");
  expect(danger(h.element).disabled).toBe(false);
  typeInto(h.element, "RESET ");
  expect(danger(h.element).disabled).toBe(true);
});

test("typed word: Escape closes with no call, and the field is empty on reopen", () => {
  const o = typed();
  const h = createConfirmDialog(o);
  h.open(null);
  typeInto(h.element, "RESET");
  h.element.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(h.isOpen()).toBe(false);
  expect(o.onConfirm).not.toHaveBeenCalled();
  expect(o.onKeep).not.toHaveBeenCalled();
  h.open(null);
  expect((h.element.querySelector("input") as HTMLInputElement).value).toBe("");
  expect(danger(h.element).disabled).toBe(true);
});

test("typed word: the safe button has the focus on open, Keep calls no confirm", () => {
  const o = typed();
  const h = createConfirmDialog(o);
  h.open(null);
  expect(document.activeElement?.textContent).toBe("Keep folder");
  (document.activeElement as HTMLButtonElement).click();
  expect(o.onConfirm).not.toHaveBeenCalled();
});

test("without typeToConfirm there is no field and the confirm is enabled", () => {
  const h = createConfirmDialog(base());
  expect(h.element.querySelector("input")).toBeNull();
  expect(danger(h.element).disabled).toBe(false);
});

test("typed word: a long word and a long lose list render", () => {
  const word = "DELETE-EVERYTHING-".repeat(8);
  const o = {
    ...base(),
    lose: Array.from({ length: 30 }, (_, i) => `item ${i}`) as [
      string,
      ...string[],
    ],
    typeToConfirm: { word, label: "Type the word" },
  };
  const h = createConfirmDialog(o);
  h.open(null);
  expect(h.element.querySelectorAll(".lose li").length).toBe(30);
  typeInto(h.element, word);
  expect(danger(h.element).disabled).toBe(false);
});

test("the sample gates the confirm too", () => {
  const s = createConfirmSample(typed());
  expect(danger(s).disabled).toBe(true);
  typeInto(s, "RESET");
  expect(danger(s).disabled).toBe(false);
});
