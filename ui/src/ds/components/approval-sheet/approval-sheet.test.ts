// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createApprovalSample, createApprovalSheet } from "./approval-sheet";

afterEach(() => {
  document.body.innerHTML = "";
});

const base = () => ({
  where: "Google Drive",
  title: "Move 2 files?",
  plan: [
    ["Move ", { code: "a.pdf" }, " to ", { code: "Mnemo/2026" }],
    ["Move ", { code: "<i>b</i>.jpg" }, " to ", { code: "Mnemo/2026" }],
  ] as [(string | { code: string })[], ...(string | { code: string })[][]],
  note: "Nothing is deleted.",
  declineLabel: "Not now",
  approveLabel: "Approve and move 2 files",
  onApprove: vi.fn(),
  onDecline: vi.fn(),
});

test("it says where the write goes and lists every step", () => {
  const h = createApprovalSheet(base());
  expect(h.element.querySelector(".sheet-where")?.textContent).toBe(
    "Writes outside Mnemo: Google Drive",
  );
  expect(h.element.querySelectorAll(".plan li").length).toBe(2);
  expect(h.element.querySelector(".plan li")?.textContent).toBe(
    "Move a.pdf to Mnemo/2026",
  );
});

test("file names go in as text", () => {
  const h = createApprovalSheet(base());
  expect(h.element.querySelectorAll(".plan code")[2]?.textContent).toBe(
    "<i>b</i>.jpg",
  );
  expect(h.element.querySelector(".plan i")).toBeNull();
});

test("the where line comes before the title", () => {
  const h = createApprovalSheet(base());
  expect(h.element.querySelector(".dlg")?.firstElementChild?.className).toBe(
    "sheet-where",
  );
});

test("it waits: nothing runs until Approve, and Decline has the focus", () => {
  const o = base();
  const h = createApprovalSheet(o);
  h.open(null);
  expect(o.onApprove).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe("Not now");
  (h.element.querySelector(".btn-primary") as HTMLButtonElement).click();
  expect(o.onApprove).toHaveBeenCalledOnce();
});

test("Decline runs onDecline and not onApprove", () => {
  const o = base();
  const h = createApprovalSheet(o);
  h.open(null);
  (document.activeElement as HTMLButtonElement).click();
  expect(o.onDecline).toHaveBeenCalledOnce();
  expect(o.onApprove).not.toHaveBeenCalled();
});

test("the sample draws the same sheet in the page", () => {
  const s = createApprovalSample(base());
  expect(s.getAttribute("role")).toBe("group");
  expect(s.querySelector(".sheet-where")).not.toBeNull();
  expect(s.querySelector(".note")?.textContent).toBe("Nothing is deleted.");
});
