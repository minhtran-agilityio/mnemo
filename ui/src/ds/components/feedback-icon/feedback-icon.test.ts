// @vitest-environment happy-dom
import { Check } from "lucide";
import { expect, test } from "vitest";
import { createFeedbackIcon } from "./feedback-icon";

test("the icon is decorative and sized by a token", () => {
  const sm = createFeedbackIcon(Check);
  expect(sm.getAttribute("aria-hidden")).toBe("true");
  expect(sm.style.width).toBe("var(--icon-sm)");
  expect(createFeedbackIcon(Check, "md").style.height).toBe("var(--icon-md)");
  expect(sm.classList.contains("feedback-icon")).toBe(true);
});
