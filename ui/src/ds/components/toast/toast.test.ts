// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildToast, createToastRegion, TOAST_MS } from "./toast";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("a toast shows its message as text and an Undo button when it has an action", () => {
  const onAction = vi.fn();
  const toast = buildToast({ message: "<b>Moved</b>", onAction });
  expect(toast.querySelector("b")).toBeNull();
  const button = toast.querySelector("button");
  expect(button?.textContent).toBe("Undo");
  expect(button?.type).toBe("button");
  button?.click();
  expect(onAction).toHaveBeenCalledOnce();
});

test("a toast without an action has no button", () => {
  expect(buildToast({ message: "x" }).querySelector("button")).toBeNull();
});

test("the region is a polite live region", () => {
  const region = createToastRegion();
  expect(region.element.getAttribute("role")).toBe("status");
  expect(region.element.getAttribute("aria-live")).toBe("polite");
});

test("a toast leaves after 6 seconds", () => {
  const region = createToastRegion();
  region.show("Deleted.", { onUndo: () => {} });
  expect(region.element.querySelectorAll(".toast").length).toBe(1);
  vi.advanceTimersByTime(TOAST_MS - 1);
  expect(region.element.querySelectorAll(".toast").length).toBe(1);
  vi.advanceTimersByTime(2);
  expect(region.element.querySelectorAll(".toast").length).toBe(0);
});

test("Undo runs the callback and closes the toast", () => {
  const region = createToastRegion();
  const onUndo = vi.fn();
  region.show("Deleted.", { onUndo });
  region.element.querySelector("button")?.click();
  expect(onUndo).toHaveBeenCalledOnce();
  expect(region.element.querySelector(".toast")).toBeNull();
});

test("a toast stays while the pointer is over it and leaves after the pointer goes", () => {
  const region = createToastRegion();
  region.show("Deleted.", { onUndo: () => {} });
  const toast = region.element.querySelector(".toast") as HTMLElement;
  vi.advanceTimersByTime(TOAST_MS - 1000);
  toast.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(TOAST_MS * 3);
  expect(region.element.querySelector(".toast")).not.toBeNull();
  toast.dispatchEvent(new Event("pointerleave"));
  vi.advanceTimersByTime(TOAST_MS);
  expect(region.element.querySelector(".toast")).toBeNull();
});

test("the returned function dismisses the toast early", () => {
  const region = createToastRegion();
  const dismiss = region.show("x");
  dismiss();
  expect(region.element.querySelector(".toast")).toBeNull();
});
