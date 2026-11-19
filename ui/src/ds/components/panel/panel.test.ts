// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createPanel } from "./panel";

test("a panel shows a title as text and its children", () => {
  const panel = createPanel({
    title: "<i>Details</i>",
    children: [document.createElement("span")],
  });
  expect(panel.classList.contains("panel")).toBe(true);
  expect(panel.querySelector("b")?.textContent).toBe("<i>Details</i>");
  expect(panel.querySelector("i")).toBeNull();
  expect(panel.querySelector("span")).not.toBeNull();
});
