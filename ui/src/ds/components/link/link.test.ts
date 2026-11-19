// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createLink, EXTERNAL_NOTE } from "./link";

test("an inline link is an anchor with the label as text", () => {
  const a = createLink(document, {
    label: "<b>Docs</b>",
    href: "https://example.com/",
  });
  expect(a.tagName).toBe("A");
  expect(a.textContent).toBe("<b>Docs</b>");
  expect(a.querySelector("b")).toBeNull();
  expect(a.classList.contains("lnk-inline")).toBe(true);
  expect(a.getAttribute("href")).toBe("https://example.com/");
});

test("a standalone link and a forced state carry their classes", () => {
  const a = createLink(document, {
    label: "Open",
    href: "#/notes",
    variant: "standalone",
    forced: "hover",
  });
  expect(a.classList.contains("lnk-standalone")).toBe(true);
  expect(a.classList.contains("is-hover")).toBe(true);
});

test("an external link shows an icon, says it opens outside Mnemo and is safe to follow", () => {
  const a = createLink(document, {
    label: "Docs",
    href: "https://example.com/",
    external: true,
  });
  expect(a.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(a.textContent).toContain(EXTERNAL_NOTE);
  expect(a.getAttribute("rel")).toBe("noopener noreferrer");
});

test("an unavailable link is text with a visible reason and no anchor", () => {
  const w = createLink(document, {
    label: "Open in Telegram",
    href: "https://t.me/x",
    unavailable: "Telegram is not connected.",
  });
  expect(w.querySelector("a")).toBeNull();
  const text = w.querySelector(".lnk");
  expect(text?.getAttribute("aria-disabled")).toBe("true");
  expect(w.querySelector(".lnk-reason")?.textContent).toBe(
    "Telegram is not connected.",
  );
  expect(text?.getAttribute("aria-describedby")).toBe(
    w.querySelector(".lnk-reason")?.id,
  );
});

test("a missing or script address makes the link unavailable", () => {
  for (const href of [
    undefined,
    "",
    "javascript:alert(1)",
    " DATA:text/html,x",
  ]) {
    const w = createLink(document, { label: "Go", href });
    expect(w.querySelector("a")).toBeNull();
    expect(w.querySelector(".lnk-reason")?.textContent).toBeTruthy();
  }
});

test("onClick runs on a click of an available link", () => {
  const onClick = vi.fn();
  const a = createLink(document, { label: "Docs", href: "#/x", onClick });
  a.click();
  expect(onClick).toHaveBeenCalledTimes(1);
});
