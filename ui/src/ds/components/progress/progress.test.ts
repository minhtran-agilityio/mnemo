// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildProgress, setProgress } from "./progress";

test("a determinate bar shows its value and a label with the share", () => {
  const bar = buildProgress({ label: "Import", value: 40 });
  expect(bar.getAttribute("role")).toBe("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("40");
  expect(bar.getAttribute("aria-label")).toBe("Import 40%");
  expect((bar.firstElementChild as HTMLElement).style.width).toBe("40%");
  expect(bar.classList.contains("indet")).toBe(false);
});

test("an indeterminate bar has no value, so a screen reader does not read a false one", () => {
  const bar = buildProgress({ label: "Reading page" });
  expect(bar.classList.contains("indet")).toBe(true);
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  expect(bar.getAttribute("aria-label")).toBe("Reading page");
});

test("setProgress moves the bar and clamps", () => {
  const bar = buildProgress({ label: "Import", value: 10 });
  setProgress(bar, 75);
  expect(bar.getAttribute("aria-valuenow")).toBe("75");
  expect(bar.getAttribute("aria-label")).toBe("Import 75%");
  setProgress(bar, 250);
  expect(bar.getAttribute("aria-valuenow")).toBe("100");
});
