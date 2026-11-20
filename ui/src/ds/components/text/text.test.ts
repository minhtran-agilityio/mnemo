// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildText, textClasses } from "./text";

test("it is a paragraph by default, with the base class only", () => {
  const p = buildText(document, { content: "Changes are saved at once." });
  expect(p.tagName).toBe("P");
  expect(p.className).toBe("text");
  expect(p.textContent).toBe("Changes are saved at once.");
});

test("tone and size add one class each", () => {
  const p = buildText(document, {
    tone: "muted",
    size: "sm",
    content: "pong",
  });
  expect([...p.classList]).toEqual(["text", "text-muted", "text-sm"]);
  expect(textClasses({ tone: "default", size: "md" })).toEqual([
    "text",
    "text-md",
  ]);
});

test("it can be a heading or an inline span", () => {
  expect(buildText(document, { as: "h1", content: "Videos" }).tagName).toBe(
    "H1",
  );
  expect(buildText(document, { as: "span", content: "x" }).tagName).toBe(
    "SPAN",
  );
});

test("a string goes in as text, never as markup", () => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const p = buildText(document, { content: evil });
  expect(p.textContent).toBe(evil);
  expect(p.querySelector("img")).toBeNull();
});

test("nodes are appended in order, and long content stays whole", () => {
  const strong = document.createElement("strong");
  strong.textContent = "zebra";
  const p = buildText(document, { content: ["You searched for: ", strong] });
  expect(p.textContent).toBe("You searched for: zebra");
  const long = "x".repeat(500);
  expect(buildText(document, { content: long }).textContent).toBe(long);
});
