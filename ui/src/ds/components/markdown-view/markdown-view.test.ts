// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createMarkdownView, MARKDOWN_EMPTY_TEXT } from "./markdown-view";

const SAMPLE =
  "# Kế hoạch tuần 47\n- [ ] Viết test cho nhãn lồng nhau\n- [x] Đọc lại DEC-03\n\n```ts\nconst x = 1;\n```\n> Ghi chú: <script>alert(1)</script> <img src=x onerror=alert(1)>";

const view = (source: string, extra = {}) =>
  createMarkdownView(document, { source, ...extra });

test("the sample renders its blocks", () => {
  const v = view(SAMPLE);
  expect(v.querySelector("h2")?.textContent).toBe("Kế hoạch tuần 47");
  const items = v.querySelectorAll("li");
  expect(items).toHaveLength(2);
  expect(items[0].textContent).toBe("[ ] Viết test cho nhãn lồng nhau");
  expect(items[0].querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
    "Not done",
  );
  expect(items[1].querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
    "Done",
  );
  expect(v.querySelector("pre code")?.textContent).toBe("const x = 1;");
  expect(v.querySelector("blockquote")).not.toBeNull();
});

test("script and onerror never become elements and stay as text", () => {
  const v = view(SAMPLE);
  expect(v.querySelector("script")).toBeNull();
  expect(v.querySelector("img")).toBeNull();
  expect(v.querySelector("[onerror]")).toBeNull();
  const quote = v.querySelector("blockquote")?.textContent;
  expect(quote).toContain("<script>alert(1)</script>");
  expect(quote).toContain("onerror=alert(1)");
});

test("every element is on the allow list and none has an event attribute", () => {
  const nasty =
    '<svg onload=alert(1)>\n\n<a href="javascript:alert(1)" onclick=x>x</a>\n\n[x](javascript:alert(1)) [y](data:text/html,hi) ![i](http://evil.test/p.png)\n\n```\n</pre><script>1</script>\n```';
  const v = view(nasty);
  const allowed = new Set([
    "ARTICLE",
    "P",
    "A",
    "SPAN",
    "PRE",
    "CODE",
    "BLOCKQUOTE",
    "STRONG",
    "EM",
    "UL",
    "OL",
    "LI",
    "H2",
    "HR",
  ]);
  for (const node of v.querySelectorAll("*")) {
    expect(allowed.has(node.tagName)).toBe(true);
    for (const a of Array.from(node.attributes))
      expect(a.name.startsWith("on")).toBe(false);
  }
  expect(v.querySelector("a")).toBeNull();
  expect(v.querySelector("img")).toBeNull();
  expect(v.textContent).toContain("<svg onload=alert(1)>");
});

test("a safe link reports its click and is never followed by the part", () => {
  const onLinkClick = vi.fn();
  const v = view("See [the docs](https://example.com/a) now", { onLinkClick });
  const a = v.querySelector("a") as HTMLAnchorElement;
  expect(a.textContent).toContain("the docs");
  expect(a.getAttribute("href")).toBe("https://example.com/a");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(onLinkClick).toHaveBeenCalledWith("https://example.com/a", event);
});

test("a link can be reached with the keyboard", () => {
  const a = view("[x](https://example.com)").querySelector(
    "a",
  ) as HTMLAnchorElement;
  expect(a.tabIndex).toBe(0);
});

test("inline marks, nested lists and a rule", () => {
  const v = view(
    "**bold** and *italic* and `code`\n\n- a\n  - b\n    - c\n- d\n\n---\n\n1. one\n2. two",
  );
  expect(v.querySelector("strong")?.textContent).toBe("bold");
  expect(v.querySelector("em")?.textContent).toBe("italic");
  expect(v.querySelector("p code")?.textContent).toBe("code");
  expect(v.querySelectorAll("ul ul ul")).toHaveLength(1);
  expect(v.querySelector("hr")).not.toBeNull();
  expect(v.querySelectorAll("ol > li")).toHaveLength(2);
});

test("heading level starts where the screen says", () => {
  expect(view("# A", { headingLevel: 1 }).querySelector("h1")).not.toBeNull();
  expect(
    view("###### A", { headingLevel: 3 }).querySelector("h6"),
  ).not.toBeNull();
});

test("empty and blank sources show the empty text", () => {
  for (const source of ["", "  \n\n "]) {
    const v = view(source);
    expect(v.classList.contains("is-empty")).toBe(true);
    expect(v.textContent).toBe(MARKDOWN_EMPTY_TEXT);
  }
  expect(view("", { emptyText: "Nothing here." }).textContent).toBe(
    "Nothing here.",
  );
});

test("the region has an accessible name", () => {
  expect(view("a").getAttribute("aria-label")).toBe("Note");
  expect(view("a", { label: "Reading pane" }).getAttribute("aria-label")).toBe(
    "Reading pane",
  );
});

test("a code block is a keyboard-scrollable region with a name", () => {
  const pre = view("```ts\nx\n```").querySelector("pre") as HTMLElement;
  expect(pre.tabIndex).toBe(0);
  expect(pre.getAttribute("aria-label")).toBe("Code, ts");
});

test("long content keeps all its text", () => {
  const long = "x".repeat(5000);
  const url = `https://example.com/${"a/".repeat(500)}`;
  const v = view(`${long}\n\n\`\`\`\n${long}\n\`\`\`\n\n[${url}](${url})`);
  expect(v.querySelector("p")?.textContent).toBe(long);
  expect(v.querySelector("pre")?.textContent).toBe(long);
  expect(v.querySelector("a")?.textContent).toContain(url);
});

test("unclosed marks and deep nesting finish quickly as text", () => {
  const t = Date.now();
  const v = view(
    `${"[".repeat(20000)}\n\n${"*".repeat(20000)}\n\n${"> ".repeat(500)}x\n\n${"- ".repeat(300)}`,
  );
  expect(Date.now() - t).toBeLessThan(3000);
  expect(v.textContent).toContain("[[[");
});
