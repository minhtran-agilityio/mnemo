// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createDivider } from "./divider";

test("a divider is an hr with the divider class", () => {
  const hr = createDivider();
  expect(hr.tagName).toBe("HR");
  expect(hr.className).toBe("divider");
});
