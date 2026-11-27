// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import {
  createImportProgress,
  type ImportProgressOptions,
  setImportProgress,
} from "./import-progress";

const base: ImportProgressOptions = {
  fileName: "bookmarks.html",
  done: 12,
  waiting: 36,
  failed: 2,
  total: 50,
  state: "running",
};
const make = (o: Partial<ImportProgressOptions> = {}) =>
  createImportProgress(document, { ...base, ...o });
const q = (r: HTMLElement, s: string) => r.querySelector<HTMLElement>(s);

test("running shows counts, the state word, the bar and Pause", () => {
  const r = make();
  expect(q(r, ".ip-counts")?.textContent).toBe(
    "12 done, 36 waiting, 2 failed of 50",
  );
  expect(q(r, ".ip-title")?.textContent).toBe("Importing bookmarks.html");
  expect(q(r, ".ip-state")?.textContent).toBe("Running");
  expect(q(r, ".ip-bar")?.getAttribute("aria-valuenow")).toBe("28");
  expect(q(r, "button")?.textContent).toBe("Pause");
  expect(q(r, ".ip-reason")?.hidden).toBe(true);
});

test("waiting shows the reason and keeps Pause", () => {
  const reason =
    "Waiting: Claude is at its usage limit. It continues when AI may run again.";
  const r = make({ state: "waiting", reason });
  expect(q(r, ".ip-state")?.textContent).toBe("Waiting");
  expect(q(r, ".ip-reason")?.textContent).toBe(reason);
  expect(q(r, "button")?.textContent).toBe("Pause");
});

test("paused shows Continue and the pause reason", () => {
  const r = make({ state: "paused", reason: "Paused by you" });
  expect(q(r, "button")?.textContent).toBe("Continue");
  expect(q(r, ".ip-reason")?.textContent).toBe("Paused by you");
});

test("finished has no button and a full bar", () => {
  const r = make({ state: "finished", done: 50, waiting: 0, failed: 2 });
  expect(q(r, "button")).toBeNull();
  expect(q(r, ".ip-counts")?.textContent).toBe(
    "50 done, 0 waiting, 2 failed of 50",
  );
  expect(q(r, ".ip-bar")?.getAttribute("aria-valuenow")).toBe("100");
});

test("the button calls its handler and is disabled while pending", () => {
  const onPause = vi.fn();
  const onContinue = vi.fn();
  const r = make({ onPause, onContinue });
  q(r, "button")?.click();
  expect(onPause).toHaveBeenCalledOnce();
  setImportProgress(r, { ...base, state: "paused", onPause, onContinue });
  q(r, "button")?.click();
  expect(onContinue).toHaveBeenCalledOnce();
  setImportProgress(r, {
    ...base,
    state: "paused",
    pending: true,
    onContinue,
  });
  expect((q(r, "button") as HTMLButtonElement).disabled).toBe(true);
});

test("update in place keeps the same block and the same button", () => {
  const r = make();
  const button = q(r, "button");
  setImportProgress(r, { ...base, done: 30, waiting: 18 });
  expect(q(r, "button")).toBe(button);
  expect(q(r, ".ip-counts")?.textContent).toContain("30 done");
});

test("the button is keyboard reachable and has an accessible name", () => {
  const r = make();
  const b = q(r, "button") as HTMLButtonElement;
  expect(b.type).toBe("button");
  expect(b.tabIndex).toBe(0);
  expect(b.textContent).toBe("Pause");
  expect(q(r, ".ip-counts")?.hasAttribute("role")).toBe(false);
  expect(q(r, ".ip-state")?.getAttribute("role")).toBe("status");
  expect(q(r, ".ip-reason")?.getAttribute("role")).toBe("status");
});

test("counts of 1000 and more get separators; a long name keeps its full title", () => {
  const name = `${"very-long-file-name-".repeat(8)}.html`;
  const r = make({ fileName: name, done: 1200, waiting: 3400, total: 5000 });
  expect(q(r, ".ip-counts")?.textContent).toContain(
    "1,200 done, 3,400 waiting",
  );
  expect(q(r, ".ip-file")?.title).toBe(name);
});

const names = (r: HTMLElement) =>
  [...r.querySelectorAll("button")].map((b) => b.textContent);

test("Stop here sits next to Pause or Continue in running, waiting and paused", () => {
  expect(names(make())).toEqual(["Pause", "Stop here"]);
  expect(
    names(make({ state: "waiting", reason: "Waiting: AI is off." })),
  ).toEqual(["Pause", "Stop here"]);
  expect(names(make({ state: "paused", reason: "Paused by you" }))).toEqual([
    "Continue",
    "Stop here",
  ]);
});

test("Stop here is quiet, calls onStop and every button is disabled while pending", () => {
  const onStop = vi.fn();
  const r = make({ onStop });
  const stop = q(r, 'button[data-action="stop"]') as HTMLButtonElement;
  expect(stop.classList.contains("btn-ghost")).toBe(true);
  stop.click();
  expect(onStop).toHaveBeenCalledOnce();
  setImportProgress(r, { ...base, onStop, pending: true });
  expect([...r.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
});

test("stopped shows the word, the link-only line, counts and no buttons", () => {
  const r = make({ state: "stopped", done: 20, waiting: 28, failed: 2 });
  expect(q(r, ".ip-state")?.textContent).toBe("Stopped");
  expect(q(r, ".ip-reason")?.textContent).toBe(
    "Stopped. The links that got no summary are saved as link only.",
  );
  expect(q(r, ".ip-counts")?.textContent).toBe(
    "20 done, 28 waiting, 2 failed of 50",
  );
  expect(r.querySelectorAll("button").length).toBe(0);
  expect(q(r, ".ip-actions")?.hidden).toBe(true);
});

test("a running block that gets stopped loses its buttons in place", () => {
  const r = make();
  setImportProgress(r, { ...base, state: "stopped" });
  expect(r.querySelectorAll("button").length).toBe(0);
});

test("the bar never shows 100% before the import is finished", () => {
  const r = make({ done: 999, waiting: 1, failed: 0, total: 1000 });
  expect(q(r, ".ip-bar")?.getAttribute("aria-valuenow")).toBe("99");
  setImportProgress(r, {
    ...base,
    state: "finished",
    done: 1000,
    waiting: 0,
    failed: 0,
    total: 1000,
  });
  expect(q(r, ".ip-bar")?.getAttribute("aria-valuenow")).toBe("100");
});
