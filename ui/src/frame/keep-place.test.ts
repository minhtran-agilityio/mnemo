// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { keepPlace } from "./keep-place";

test("keep editing adds an entry and never rewrites the one the owner moved to", () => {
  window.location.hash = "#/notes";
  window.location.hash = "#/settings";
  const replace = vi.spyOn(window.history, "replaceState");
  const push = vi.spyOn(window.history, "pushState");
  const before = window.history.length;
  keepPlace(window, "#/notes");
  expect(replace).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe("#/notes");
  expect(window.history.length).toBe(before + 1);
  replace.mockRestore();
  push.mockRestore();
});

test("when the address is already the screen's, nothing is written", () => {
  window.location.hash = "#/notes";
  const push = vi.spyOn(window.history, "pushState");
  keepPlace(window, "#/notes");
  expect(push).not.toHaveBeenCalled();
  push.mockRestore();
});

test("an empty address goes back to the start screen", () => {
  window.location.hash = "#/other";
  keepPlace(window, "");
  expect(window.location.hash).toBe("#/");
});
