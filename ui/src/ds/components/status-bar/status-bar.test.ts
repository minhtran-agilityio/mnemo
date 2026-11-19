// @vitest-environment happy-dom

import { TriangleAlert } from "lucide";
import { expect, test, vi } from "vitest";
import { createStatusBar } from "./status-bar";

test("it is a labelled status region and shows text as text", () => {
  const bar = createStatusBar({
    label: "Status",
    items: [
      { dot: "good", text: "<i>AI ready</i>" },
      { text: "Saved", push: true },
    ],
  });
  expect(bar.getAttribute("role")).toBe("status");
  expect(bar.getAttribute("aria-label")).toBe("Status");
  expect(bar.textContent).toBe("<i>AI ready</i>Saved");
  expect(bar.querySelector("i")).toBeNull();
  expect(bar.querySelector(".sb-dot-good")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  expect(bar.querySelectorAll(".push").length).toBe(1);
});

test("a warning has an icon and words, not only colour", () => {
  const bar = createStatusBar({
    items: [
      { icon: TriangleAlert, text: "62% used", tone: "warn", mono: true },
    ],
  });
  expect(bar.querySelector(".sb-warn svg")).not.toBeNull();
  expect(bar.querySelector(".mono")?.textContent).toBe("62% used");
});

test("a pulsing dot and an action button", () => {
  const on = vi.fn();
  const bar = createStatusBar({
    items: [
      { dot: "accent", pulse: true, text: "Summarising" },
      { action: { label: "Turn AI on", onAction: on } },
    ],
  });
  expect(bar.querySelector(".sb-dot.pulse")).not.toBeNull();
  bar.querySelector("button")?.click();
  expect(on).toHaveBeenCalledOnce();
});
