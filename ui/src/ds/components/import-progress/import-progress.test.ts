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
  expect(q(r, ".ip-reason")?.textContent).toBe("");
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
  // One stable live region holds the state word and the reason.
  const status = q(r, ".ip-status");
  expect(status?.getAttribute("role")).toBe("status");
  expect(status?.contains(q(r, ".ip-state"))).toBe(true);
  expect(status?.contains(q(r, ".ip-reason"))).toBe(true);
  expect(q(r, ".ip-reason")?.hasAttribute("hidden")).toBe(false);
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

test("the live region stays the same node when the state and reason change", () => {
  const r = make();
  const status = q(r, ".ip-status");
  setImportProgress(r, {
    ...base,
    state: "waiting",
    reason: "Waiting: AI is off.",
  });
  expect(q(r, ".ip-status")).toBe(status);
  expect(status?.textContent).toContain("Waiting: AI is off.");
});

test("a button in place is not moved: Stop here keeps focus across updates", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const r = make();
  host.append(r);
  const stop = q(r, 'button[data-action="stop"]') as HTMLButtonElement;
  stop.focus();
  expect(document.activeElement).toBe(stop);
  setImportProgress(r, { ...base, done: 20, waiting: 28 });
  expect(document.activeElement).toBe(stop);
  expect(q(r, 'button[data-action="stop"]')).toBe(stop);
  host.remove();
});

test("swapping Pause for Continue (and back) moves the focus to the new button", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const r = make();
  host.append(r);
  (q(r, 'button[data-action="pause"]') as HTMLButtonElement).focus();
  setImportProgress(r, { ...base, state: "paused", reason: "Paused by you" });
  expect(document.activeElement).toBe(q(r, 'button[data-action="continue"]'));
  expect(names(r)).toEqual(["Continue", "Stop here"]);
  setImportProgress(r, { ...base });
  expect(document.activeElement).toBe(q(r, 'button[data-action="pause"]'));
  expect(names(r)).toEqual(["Pause", "Stop here"]);
  host.remove();
});

test("the bar reaches 100% when every link is processed and stays under it while links wait", () => {
  const r = make({
    state: "stopped",
    done: 48,
    waiting: 0,
    failed: 2,
    total: 50,
  });
  expect(q(r, ".ip-bar")?.getAttribute("aria-valuenow")).toBe("100");
  setImportProgress(r, {
    ...base,
    state: "stopped",
    done: 20,
    waiting: 28,
    failed: 2,
  });
  expect(q(r, ".ip-bar")?.getAttribute("aria-valuenow")).toBe("44");
});

test("when Stop here is pressed and the buttons go, focus moves to the status region", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const r = make({ state: "paused", reason: "Paused by you" });
  host.append(r);
  (q(r, 'button[data-action="stop"]') as HTMLButtonElement).focus();
  setImportProgress(r, { ...base, state: "stopped" });
  expect(r.querySelectorAll("button").length).toBe(0);
  expect(q(r, ".ip-status")?.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(q(r, ".ip-status"));
  host.remove();
});

test("a swap of Pause for Continue while pending restores focus when pending clears", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const r = make();
  host.append(r);
  (q(r, 'button[data-action="pause"]') as HTMLButtonElement).focus();
  setImportProgress(r, {
    ...base,
    state: "paused",
    reason: "Paused by you",
    pending: true,
  });
  // The new button is disabled, so it cannot hold focus yet.
  (document.activeElement as HTMLElement | null)?.blur();
  setImportProgress(r, { ...base, state: "paused", reason: "Paused by you" });
  expect(document.activeElement).toBe(q(r, 'button[data-action="continue"]'));
  host.remove();
});

test("a stopped import never shows an earlier reason", () => {
  const stopped =
    "Stopped. The links that got no summary are saved as link only.";
  const r = make({ state: "stopped", reason: "Paused by you" });
  expect(q(r, ".ip-reason")?.textContent).toBe(stopped);
  const r2 = make({ state: "stopped", reason: "" });
  expect(q(r2, ".ip-reason")?.textContent).toBe(stopped);
});
