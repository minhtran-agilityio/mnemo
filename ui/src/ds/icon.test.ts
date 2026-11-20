// @vitest-environment happy-dom
import { Check } from "lucide";
import { expect, test } from "vitest";
import { createIcon } from "./icon";

test("the icon is decorative and sized by a token", () => {
  const sm = createIcon(Check);
  expect(sm.getAttribute("aria-hidden")).toBe("true");
  expect(sm.style.width).toBe("var(--icon-sm)");
  expect(createIcon(Check, "md").style.height).toBe("var(--icon-md)");
  expect(sm.classList.contains("ic")).toBe(true);
});

test("extra classes are added after the base class", () => {
  const svg = createIcon(Check, "sm", "ic-muted");
  expect(svg.classList.contains("ic")).toBe(true);
  expect(svg.classList.contains("ic-muted")).toBe(true);
});

test("the nav size is the sidebar's icon token", () => {
  const nav = createIcon(Check, "nav");
  expect(nav.style.width).toBe("var(--icon-nav)");
  expect(nav.style.height).toBe("var(--icon-nav)");
});
