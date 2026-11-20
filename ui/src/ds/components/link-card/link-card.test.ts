// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { cssRule, MARKS_ROOM } from "../../../css-rule";
import {
  createCompactRow,
  createLinkCard,
  createLinkRow,
  createLinkView,
  type LinkItem,
} from "./link-card";

const read: LinkItem = {
  title: "<b>Tauri</b> 2",
  url: "v2.tauri.app/security/capabilities",
  app: "telegram",
  age: "2 d",
  summary: "Each window gets a list of allowed commands.",
};
const unread: LinkItem = {
  title: "medium.com/@x/9f2c1a",
  url: "medium.com/@x/9f2c1a",
  app: "slack",
  age: "1 h",
};

test("a card shows title, url and summary as text, with the full values in tooltips", () => {
  const card = createLinkCard(document, read);
  expect(card.querySelector(".title")?.textContent).toBe("<b>Tauri</b> 2");
  expect(card.querySelector("b")).toBeNull();
  expect(card.querySelector<HTMLElement>(".title")?.title).toBe(read.title);
  expect(card.querySelector<HTMLElement>(".url")?.title).toBe(read.url);
  expect(card.querySelector(".sum")?.textContent).toBe(read.summary);
  expect(card.querySelector(".app")?.textContent).toBe("Telegram");
});

test("a summary is labelled as written by AI, or as a guess", () => {
  expect(createLinkCard(document, read).textContent).toContain("Written by AI");
  const guess = createLinkCard(document, { ...read, summaryKind: "guess" });
  expect(guess.querySelector(".trust-guess")?.textContent).toBe("Guess");
});

test("a page that could not be read keeps the link only, with no summary", () => {
  const card = createLinkCard(document, unread);
  expect(card.querySelector(".sum")).toBeNull();
  expect(card.querySelector(".nosum")?.textContent).toBe(
    "Link only. Mnemo could not read this page.",
  );
});

test("AI off and reading say so, and reading is a status", () => {
  expect(
    createLinkCard(document, { ...unread, status: "ai-off" }).textContent,
  ).toContain("No summary: AI is off.");
  const r = createLinkCard(document, { ...unread, status: "reading" });
  expect(r.querySelector('[role="status"]')?.textContent).toBe(
    "Reading the page",
  );
});

test("the three views render each link", () => {
  const items = [read, unread];
  const cards = createLinkView(document, "cards", items);
  expect(cards.querySelectorAll(".lcard")).toHaveLength(2);
  expect(cards.querySelector(".thumb")).not.toBeNull();
  const list = createLinkView(document, "list", items);
  expect(list.getAttribute("aria-label")).toBe("Links, list view");
  expect(list.querySelectorAll(".row")).toHaveLength(2);
  const compact = createLinkView(document, "compact", items);
  expect(compact.getAttribute("aria-label")).toBe("Links, compact view");
  expect(compact.querySelectorAll(".compact-row")).toHaveLength(2);
});

test("a list row puts the summary, or why there is none, on the second line", () => {
  expect(
    createLinkRow(document, read).querySelector(".row-sub")?.textContent,
  ).toBe(read.summary);
  expect(
    createLinkRow(document, unread).querySelector(".row-sub")?.textContent,
  ).toBe("Link only. Mnemo could not read this page.");
});

test("a compact row shows the site and keeps the full url in a tooltip", () => {
  const row = createCompactRow(document, read);
  expect(row.querySelector(".dom")?.textContent).toBe("v2.tauri.app");
  expect(row.querySelector<HTMLElement>(".dom")?.title).toBe(read.url);
  expect(row.tabIndex).toBe(0);
});

// The Limits tab fix for issue 113: the url line has room for stacked marks, the trust label wraps inside a narrow card,
// and the cards view never asks for more than its container.
test("a messy url is whole text in .url, which has room for stacked marks, and the card keeps the full value", () => {
  const url = `example.com/${"ẪẬẲỖỮỰ".repeat(6)}/${"a".repeat(120)}?x=1&y=${"b".repeat(60)}`;
  const card = createLinkCard(document, { ...unread, url });
  const el = card.querySelector(".url") as HTMLElement;
  expect(el.textContent).toBe(url);
  expect(el.title).toBe(url);
  const rule = cssRule(import.meta.dirname, "link-card.css", ".lcard .url");
  expect(rule).toMatchObject(MARKS_ROOM);
  expect(rule["text-overflow"]).toBe("ellipsis");
  expect(rule["white-space"]).toBe("nowrap");
  // The title and the summary hold long words with overflow-wrap: anywhere.
  for (const sel of [".lcard .title", ".lcard .sum"])
    expect(
      cssRule(import.meta.dirname, "link-card.css", sel)["overflow-wrap"],
    ).toBe("anywhere");
});

test("the trust label of a summary can wrap and never grows wider than its card", () => {
  const card = createLinkCard(document, read);
  expect(card.querySelector(":scope > .trust")).not.toBeNull();
  const rule = cssRule(import.meta.dirname, "link-card.css", ".lcard .trust");
  expect(rule["max-width"]).toBe("100%");
  expect(rule["white-space"]).toBe("normal");
});

test("the cards view has columns that shrink to the container, so a narrow window needs no sideways scroll", () => {
  const view = createLinkView(document, "cards", [read, unread]);
  expect(view.className).toBe("views cards");
  const rule = cssRule(import.meta.dirname, "link-card.css", ".views.cards");
  expect(rule["grid-template-columns"]).toContain(
    "min(var(--size-basis-column), 100%)",
  );
});
