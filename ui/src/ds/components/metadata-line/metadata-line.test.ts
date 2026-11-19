// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { APP_LABELS, createAppBadge, createMetaLine } from "./metadata-line";

test("a badge names the app as text and takes its class", () => {
  const b = createAppBadge(document, "zalo");
  expect(b.textContent).toBe("Zalo");
  expect(b.className).toBe("app app-zalo");
});

test("every app has a label", () => {
  for (const [id, label] of Object.entries(APP_LABELS)) {
    expect(
      createAppBadge(document, id as keyof typeof APP_LABELS).textContent,
    ).toBe(label);
  }
});

test("the line joins its parts with a hidden dot and keeps text as text", () => {
  const line = createMetaLine(document, [
    "3 h ago",
    "<i>12</i> links",
    createAppBadge(document, "telegram"),
  ]);
  expect(line.querySelectorAll(".sep")).toHaveLength(2);
  expect(line.querySelector(".sep")?.getAttribute("aria-hidden")).toBe("true");
  expect(line.querySelector("i")).toBeNull();
  expect(line.querySelector(".app")?.textContent).toBe("Telegram");
});
