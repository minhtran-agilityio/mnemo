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
    // No AI text at all: no summary, no AI tags, no guessed reason, and no trust label anywhere.
    expect(card.querySelector(".trust")).toBeNull();
    expect(card.querySelector(".lcard-tags")).toBeNull();
    expect(card.querySelector(".tags")).toBeNull();
    expect(card.querySelector(".reason")).toBeNull();
    expect(card.textContent).not.toContain("Made-up text.");
    expect(card.textContent).not.toContain(pasted.reason);
    expect(card.textContent).not.toContain("Written by AI");
    expect(card.textContent).not.toContain("Guess");
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
  const line = card.querySelector(":scope > .lcard-tags") as HTMLElement;
  expect(line.querySelector("ul.tags")).not.toBeNull();
  expect(line.querySelector(".trust-ai")?.textContent).toBe("Written by AI");
  const own = createLinkCard(document, { ...pasted, tagsKind: "owner" });
  expect(own.querySelector(".lcard-tags .tags")).not.toBeNull();
  expect(own.querySelector(".lcard-tags .trust")).toBeNull();
  const css = (sel: string) =>
    cssRule(import.meta.dirname, "link-card.css", sel);
  expect(css(".lcard-tags > .tags").gap).toBe("var(--space-2)");
  expect(css(".lcard .lcard-tags")["flex-wrap"]).toBe("wrap");
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
  expect(css(".lcard-tags > .tags")).toMatchObject({
    border: "0",
    "max-width": "100%",
  });
});

test("the owner's tags and reason show in every status, with no label", () => {
  for (const status of [
    "pending",
    "reading",
    "unreadable",
    "ai-off",
    "done",
  ] as const) {
    const card = createLinkCard(document, {
      ...pasted,
      status,
      tagsKind: "owner",
      reasonKind: "owner",
    });
    expect(card.querySelector(":scope > .lcard-tags > .tags")).not.toBeNull();
    expect(card.querySelector(".lcard-tags .trust")).toBeNull();
    expect(card.querySelector(".reason-text")?.textContent).toBe(pasted.reason);
    expect(card.querySelector(".reason .trust")).toBeNull();
  }
});

test("only the card's own tag list loses the tag input box: the selector names the card's wrapper", () => {
  const card = createLinkCard(document, pasted);
  expect(card.querySelector(":scope > .lcard-tags > ul.tags")).not.toBeNull();
  expect(() =>
    cssRule(import.meta.dirname, "link-card.css", ".lcard .tags"),
  ).toThrow();
});

test("a read link with no summary says so, without the link-only icon", () => {
  const card = createLinkCard(document, {
    ...pasted,
    ...noSum,
    status: "done",
  });
  const none = card.querySelector(".nosum");
  expect(none?.textContent).toBe("No summary.");
  expect(none?.querySelector("svg")).toBeNull();
  const linkOnly = createLinkCard(document, {
    ...pasted,
    ...noSum,
    status: "unreadable",
  });
  expect(linkOnly.querySelector(".nosum svg")).not.toBeNull();
});

test("an empty site or saved date falls back: the url host, and the age", () => {
  const item: LinkItem = { ...pasted, site: "", saved: "", age: "2 d" };
  const compact = createCompactRow(document, item);
  expect(compact.querySelector(".dom")?.textContent).toBe("v2.tauri.app");
  expect(compact.querySelector(".row-meta")?.textContent).toBe("2 d");
  const card = createLinkCard(document, item);
  expect(card.querySelector(".site")).toBeNull();
  expect(card.querySelector(".meta")?.textContent).toBe("2 d");
  expect(
    createLinkRow(document, item).querySelector(".meta")?.textContent,
  ).toBe("2 d");
});

test("in the List view the body gives way first, and only the site in the meta line shrinks", () => {
  const site = `${"rất-dài-".repeat(12)}ẪẬẲỖỮỰ.example.vn`;
  const row = createLinkRow(document, { ...pasted, site });
  expect(row.classList.contains("link-row")).toBe(true);
  expect(row.querySelector(":scope > .link-main > .row-body")).not.toBeNull();
  expect(
    row.querySelector(":scope > .link-main > .meta > .site")?.textContent,
  ).toBe(site);
  const css = (sel: string) =>
    cssRule(import.meta.dirname, "link-card.css", sel);
  // The body and the meta wrap inside .link-main: the meta shares the line only when it fits whole.
  expect(css(".link-main")).toMatchObject({
    display: "flex",
    flex: "1 1 0",
    "flex-wrap": "wrap",
    "min-width": "0",
    gap: "var(--space-1) var(--space-3)",
  });
  // A long summary starts from its smallest width, so it never squeezes a short site. That width
  // holds a whole trust label and is at least half the line.
  expect(css(".link-main > .row-body")).toMatchObject({
    flex: "1 1 0",
    "min-width": "max(var(--size-link-sub-min), 50%)",
  });
  // The meta line stays on one line with no cap, so on its own line it has the full width.
  expect(css(".link-main > .meta")).toMatchObject({
    flex: "0 1 auto",
    "flex-wrap": "nowrap",
    "min-width": "0",
  });
  expect(css(".link-main > .meta")["max-width"]).toBeUndefined();
  // Badge, dots and date never shrink; the site does.
  expect(css(".link-main > .meta > :not(.site)").flex).toBe("none");
  expect(css(".link-main > .meta > .site").flex).toBe("0 1 auto");
  expect(css(".link-row .site")).toMatchObject({
    ...MARKS_ROOM,
    "min-width": "0",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
  });
});

test("in the Compact view a long title gives way first, so a short site keeps its width", () => {
  const rule = cssRule(
    import.meta.dirname,
    "link-card.css",
    ".compact-row .row-title",
  );
  expect(rule).toMatchObject({ flex: "1 1 0", "min-width": "0" });
});

test("a link with no app, site, saved date or age has no empty meta line", () => {
  const bare: LinkItem = { title: "Untitled", url: "example.com/x" };
  const card = createLinkCard(document, bare);
  expect(card.querySelector(".meta")).toBeNull();
  expect(card.firstElementChild?.className).toBe("title");
  expect(createLinkRow(document, bare).querySelector(".meta")).toBeNull();
  const compact = createCompactRow(document, bare);
  expect(compact.querySelector(".row-meta")).toBeNull();
  expect(compact.querySelector(".dom")?.textContent).toBe("example.com");
  // With any one part, the line is there.
  expect(
    createLinkCard(document, { ...bare, age: "2 d" }).querySelector(".meta")
      ?.textContent,
  ).toBe("2 d");
});

// Issue 171: the List and Compact rows label what the app wrote, or leave it out.
const ROW_STATUSES = ["pending", "reading", "unreadable", "ai-off"] as const;
const rowCss = (sel: string) =>
  cssRule(import.meta.dirname, "link-card.css", sel);

test("done: the List row's summary is labelled Written by AI, after the summary on its line", () => {
  const row = createLinkRow(document, pasted);
  expect(row.dataset.status).toBe("done");
  const line = row.querySelector(":scope > .link-main > .row-body > .link-sub");
  expect(line?.querySelector(":scope > .row-sub")?.textContent).toBe(
    pasted.summary,
  );
  const label = line?.querySelector(":scope > .trust");
  expect(label?.textContent).toBe("Written by AI");
  expect(label?.classList.contains("trust-ai")).toBe(true);
  expect(line?.lastElementChild).toBe(label);
  expect(row.querySelectorAll(".trust")).toHaveLength(1);
});

test("a guessed summary in the List row is labelled Guess", () => {
  const row = createLinkRow(document, { ...pasted, summaryKind: "guess" });
  const labels = row.querySelectorAll(".trust");
  expect(labels).toHaveLength(1);
  expect(labels[0]?.textContent).toBe("Guess");
  expect(row.textContent).not.toContain("Written by AI");
});

test("loading, error and AI off rows say why there is no summary, with no label", () => {
  for (const status of ROW_STATUSES) {
    const item: LinkItem = { ...pasted, status, summary: "Made-up text." };
    const row = createLinkRow(document, item);
    expect(row.dataset.status).toBe(status);
    expect(row.querySelector(".link-sub")).toBeNull();
    expect(row.querySelector(".trust")).toBeNull();
    expect(row.querySelector(".row-sub")?.textContent).toBe(
      noSummaryText(item),
    );
    expect(row.textContent).not.toContain("Made-up text.");
    const compact = createCompactRow(document, item);
    expect(compact.dataset.status).toBe(status);
    expect(compact.querySelector(".trust")).toBeNull();
  }
});

test("a done link with no summary has no label in the List row", () => {
  const row = createLinkRow(document, { ...pasted, ...noSum });
  expect(row.querySelector(".row-sub")?.textContent).toBe("No summary.");
  expect(row.querySelector(".trust")).toBeNull();
});

test("the rows leave out tags and the reason, from the app or the owner, so nothing shows unlabelled", () => {
  const owner = { tagsKind: "owner", reasonKind: "owner" } as const;
  for (const item of [pasted, { ...pasted, ...owner }]) {
    for (const row of [
      createLinkRow(document, item),
      createCompactRow(document, item),
    ]) {
      expect(row.querySelector(".tags")).toBeNull();
      expect(row.querySelector(".reason")).toBeNull();
      expect(row.textContent).not.toContain("security");
      expect(row.textContent).not.toContain(pasted.reason);
      expect(row.textContent).not.toContain("Guess");
    }
  }
});

test("partial: a summary without tags or reason keeps its label in the List row", () => {
  const row = createLinkRow(document, {
    ...pasted,
    tags: undefined,
    reason: undefined,
  });
  expect(row.querySelector(".link-sub .trust")?.textContent).toBe(
    "Written by AI",
  );
});

test("the Compact row shows no summary and so no label", () => {
  const compact = createCompactRow(document, pasted);
  expect(compact.textContent).toBe(
    "Tauri 2 capabilitiesv2.tauri.app25 Nov 2026",
  );
  expect(compact.querySelector(".trust")).toBeNull();
});

test("the rows take keyboard focus, and the List row's text holds the title, the summary and its label", () => {
  const row = createLinkRow(document, pasted);
  const compact = createCompactRow(document, pasted);
  expect(row.tabIndex).toBe(0);
  expect(compact.tabIndex).toBe(0);
  expect(row.textContent).toContain(pasted.title);
  expect(row.textContent).toContain(`${pasted.summary}Written by AI`);
  document.body.replaceChildren(row, compact);
  row.focus();
  expect(document.activeElement).toBe(row);
  compact.focus();
  expect(document.activeElement).toBe(compact);
  document.body.replaceChildren();
});

// happy-dom has no layout, so these tests hold the CSS contract of each fix. The real layout, at
// 800 x 560 and at 200% zoom, light and dark, on the Records tab that shows every row state, is
// proved in a real browser by tests/acceptance/ds-09-limits.test.mjs (AC3): no text is cut without
// an ellipsis, and each trust label keeps its words inside its pill and off a link row's meta line.

test("overflow: a long Vietnamese summary is cut with its ellipsis and the label stays whole", () => {
  const summary = `${"Mỗi cửa sổ chỉ gọi được những lệnh đã khai báo. ".repeat(8)}ẪẬẲỖỮỰ`;
  const row = createLinkRow(document, { ...pasted, summary });
  const sub = row.querySelector<HTMLElement>(".link-sub > .row-sub");
  expect(sub?.textContent).toBe(summary);
  expect(sub?.title).toBe(summary);
  // The summary line itself is cut only by .row-sub, which has its ellipsis and marks room.
  expect(
    cssRule(import.meta.dirname, "../list-row/list-row.css", ".row-sub"),
  ).toMatchObject({
    ...MARKS_ROOM,
    overflow: "hidden",
    "text-overflow": "ellipsis",
  });
  // The issue 170 rule still holds: the body gives way first, so the site keeps its width.
  expect(rowCss(".link-main > .row-body").flex).toBe("1 1 0");
  expect(
    row.querySelector(":scope > .link-main > .meta > .site")?.textContent,
  ).toBe("v2.tauri.app");
});

test("the List row holds the icon, then .link-main with the body and the meta line", () => {
  const row = createLinkRow(document, pasted);
  const kids = [...row.children];
  expect(kids).toHaveLength(2);
  expect(kids[0]?.tagName.toLowerCase()).toBe("svg");
  expect(kids[1]?.className).toBe("link-main");
  const main = [...(kids[1]?.children ?? [])].map((k) => k.className);
  expect(main).toEqual(["row-body", "meta"]);
  // With no meta line, .link-main holds the body alone.
  const bare = createLinkRow(document, { title: "Untitled", url: "x.com/a" });
  expect(
    [...(bare.querySelector(".link-main")?.children ?? [])].map(
      (k) => k.className,
    ),
  ).toEqual(["row-body"]);
  // The row itself has no wrap rule any more; .link-main wraps, so the icon stays on the first line.
  expect(() => rowCss(".link-row")).toThrow();
});

test("a narrow List row never clips the label: it wraps under the summary, and its words wrap", () => {
  // The line wraps and clips nothing.
  const line = rowCss(".link-row .link-sub");
  expect(line).toMatchObject({
    display: "flex",
    "flex-wrap": "wrap",
    "min-width": "0",
  });
  expect(line.overflow).toBeUndefined();
  // The summary starts from its smallest width and grows up to its own text width, so a short
  // summary keeps the label right after it and a tight line sends the label to the next line.
  expect(rowCss(".link-row .link-sub > .row-sub")).toMatchObject({
    flex: "1 1 0",
    "min-width": "min(var(--size-link-sub-min), 100%)",
    "max-width": "max-content",
  });
  // The label never shrinks or clips; narrower than itself, its words wrap.
  const label = rowCss(".link-row .link-sub > .trust");
  expect(label).toMatchObject({
    flex: "none",
    "max-width": "100%",
    "white-space": "normal",
  });
  expect(label.overflow).toBeUndefined();
});

test("hover, focus-visible and active can be drawn for a still view, and have a look", () => {
  for (const state of ["hover", "focus", "active"] as const) {
    const row = createLinkRow(document, pasted, { forceState: state });
    expect(row.classList.contains(`is-${state}`)).toBe(true);
    const compact = createCompactRow(document, pasted, { forceState: state });
    expect(compact.classList.contains(`is-${state}`)).toBe(true);
  }
  // Pressed: the hover surface and an edge in --control-edge (3:1), drawn inside the row, so the
  // row's bounds stay visible against the pale --line dividers.
  for (const sel of [".compact-row.is-active", ".link-row.is-active"]) {
    expect(rowCss(sel)).toMatchObject({
      background: "var(--head)",
      outline: "var(--border-1) solid var(--control-edge)",
      "outline-offset": "calc(-1 * var(--border-1))",
    });
  }
  expect(rowCss(".compact-row.is-hover").background).toBe("var(--head)");
  // The focus ring wins over the pressed edge in both rows.
  for (const sel of [".compact-row.is-focus", ".link-row.is-focus"]) {
    expect(rowCss(sel).outline).toBe("var(--focus-ring) solid var(--accent)");
  }
});

test("reading: the List row's second line is a status with a spinner and the words, inline", () => {
  const item: LinkItem = { ...pasted, ...noSum, status: "reading" };
  const row = createLinkRow(document, item);
  const status = row.querySelector(".row-sub > [role='status']");
  expect(status?.textContent).toBe("Reading the page");
  expect(status?.querySelector(".spinner")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  expect(row.querySelector(".row-sub")?.textContent).toBe(noSummaryText(item));
  // Inline, so a narrow row cuts the words with the second line's ellipsis.
  expect(rowCss(".link-row .row-sub > .rec-reading").display).toBe("inline");
  for (const other of ["pending", "done", "unreadable", "ai-off"] as const) {
    const quiet = createLinkRow(document, { ...pasted, status: other });
    expect(quiet.querySelector("[role='status']")).toBeNull();
    expect(quiet.querySelector(".spinner")).toBeNull();
  }
});

test("reading: the Compact row shows a spinner after the title, a status named by hidden words and a tooltip", () => {
  const item: LinkItem = { ...pasted, ...noSum, status: "reading" };
  const compact = createCompactRow(document, item);
  const status = compact.querySelector<HTMLElement>(":scope > [role='status']");
  expect(status?.textContent).toBe("Reading the page");
  expect(status?.title).toBe("Reading the page");
  expect(status?.querySelector(".spinner")).not.toBeNull();
  expect(status?.querySelector(".compact-reading-words")?.textContent).toBe(
    "Reading the page",
  );
  expect(status?.previousElementSibling?.className).toBe("row-title");
  expect(status?.nextElementSibling?.className).toBe("dom");
  // Only the spinner takes room, so the site and the date keep theirs.
  expect(rowCss(".compact-row .compact-reading").flex).toBe("none");
  expect(rowCss(".compact-row .compact-reading-words")).toMatchObject({
    position: "absolute",
    width: "var(--border-1)",
    height: "var(--border-1)",
    "clip-path": "inset(50%)",
  });
  for (const other of ["pending", "done", "unreadable", "ai-off"] as const) {
    const quiet = createCompactRow(document, { ...pasted, status: other });
    expect(quiet.querySelector("[role='status']")).toBeNull();
  }
});
