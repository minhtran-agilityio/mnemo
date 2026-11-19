// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildSkeleton } from "./skeleton";

test("a skeleton is hidden from screen readers and has three lines by default", () => {
  const skel = buildSkeleton();
  expect(skel.getAttribute("aria-hidden")).toBe("true");
  const widths = [...skel.querySelectorAll("span")].map((s) => s.style.width);
  expect(widths).toEqual(["80%", "100%", "60%"]);
});

test("widths are set and clamped", () => {
  const skel = buildSkeleton({ widths: [50, 300] });
  expect([...skel.querySelectorAll("span")].map((s) => s.style.width)).toEqual([
    "50%",
    "100%",
  ]);
});
