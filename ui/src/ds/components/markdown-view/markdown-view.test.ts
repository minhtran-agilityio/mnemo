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
  expect(items[0].textContent).toBe("[ ]Viết test cho nhãn lồng nhau");
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

test("unclosed marks and deep nesting stay bounded and keep their text", () => {
  const v = view(
    `${"[".repeat(20000)}\n\n${"*".repeat(20000)}x\n\n${"> ".repeat(500)}x\n\n${"- ".repeat(300)}`,
  );
  expect(v.textContent).toContain("[[[");
  expect(v.querySelectorAll("p")[0].textContent).toBe("[".repeat(20000));
  expect(v.querySelectorAll("p")[1].textContent).toBe(`${"*".repeat(20000)}x`);
  // Nesting stops at the depth cap instead of growing with the input.
  expect(v.querySelectorAll("blockquote").length).toBeLessThanOrEqual(9);
});

const linkOf = (source: string, extra = {}) =>
  view(source, extra).querySelector("a") as HTMLAnchorElement;

test("a click and a middle click are stopped and reported", () => {
  const onLinkClick = vi.fn();
  const a = linkOf("[x](https://example.com/a)", { onLinkClick });
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(click);
  const middle = new MouseEvent("auxclick", {
    bubbles: true,
    cancelable: true,
    button: 1,
  });
  a.dispatchEvent(middle);
  expect(click.defaultPrevented).toBe(true);
  expect(middle.defaultPrevented).toBe(true);
  expect(onLinkClick).toHaveBeenCalledTimes(2);
});

test("another mouse button is stopped but not reported as a click", () => {
  const onLinkClick = vi.fn();
  const a = linkOf("[x](https://example.com/a)", { onLinkClick });
  const right = new MouseEvent("auxclick", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  a.dispatchEvent(right);
  expect(right.defaultPrevented).toBe(true);
  expect(onLinkClick).not.toHaveBeenCalled();
});

test("the context menu goes to its own callback and the native menu is stopped", () => {
  const onLinkClick = vi.fn();
  const onLinkMenu = vi.fn();
  const a = linkOf("[x](https://example.com/a)", { onLinkClick, onLinkMenu });
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  a.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(onLinkMenu).toHaveBeenCalledWith("https://example.com/a", event);
  expect(onLinkClick).not.toHaveBeenCalled();
});

test("the native context menu stays only when the screen allows it", () => {
  const a = linkOf("[x](https://example.com/a)", {
    allowNativeLinkMenu: true,
  });
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  a.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

test("a ctrl click is reported and not followed", () => {
  const onLinkClick = vi.fn();
  const a = view("[x](https://example.com/a)", { onLinkClick }).querySelector(
    "a",
  ) as HTMLAnchorElement;
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  a.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(onLinkClick).toHaveBeenCalledTimes(1);
});

test("a blank line keeps one ordered list and its numbers", () => {
  const v = view("1. one\n\n2. two\n\n3. three");
  expect(v.querySelectorAll("ol")).toHaveLength(1);
  expect(v.querySelectorAll("ol > li")).toHaveLength(3);
});

test("an ordered list starts at its first number", () => {
  const ol = view("3. c\n4. d").querySelector("ol") as HTMLOListElement;
  expect(ol.start).toBe(3);
  expect((view("1. a").querySelector("ol") as HTMLOListElement).start).toBe(1);
});

test("a different list after a blank line starts a new list", () => {
  const v = view("- a\n\ntext\n\n- b");
  expect(v.querySelectorAll("ul")).toHaveLength(2);
});

test("indented lines and an indented code block stay inside their item", () => {
  const v = view(
    "1. first\n   more of first\n\n   ```ts\n   - not an item\n   ```\n\n2. second",
  );
  expect(v.querySelectorAll("ol")).toHaveLength(1);
  const items = v.querySelectorAll("ol > li");
  expect(items).toHaveLength(2);
  expect(items[0].textContent).toContain("first more of first");
  expect(items[0].querySelector("pre code")?.textContent).toBe("- not an item");
  expect(items[0].querySelectorAll("li")).toHaveLength(0);
});

test("a trailing # that is part of the title stays", () => {
  expect(view("# Learning C#").querySelector("h2")?.textContent).toBe(
    "Learning C#",
  );
  expect(view("## Title ##").querySelector("h3")?.textContent).toBe("Title");
  expect(view("# C# #").querySelector("h2")?.textContent).toBe("C#");
});

test("a line of inline backticks that starts with three is not a fence", () => {
  const v = view("```npm install``` then run it\n\nnext paragraph");
  expect(v.querySelector("pre")).toBeNull();
  expect(v.textContent).toContain("next paragraph");
  expect(v.querySelector("code")?.textContent).toBe("npm install");
});

test("a badge shows the alt text as the link and never loads the image", () => {
  const v = view(
    "[![build passing](https://img.test/b.svg)](https://example.com/ci)",
  );
  expect(v.querySelector("img")).toBeNull();
  const a = v.querySelector("a") as HTMLAnchorElement;
  expect(a.getAttribute("href")).toBe("https://example.com/ci");
  expect(a.textContent).toContain("build passing");
});

test("underscores inside words are not emphasis, also inside bold", () => {
  const v = view("snake_case_name and **use my_var_name here** and _real_");
  expect(v.querySelectorAll("em")).toHaveLength(1);
  expect(v.querySelector("em")?.textContent).toBe("real");
  expect(v.querySelector("strong")?.textContent).toBe("use my_var_name here");
  expect(v.textContent).toContain("snake_case_name");
});

test("a heading with a long run of spaces is read in one pass", () => {
  const gap = " ".repeat(20000);
  const v = view(`# a${gap}b`);
  expect(v.querySelector("h2")?.textContent).toBe(`a${gap}b`);
});

test("other lines with long runs of spaces still render", () => {
  const gap = " ".repeat(20000);
  for (const line of [`- a${gap}b`, `- ${gap}x`, `-${gap}-${gap}x`]) {
    const v = view(line);
    expect(v.querySelector("li")).not.toBeNull();
    expect(v.textContent?.replace(/\s+/g, "")).toMatch(/[abx]$/);
  }
  expect(view(`\`\`\`${gap}x`).querySelector("pre")).not.toBeNull();
});

test("a paragraph past the inline limit shows as plain text", () => {
  const v = view(`*a* ${"x ".repeat(6000)}`);
  expect(v.querySelector("em")).toBeNull();
  expect(v.querySelector("p")?.textContent?.startsWith("*a* x")).toBe(true);
});

test("mixed lists and quotes stop at the depth cap and keep their text", () => {
  let lines = ["x"];
  for (let k = 0; k < 4000; k++) {
    lines =
      k % 2
        ? lines.map((l) => `> ${l}`)
        : ["- a", ...lines.map((l) => `  ${l}`)];
  }
  const v = view(lines.join("\n"));
  expect(v.textContent).toContain("x");
  let deepest = 0;
  for (const node of v.querySelectorAll("*")) {
    let d = 0;
    for (let n: Element | null = node; n; n = n.parentElement) d += 1;
    deepest = Math.max(deepest, d);
  }
  expect(deepest).toBeLessThan(80);
});

test("tabs inside code stay as typed and tab indents nest lists", () => {
  const v = view("```\n\tindented\n```\n\nuse `a\tb` here\n\n- a\n\t- b");
  expect(v.querySelector("pre")?.textContent).toBe("\tindented");
  expect(v.querySelector("p code")?.textContent).toBe("a\tb");
  expect(v.querySelectorAll("ul ul")).toHaveLength(1);
});

test("a very long list of blocks is appended without a spread", () => {
  const v = view("---\n".repeat(150000));
  expect(v.children).toHaveLength(150000);
}, 60000);

test("a link label keeps its marks and an address keeps one level of parentheses", () => {
  const a = linkOf("[**docs**](https://en.wikipedia.org/wiki/Tab_(key))");
  expect(a.getAttribute("href")).toBe(
    "https://en.wikipedia.org/wiki/Tab_(key)",
  );
  expect(a.querySelector("strong")?.textContent).toBe("docs");
  expect(a.textContent).not.toContain("*");
});

test("a link label holds no second link", () => {
  const v = view("[see [x](https://a.test)](https://b.test)");
  expect(v.querySelector("a a")).toBeNull();
});

test("an unclosed fence in an item ends where the indent falls back", () => {
  const v = view("- a\n  ```\n  code\nnext paragraph");
  expect(v.querySelector("li pre code")?.textContent).toBe("code");
  const p = v.querySelector(":scope > p");
  expect(p?.textContent).toBe("next paragraph");
});

test("a rule inside a list ends the list and is not a nested item", () => {
  const v = view("- a\n- - -\n- b\n\n* * *");
  expect(v.querySelectorAll("hr")).toHaveLength(2);
  expect(v.querySelectorAll("ul")).toHaveLength(2);
  expect(v.querySelectorAll("li")).toHaveLength(2);
});

test("a task with no text is still a task", () => {
  const li = view("- [x]\n- [ ]").querySelectorAll("li");
  expect(li).toHaveLength(2);
  expect(li[0].querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
    "Done",
  );
  expect(li[1].querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
    "Not done",
  );
});
