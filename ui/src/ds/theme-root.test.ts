// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { setRootTheme } from "./theme-root";

test("light and dark set the attribute and the color-scheme", () => {
  const root = document.createElement("html");
  setRootTheme(root, "dark");
  expect(root.getAttribute("data-theme")).toBe("dark");
  expect(root.style.colorScheme).toBe("dark");
  setRootTheme(root, "light");
  expect(root.getAttribute("data-theme")).toBe("light");
  expect(root.style.colorScheme).toBe("light");
});

test("null removes both, so the system decides", () => {
  const root = document.createElement("html");
  setRootTheme(root, "dark");
  setRootTheme(root, null);
  expect(root.hasAttribute("data-theme")).toBe(false);
  expect(root.style.colorScheme).toBe("");
});
