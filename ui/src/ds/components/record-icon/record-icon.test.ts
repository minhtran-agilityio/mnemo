// @vitest-environment happy-dom
import { Link } from "lucide";
import { expect, test } from "vitest";
import { createRecordIcon } from "./record-icon";

test("it draws a hidden svg with the icon class", () => {
  const svg = createRecordIcon(Link, "rec-ic-muted");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.classList.contains("rec-ic")).toBe(true);
  expect(svg.classList.contains("rec-ic-muted")).toBe(true);
});
