// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { cssRule, MARKS_ROOM } from "../../../css-rule";
import { createButton } from "../button/button";
import {
  createCompactRow,
  createLinkCard,
  createLinkRow,
  createLinkView,
  type LinkItem,
  noSummaryText,
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
  ).toContain("No summary yet: AI is off.");
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

// Issue 169 (BM-01): a pasted link with its site, saved date, tags, reason and one action.
const pasted: LinkItem = {
  title: "Tauri 2 capabilities",
  url: "v2.tauri.app/security/capabilities",
  site: "v2.tauri.app",
  saved: "25 Nov 2026",
  status: "done",
  summary: "Each window gets a list of allowed commands.",
  tags: ["tauri", "security"],
  reason: "It may matter for the Mnemo command allow-list.",
};
const noSum = { summary: undefined, tags: undefined, reason: undefined };

test("a pasted link has no app: the meta line shows the site and the saved date", () => {
  const card = createLinkCard(document, pasted);
  expect(card.querySelector(".app")).toBeNull();
  const meta = card.querySelector(".meta") as HTMLElement;
  expect(meta.querySelector(".site")?.textContent).toBe("v2.tauri.app");
  expect(meta.querySelector<HTMLElement>(".site")?.title).toBe("v2.tauri.app");
  expect(meta.textContent).toContain("25 Nov 2026");
  // The saved date wins over the age; an app still shows when there is one.
  const both = createLinkCard(document, { ...pasted, app: "zalo", age: "2 d" });
  expect(both.querySelector(".app")?.textContent).toBe("Zalo");
  expect(both.querySelector(".meta")?.textContent).not.toContain("2 d");
});

test("done shows the summary as Written by AI, the tags, and the reason as a Guess", () => {
  const card = createLinkCard(document, pasted);
  expect(card.dataset.status).toBe("done");
  expect(card.querySelector(".sum")?.textContent).toBe(pasted.summary);
  expect(card.querySelector(":scope > .trust-ai")?.textContent).toBe(
    "Written by AI",
  );
  const tags = card.querySelector('ul.tags[aria-label="Tags"]');
  expect(
    [...(tags?.querySelectorAll(".tag-item") ?? [])].map((t) => t.textContent),
  ).toEqual(["tauri", "security"]);
  const reason = card.querySelector(":scope > .reason") as HTMLElement;
  expect(reason.querySelector(".reason-text")?.textContent).toBe(pasted.reason);
  expect(reason.querySelector(".trust-guess")?.textContent).toBe("Guess");
  // The reason is its own line: the summary's label stays Written by AI, not Guess.
  expect(card.querySelectorAll(".trust-guess")).toHaveLength(1);
});

test("a reason the owner wrote has no Guess label", () => {
  const card = createLinkCard(document, { ...pasted, reasonKind: "owner" });
  expect(card.querySelector(".reason .trust")).toBeNull();
});

test("partial: a summary without tags or reason, and tags without a reason", () => {
  const bare = createLinkCard(document, {
    ...pasted,
    tags: undefined,
    reason: undefined,
  });
  expect(bare.querySelector(".tags")).toBeNull();
  expect(bare.querySelector(".reason")).toBeNull();
  expect(bare.querySelector(".sum")).not.toBeNull();
  const tagsOnly = createLinkCard(document, { ...pasted, reason: undefined });
  expect(tagsOnly.querySelector(".tags")).not.toBeNull();
  expect(tagsOnly.querySelector(".reason")).toBeNull();
  const noTags = createLinkCard(document, { ...pasted, tags: [] });
  expect(noTags.querySelector(".tags")).toBeNull();
});

test("pending is saved with reading not started, and has no summary", () => {
  const card = createLinkCard(document, {
    ...pasted,
    ...noSum,
    status: "pending",
  });
  expect(card.dataset.status).toBe("pending");
  expect(card.querySelector(".sum")).toBeNull();
  expect(card.querySelector(".trust")).toBeNull();
  expect(card.querySelector(".nosum")?.textContent).toBe("No summary yet.");
  expect(card.querySelector(".nosum svg")).not.toBeNull();
});

test("the action slot holds the one button the screen passes, reachable by keyboard", () => {
  let clicks = 0;
  const action = createButton(document, {
    label: "Paste the text",
    size: "sm",
    onClick: () => clicks++,
  });
  const card = createLinkCard(
    document,
    { ...pasted, ...noSum, status: "unreadable" },
    { action },
  );
  document.body.append(card);
  const slot = card.querySelector(":scope > .lcard-action") as HTMLElement;
  expect(slot.children).toHaveLength(1);
  expect(slot.firstElementChild).toBe(action);
  expect(card.lastElementChild).toBe(slot);
  // A real button: its name is its text, it takes focus, and Enter or Space click it.
  expect(action.tagName).toBe("BUTTON");
  expect(action.textContent).toBe("Paste the text");
  action.focus();
  expect(document.activeElement).toBe(action);
  action.click();
  expect(clicks).toBe(1);
  card.remove();
  expect(
    createLinkCard(document, pasted).querySelector(".lcard-action"),
  ).toBeNull();
});

test("a busy or disabled action stays in the slot and ignores clicks", () => {
  let busyClicks = 0;
  let offClicks = 0;
  const busy = createButton(document, {
    label: "Summarize later",
    busy: true,
    onClick: () => busyClicks++,
  });
  const off = createButton(document, {
    label: "Paste the text",
    disabled: true,
    onClick: () => offClicks++,
  });
  const busyCard = createLinkCard(
    document,
    { ...pasted, ...noSum, status: "ai-off" },
    { action: busy },
  );
  expect(busyCard.querySelector(":scope > .lcard-action > button")).toBe(busy);
  busy.click();
  expect(busyClicks).toBe(0);
  expect(busy.getAttribute("aria-busy")).toBe("true");
  const offCard = createLinkCard(
    document,
    { ...pasted, ...noSum },
    { action: off },
  );
  document.body.append(offCard);
  expect(offCard.querySelector(":scope > .lcard-action > button")).toBe(off);
  expect(off.disabled).toBe(true);
  off.click();
  expect(offClicks).toBe(0);
  offCard.remove();
});

test("the status decides: a summary shows only when the link is done", () => {
  for (const status of [
    "unreadable",
    "reading",
    "pending",
    "ai-off",
  ] as const) {
    const item: LinkItem = { ...pasted, status, summary: "Made-up text." };
    const card = createLinkCard(document, item);
    expect(card.dataset.status).toBe(status);
    expect(card.querySelector(".sum")).toBeNull();
    expect(card.querySelector(":scope > .trust")).toBeNull();
    expect(card.textContent).not.toContain("Made-up text.");
    const sub = createLinkRow(document, item).querySelector(".row-sub");
    expect(sub?.textContent).toBe(noSummaryText(item));
  }
  const unreadable = createLinkCard(document, {
    ...pasted,
    status: "unreadable",
  });
  expect(unreadable.querySelector(".nosum")?.textContent).toBe(
    "Link only. Mnemo could not read this page.",
  );
  const reading = createLinkCard(document, { ...pasted, status: "reading" });
  expect(reading.querySelector('[role="status"]')?.textContent).toBe(
    "Reading the page",
  );
  // Left out, the status follows the summary.
  const noStatus: LinkItem = { ...pasted, status: undefined };
  expect(createLinkCard(document, noStatus).dataset.status).toBe("done");
  expect(
    createLinkCard(document, { ...noStatus, summary: undefined }).dataset
      .status,
  ).toBe("unreadable");
});

test("an empty summary counts as none, in the card and in the list row alike", () => {
  const item: LinkItem = { ...unread, summary: "" };
  const card = createLinkCard(document, item);
  expect(card.dataset.status).toBe("unreadable");
  expect(card.querySelector(".sum")).toBeNull();
  expect(card.querySelector(".nosum")?.textContent).toBe(noSummaryText(item));
  expect(
    createLinkRow(document, item).querySelector(".row-sub")?.textContent,
  ).toBe("Link only. Mnemo could not read this page.");
  const done: LinkItem = { ...pasted, ...noSum, summary: "" };
  expect(
    createLinkRow(document, done).querySelector(".row-sub")?.textContent,
  ).toBe("No summary.");
});

test("tags the app chose are labelled Written by AI; the owner's tags are not", () => {
  const card = createLinkCard(document, pasted);
  const line = card.querySelector(":scope > .tagline") as HTMLElement;
  expect(line.querySelector("ul.tags")).not.toBeNull();
  expect(line.querySelector(".trust-ai")?.textContent).toBe("Written by AI");
  const own = createLinkCard(document, { ...pasted, tagsKind: "owner" });
  expect(own.querySelector(".tagline .tags")).not.toBeNull();
  expect(own.querySelector(".tagline .trust")).toBeNull();
  const css = (sel: string) =>
    cssRule(import.meta.dirname, "link-card.css", sel);
  expect(css(".lcard .tags").gap).toBe("var(--space-2)");
  expect(css(".lcard .tagline")["flex-wrap"]).toBe("wrap");
});

test("a long site in a compact row shrinks and is cut with an ellipsis", () => {
  const site = `${"rất-dài-".repeat(12)}ẪẬẲỖỮỰ.example.vn`;
  const row = createCompactRow(document, { ...pasted, site });
  const dom = row.querySelector<HTMLElement>(".dom");
  expect(dom?.textContent).toBe(site);
  expect(dom?.title).toBe(pasted.url);
  const rule = cssRule(
    import.meta.dirname,
    "link-card.css",
    ".compact-row .dom",
  );
  expect(rule).toMatchObject({
    ...MARKS_ROOM,
    "min-width": "0",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
  });
  expect(rule.flex).not.toBe("none");
  expect(rule.flex.split(" ")[1]).toBe("1");
});

test("AI off keeps the link with the ticket's words, and the list row says the same", () => {
  const off: LinkItem = { ...pasted, ...noSum, status: "ai-off" };
  expect(
    createLinkCard(document, off).querySelector(".nosum")?.textContent,
  ).toBe("No summary yet: AI is off.");
  expect(noSummaryText(off)).toBe("No summary yet: AI is off.");
  expect(
    createLinkRow(document, off).querySelector(".row-sub")?.textContent,
  ).toBe("No summary yet: AI is off.");
});

test("pending and AI off both read as no summary yet, and the action is found by its name", () => {
  const pending: LinkItem = { ...pasted, ...noSum, status: "pending" };
  expect(noSummaryText(pending)).toBe("No summary yet.");
  expect(
    createLinkRow(document, pending).querySelector(".row-sub")?.textContent,
  ).toBe("No summary yet.");
  const action = createButton(document, { label: "Summarize later" });
  const off = createLinkCard(
    document,
    { ...pasted, ...noSum, status: "ai-off" },
    { action },
  );
  expect(off.textContent).toMatch(/no summary yet/i);
  const named = [...off.querySelectorAll("button")].find(
    (b) =>
      (b.getAttribute("aria-label") ?? b.textContent) === "Summarize later",
  );
  expect(named).toBe(action);
});

test("list and compact rows work without an app: site and saved date", () => {
  const row = createLinkRow(document, pasted);
  expect(row.querySelector(".app")).toBeNull();
  expect(row.querySelector(".site")?.textContent).toBe("v2.tauri.app");
  const compact = createCompactRow(document, pasted);
  expect(compact.querySelector(".dom")?.textContent).toBe("v2.tauri.app");
  expect(compact.querySelector(".row-meta")?.textContent).toBe("25 Nov 2026");
});

test("overflow: a long host, many tags and a long Vietnamese reason keep full values and wrap", () => {
  const site = `${"rất-dài-".repeat(12)}ẪẬẲỖỮỰ.example.vn`;
  const tags = [
    "tauri",
    "security",
    "rust",
    "ipc",
    "capabilities",
    "windows",
    "đặc-tả",
    "lưu-trữ",
  ];
  const reason = `Có thể liên quan đến danh sách lệnh được phép của Mnemo ${"ẪẬẲỖỮỰ".repeat(20)}`;
  const card = createLinkCard(document, { ...pasted, site, tags, reason });
  const host = card.querySelector<HTMLElement>(".site");
  expect(host?.textContent).toBe(site);
  expect(host?.title).toBe(site);
  const items = card.querySelectorAll<HTMLElement>(".tag-item");
  expect(items).toHaveLength(7);
  expect(items[6].getAttribute("aria-label")).toBe("2 more tags");
  expect(items[6].title).toBe("đặc-tả, lưu-trữ");
  expect(card.querySelector(".reason-text")?.textContent).toBe(reason);
  const siteRule = cssRule(
    import.meta.dirname,
    "link-card.css",
    ".lcard .site",
  );
  expect(siteRule).toMatchObject(MARKS_ROOM);
  expect(siteRule["text-overflow"]).toBe("ellipsis");
  expect(siteRule["min-width"]).toBe("0");
  const css = (sel: string) =>
    cssRule(import.meta.dirname, "link-card.css", sel);
  expect(css(".lcard .reason-text")["overflow-wrap"]).toBe("anywhere");
  expect(css(".lcard .reason")["flex-wrap"]).toBe("wrap");
  // The tag list stays a plain list in the card, never the tag input's box, and never wider.
  expect(css(".lcard .tags")).toMatchObject({
    border: "0",
    "max-width": "100%",
  });
});
