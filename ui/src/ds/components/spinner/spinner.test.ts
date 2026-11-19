// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildBusyLine, buildSpinner } from "./spinner";

test("the spinner is decorative", () => {
  const ring = buildSpinner();
  expect(ring.getAttribute("aria-hidden")).toBe("true");
  expect(ring.className).toBe("spinner");
  expect(buildSpinner("lg").classList.contains("spinner-lg")).toBe(true);
});

test("the busy line is a status region with words, shown as text", () => {
  const line = buildBusyLine("<i>Reading the page…</i>");
  expect(line.getAttribute("role")).toBe("status");
  expect(line.textContent).toBe("<i>Reading the page…</i>");
  expect(line.querySelector("i")).toBeNull();
  expect(line.querySelector(".spinner")).not.toBeNull();
});
