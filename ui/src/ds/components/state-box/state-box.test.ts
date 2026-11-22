// @vitest-environment happy-dom
import { Bookmark } from "lucide";
import { expect, test, vi } from "vitest";
import {
  buildAiOffState,
  buildEmptyState,
  buildErrorState,
  buildKeyHint,
  buildStateBox,
} from "./state-box";

test("an empty state has a title, a line, an icon and an action button", () => {
  const onClick = vi.fn();
  const box = buildEmptyState({
    title: "No links yet",
    body: "Paste a link.",
    action: { label: "Save a link", onClick, primary: true },
  });
  expect(box.className).toBe("state-box");
  expect(box.hasAttribute("role")).toBe(false);
  expect(box.querySelector("b")?.textContent).toBe("No links yet");
  expect(box.querySelector("p")?.textContent).toBe("Paste a link.");
  expect(box.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  const button = box.querySelector("button");
  expect(button?.className).toBe("btn btn-primary");
  button?.click();
  expect(onClick).toHaveBeenCalledOnce();
});

test("an error state is an alert with a solid red box", () => {
  const box = buildErrorState({
    title: "Could not open",
    body: "Nothing changed.",
  });
  expect(box.getAttribute("role")).toBe("alert");
  expect(box.classList.contains("state-box-bad")).toBe(true);
  expect(box.querySelector("button")).toBeNull();
});

test("the body can be nodes, such as key hints", () => {
  const box = buildStateBox({
    icon: Bookmark,
    title: "t",
    body: [document.createTextNode("Paste with "), buildKeyHint("⌘")],
  });
  expect(box.querySelector("kbd")?.textContent).toBe("⌘");
  expect(box.querySelector("p")?.textContent).toBe("Paste with ⌘");
});

test("text goes in as text", () => {
  const box = buildEmptyState({ title: "<i>x</i>", body: "<u>y</u>" });
  expect(box.querySelector("i, u")).toBeNull();
  expect(box.textContent).toContain("<i>x</i>");
});

test("the AI-off state says links still save, for both reasons", () => {
  const off = buildAiOffState({
    action: { label: "Open AI settings", onClick: () => {} },
  });
  expect(off.querySelector("b")?.textContent).toBe("AI is off");
  expect(off.querySelector("p")?.textContent).toContain("Links still save");
  expect(off.querySelector("button")?.textContent).toBe("Open AI settings");
  const limit = buildAiOffState({ reason: "limit" });
  expect(limit.querySelector("b")?.textContent).toBe("At usage limit");
  expect(limit.querySelector("p")?.textContent).toContain("Links still save");
});

test("the limit reason shows the reset time, or none when unknown", () => {
  const known = buildAiOffState({
    reason: "limit",
    resetAt: "14:30",
    action: { label: "Resume", onClick: () => {} },
  });
  expect(known.querySelector("p")?.textContent).toContain(
    "Background work is paused until 14:30, or until you resume it.",
  );
  const unknown = buildAiOffState({ reason: "limit" });
  expect(unknown.querySelector("p")?.textContent).not.toMatch(/\d:\d/);
  expect(unknown.querySelector("p")?.textContent).toContain("Links still save");
});

test("the paused reason has its own title and keeps the promise", () => {
  const box = buildAiOffState({ reason: "paused" });
  expect(box.querySelector("b")?.textContent).toBe("Background work is paused");
  expect(box.querySelector("p")?.textContent).toContain("search still works");
  expect(box.querySelector("button")).toBeNull();
});

test("the action is optional, is a real button and can be clicked", () => {
  const onClick = vi.fn();
  const box = buildAiOffState({
    reason: "paused",
    action: { label: "Resume", onClick },
  });
  const button = box.querySelector("button");
  expect(button?.type).toBe("button");
  expect(button?.textContent).toBe("Resume");
  button?.click();
  expect(onClick).toHaveBeenCalledOnce();
});

test("a long reset text goes in as text", () => {
  const html = "<img src=x onerror=x>";
  const long = `${"x".repeat(300)} ${html}`;
  const box = buildAiOffState({ reason: "limit", resetAt: long });
  const p = box.querySelector("p");
  expect(p?.textContent).toContain(long);
  expect(p?.children.length).toBe(0);
  expect(box.querySelector("img")).toBeNull();
});

test("the resume clause shows only when there is an action to resume with", () => {
  for (const reason of ["limit", "paused"] as const) {
    const without = buildAiOffState({ reason });
    expect(without.querySelector("p")?.textContent).not.toMatch(/you resume/);
    const withAction = buildAiOffState({
      reason,
      action: { label: "Resume", onClick: () => {} },
    });
    expect(withAction.querySelector("p")?.textContent).toMatch(/you resume/);
  }
});
