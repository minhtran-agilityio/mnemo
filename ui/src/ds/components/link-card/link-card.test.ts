// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Link } from "lucide";
import { expect, test } from "vitest";
import { cssRule, MARKS_ROOM } from "../../../css-rule";
import { createButton } from "../button/button";
import {
  createCompactRow,
  createLinkCard,
  createLinkRow,
  createLinkView,
  type LinkItem,
  linkHost,
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

// Issue 179: the owner's "Offer both": a pending card whose page could not be reached shows two
// actions, the main one first.
const sm = (label: string, more: { busy?: boolean; disabled?: boolean } = {}) =>
  createButton(document, { label, size: "sm", ...more });
const slotOf = (card: HTMLElement) =>
  card.querySelector<HTMLElement>(":scope > .lcard-action");
const inSlot = (card: HTMLElement) => [...(slotOf(card)?.children ?? [])];
const pending: LinkItem = { ...pasted, ...noSum, status: "pending" };

test("the slot holds every action in the order given, the main one first, as the card's last part", () => {
  const later = sm("Summarize later");
  const paste = sm("Paste the text");
  const card = createLinkCard(document, pending, { actions: [later, paste] });
  expect(inSlot(card)).toEqual([later, paste]);
  expect(card.lastElementChild).toBe(slotOf(card));
  expect(card.querySelectorAll(".lcard-action")).toHaveLength(1);
  const reversed = createLinkCard(document, pending, {
    actions: [sm("Paste the text"), sm("Summarize later")],
  });
  expect(inSlot(reversed).map((b) => b.textContent)).toEqual([
    "Paste the text",
    "Summarize later",
  ]);
});

test("no actions, an empty list or no options: no slot", () => {
  expect(slotOf(createLinkCard(document, pending))).toBeNull();
  expect(slotOf(createLinkCard(document, pending, {}))).toBeNull();
  expect(slotOf(createLinkCard(document, pending, { actions: [] }))).toBeNull();
});

test("action is a one-item shorthand for actions; a non-empty actions wins, an empty one falls back to action", () => {
  const one = sm("Paste the text");
  const short = createLinkCard(document, pending, { action: one });
  expect(inSlot(short)).toEqual([one]);
  const long = createLinkCard(document, pending, {
    actions: [sm("Paste the text")],
  });
  expect(slotOf(long)?.outerHTML).toBe(slotOf(short)?.outerHTML);
  const ignored = sm("Ignored");
  const later = sm("Summarize later");
  const paste = sm("Paste the text");
  const both = createLinkCard(document, pending, {
    action: ignored,
    actions: [later, paste],
  });
  expect(inSlot(both)).toEqual([later, paste]);
  expect(both.contains(ignored)).toBe(false);
  // An empty actions list does not drop the only action: the shorthand shows.
  const only = sm("Paste the text");
  const fallback = createLinkCard(document, pending, {
    action: only,
    actions: [],
  });
  expect(inSlot(fallback)).toEqual([only]);
});

test("the main action is a default sm button and the others ghost sm; the card keeps the variants the screen picks", () => {
  const later = sm("Summarize later");
  const paste = createButton(document, {
    label: "Paste the text",
    size: "sm",
    variant: "ghost",
  });
  const before = [later.className, paste.className];
  const card = createLinkCard(document, pending, { actions: [later, paste] });
  expect(inSlot(card)).toEqual([later, paste]);
  expect([later.className, paste.className]).toEqual(before);
  expect(later.classList.contains("btn-ghost")).toBe(false);
  expect(paste.classList.contains("btn-ghost")).toBe(true);
  // A list holds many cards, and a view has one primary action: no card button is primary.
  expect(card.querySelector(".btn-primary")).toBeNull();
  // The slot's rules name no variant, so the card never restyles one.
  const css = readFileSync(
    resolve(import.meta.dirname, "link-card.css"),
    "utf8",
  );
  expect(css).not.toMatch(/\.lcard-action[^{]*\.btn-(primary|ghost|danger)/);
});

test("two actions: Tab reaches them in order, each has its name and clicks on its own", () => {
  const clicks: string[] = [];
  const later = createButton(document, {
    label: "Summarize later",
    size: "sm",
    onClick: () => clicks.push("later"),
  });
  const paste = createButton(document, {
    label: "Paste the text",
    size: "sm",
    onClick: () => clicks.push("paste"),
  });
  const card = createLinkCard(document, pending, { actions: [later, paste] });
  document.body.append(card);
  const buttons = [...card.querySelectorAll("button")];
  expect(buttons).toEqual([later, paste]);
  // Document order is the Tab order: no tabindex changes it.
  for (const b of buttons) expect(b.hasAttribute("tabindex")).toBe(false);
  expect(buttons.map((b) => b.textContent)).toEqual([
    "Summarize later",
    "Paste the text",
  ]);
  paste.focus();
  expect(document.activeElement).toBe(paste);
  later.click();
  paste.click();
  expect(clicks).toEqual(["later", "paste"]);
  card.remove();
});

test("a busy or disabled action next to an enabled one: only the enabled one clicks", () => {
  let busyClicks = 0;
  let pasteClicks = 0;
  const busy = createButton(document, {
    label: "Summarize later",
    size: "sm",
    busy: true,
    onClick: () => busyClicks++,
  });
  const paste = createButton(document, {
    label: "Paste the text",
    size: "sm",
    onClick: () => pasteClicks++,
  });
  const card = createLinkCard(document, pending, { actions: [busy, paste] });
  expect(inSlot(card)).toEqual([busy, paste]);
  expect(busy.getAttribute("aria-busy")).toBe("true");
  busy.click();
  paste.click();
  expect(busyClicks).toBe(0);
  expect(pasteClicks).toBe(1);
  const off = sm("Summarize later", { disabled: true });
  const on = sm("Paste the text");
  const offCard = createLinkCard(document, pending, { actions: [off, on] });
  expect(inSlot(offCard)).toEqual([off, on]);
  expect(off.disabled).toBe(true);
  expect(on.disabled).toBe(false);
});

test("long and Vietnamese labels stay whole in the slot, as text", () => {
  const labels = [
    "Tóm tắt sau khi có mạng trở lại",
    "Dán toàn bộ nội dung của trang vào đây",
  ];
  const card = createLinkCard(document, pending, {
    actions: labels.map((l) => sm(l)),
  });
  expect(inSlot(card).map((b) => b.textContent)).toEqual(labels);
});

test("the slot wraps its actions from its start edge with a token gap, and a long label wraps in its button", () => {
  const slot = cssRule(
    import.meta.dirname,
    "link-card.css",
    ".lcard .lcard-action",
  );
  expect(slot.display).toBe("flex");
  expect(slot["flex-wrap"]).toBe("wrap");
  expect(slot["justify-content"]).toBe("flex-start");
  expect(slot.gap).toBe("var(--space-2)");
  expect(slot["min-width"]).toBe("0");
  const item = cssRule(
    import.meta.dirname,
    "link-card.css",
    ".lcard .lcard-action > .btn",
  );
  expect(item["max-width"]).toBe("100%");
  expect(item["min-width"]).toBe("0");
  expect(item["overflow-wrap"]).toBe("anywhere");
  // No auto margin, so a wrapped button starts at the slot's edge; no padding, so an icon-only
  // button keeps its own.
  expect(item["margin-inline-start"]).toBeUndefined();
  expect(item.margin).toBeUndefined();
  expect(item.padding).toBeUndefined();
  expect(item["padding-block"]).toBeUndefined();
  expect(item["padding-inline"]).toBeUndefined();
  const label = cssRule(
    import.meta.dirname,
    "link-card.css",
    ".lcard .lcard-action > .btn:not(.btn-icon)",
  );
  expect(label).toEqual({ "padding-block": "var(--space-1)" });
  // Only the button part is touched: no rule styles any node in the slot.
  expect(() =>
    cssRule(import.meta.dirname, "link-card.css", ".lcard .lcard-action > *"),
  ).toThrow();
});

test("an icon-only button in the slot keeps its classes, so its own padding applies", () => {
  const icon = createButton(document, {
    label: "More actions",
    size: "sm",
    iconOnly: true,
    icon: Link,
  });
  const card = createLinkCard(document, pending, {
    actions: [sm("Summarize later"), icon],
  });
  expect(inSlot(card)[1]).toBe(icon);
  expect(icon.matches(".lcard .lcard-action > .btn")).toBe(true);
  expect(icon.matches(".lcard .lcard-action > .btn:not(.btn-icon)")).toBe(
    false,
  );
  expect(icon.getAttribute("aria-label")).toBe("More actions");
  const own = cssRule(
    resolve(import.meta.dirname, "../button"),
    "button.css",
    ".btn-icon",
  );
  expect(own.padding).toBe("0");
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
  // The List row shows the host of the URL too (issue 172), as the Compact row does.
  const row = createLinkRow(document, item);
  expect(row.querySelector(".site")?.textContent).toBe("v2.tauri.app");
  expect(row.querySelector(".meta")?.textContent).toBe("v2.tauri.app·2 d");
});

test("in the List view the body gives way first, and only the site in the meta line shrinks", () => {
  const site = `${"rất-dài-".repeat(12)}ẪẬẲỖỮỰ.example.vn`;
  const row = createLinkRow(document, { ...pasted, site });
  expect(row.classList.contains("link-row")).toBe(true);
  expect(row.querySelector(":scope > .link-main > .row-body")).not.toBeNull();
  expect(
    row.querySelector(":scope > .link-main > .meta > .link-host > .site")
      ?.textContent,
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
  // holds a whole trust label and is at least half the line, and never more than the whole line
  // (issue 172: with no cap, a list of 140px or less overflowed).
  expect(css(".link-main > .row-body")).toMatchObject({
    flex: "1 1 0",
    "min-width": "min(max(var(--size-link-sub-min), 50%), 100%)",
  });
  // The meta line has no cap, so on its own line it has the full width. It wraps only between the
  // badge and .link-host (the site and the date, one piece).
  expect(css(".link-main > .meta")).toMatchObject({
    flex: "0 1 auto",
    "flex-wrap": "wrap",
    "min-width": "0",
  });
  expect(css(".link-main > .meta")["max-width"]).toBeUndefined();
  expect(css(".link-main > .meta > .app").flex).toBe("none");
  // Dots and date never shrink; the site does, from --size-link-site-min up to its own width, so
  // the date wraps only when even that much site has no room.
  expect(css(".link-main .link-host")).toMatchObject({
    flex: "0 1 auto",
    gap: "var(--space-1)",
    "min-width": "0",
  });
  expect(css(".link-main .link-host > :not(.site)").flex).toBe("none");
  // The 8ch floor is on the flex basis only, capped by the site's own width: a min-width would win
  // over max-width and give a host shorter than 8ch ("t.me") an 8ch box with a gap after it.
  expect(css(".link-main .link-host > .site")).toMatchObject({
    flex: "1 1 var(--size-link-site-min)",
    "min-width": "0",
    "max-width": "max-content",
  });
  expect(css(".link-row .site")).toMatchObject({
    ...MARKS_ROOM,
    "min-width": "0",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
  });
});

test("in the Compact view a long title gives way only down to its readable minimum, and the site is cut first", () => {
  const css = (sel: string) =>
    cssRule(import.meta.dirname, "link-card.css", sel);
  // The title takes the room that is left, down to 8ch of its own font (or the whole line).
  expect(css(".compact-row .row-title")).toMatchObject({
    flex: "1 1 0",
    "min-width": "min(var(--size-link-site-min), 100%)",
    "max-width": "max-content",
  });
  // The room left when both are whole goes to an auto end margin on the title, or on the spinner
  // of a reading row: parts that never wrap. The site and the date, which can wrap, carry no auto
  // margin, so a wrapped one starts at the row's edge.
  expect(css(".compact-row > .row-title")["margin-inline-end"]).toBe("auto");
  expect(css(".compact-row > .compact-reading")["margin-inline-end"]).toBe(
    "auto",
  );
  expect(
    css('.compact-row[data-status="reading"] > .row-title')[
      "margin-inline-end"
    ],
  ).toBe("0");
  // The site starts at 8ch, capped by its own width (a short host's box is its text), and grows as
  // fast as the title. No 50% cap that left the title a few pixels (issue 175).
  const dom = css(".compact-row .dom");
  expect(dom).toMatchObject({
    flex: "1 1 var(--size-link-site-min)",
    "min-width": "0",
    "max-width": "max-content",
  });
  // When the smallest title, site and the whole date do not fit one line, the date wraps under the
  // title rather than squeezing the title.
  expect(css(".compact-row")).toMatchObject({
    "flex-wrap": "wrap",
    gap: "var(--space-1) var(--space-2)",
  });
  // The date never shrinks (the list row part's rule).
  expect(
    cssRule(
      resolve(import.meta.dirname, "..", "list-row"),
      "list-row.css",
      ".row-meta",
    ),
  ).toMatchObject({ flex: "none", "white-space": "nowrap" });
});

test("a compact row with a long Vietnamese title and host keeps both whole in its text and tooltips (text only; the layout is checked in ds-09)", () => {
  const title = `${"Hướng dẫn đầy đủ về quyền và khả năng — Ở ĐÂU, KHI NÀO? ".repeat(4)}`;
  const site = `${"rất-nhiều-tên-miền-con.".repeat(4)}tài-liệu.v2.tauri.app`;
  const row = createCompactRow(document, { ...pasted, title, site });
  expect(row.querySelector(".row-title")?.textContent).toBe(title);
  expect(row.querySelector<HTMLElement>(".row-title")?.title).toBe(title);
  expect(row.querySelector(".dom")?.textContent).toBe(site);
  expect(row.querySelector<HTMLElement>(".dom")?.title).toBe(pasted.url);
  // The parts keep their order: title, site, date.
  expect([...row.children].map((c) => c.className)).toEqual([
    "row-title",
    "dom",
    "row-meta",
  ]);
});

test("a link with no app, site, saved date or age has no empty meta line", () => {
  const bare: LinkItem = { title: "Untitled", url: "example.com/x" };
  const card = createLinkCard(document, bare);
  expect(card.querySelector(".meta")).toBeNull();
  expect(card.firstElementChild?.className).toBe("title");
  // The rows show the host of the URL; with no URL either, the List row has no meta line.
  expect(
    createLinkRow(document, bare).querySelector(".meta")?.textContent,
  ).toBe("example.com");
  expect(
    createLinkRow(document, { ...bare, url: "" }).querySelector(".meta"),
  ).toBeNull();
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
    row.querySelector(":scope > .link-main > .meta > .link-host > .site")
      ?.textContent,
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
  const bare = createLinkRow(document, { title: "Untitled", url: "" });
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
  // The spinner box holds its hidden words, so they never land past the row's scroll box and widen
  // the page (issue 175: 397px in a 385px window at 200% zoom).
  expect(rowCss(".compact-row .compact-reading").position).toBe("relative");
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

// Issue 172: the host without the scheme, the full site for keyboard users, and room for a short
// host in a narrow List row.
test("the host of a link with no site never shows the scheme", () => {
  const host = (url: string, site?: string) =>
    linkHost({ title: "t", url, site });
  expect(host("https://v2.tauri.app/security/capabilities")).toBe(
    "v2.tauri.app",
  );
  expect(host("v2.tauri.app/security/capabilities")).toBe("v2.tauri.app");
  expect(host("http://user:pw@example.com:8080/a?b#c")).toBe(
    "example.com:8080",
  );
  expect(host("https://example.com?q=1")).toBe("example.com");
  expect(host("localhost:1420/a")).toBe("localhost:1420");
  expect(host("  https://viblo.asia/p  ")).toBe("viblo.asia");
  // A host with Vietnamese letters stays as written, not punycode.
  expect(host("https://tài-liệu.vn/a")).toBe("tài-liệu.vn");
  expect(host("tài-liệu.vn/a")).toBe("tài-liệu.vn");
  // Only the host text decides: a path outside ASCII leaves an ASCII host to new URL(), which
  // lowercases it and drops a default port.
  expect(host("https://VnExpress.net/thời-sự")).toBe("vnexpress.net");
  expect(host("https://vnexpress.net/a")).toBe("vnexpress.net");
  expect(host("https://example.com:443/tức")).toBe("example.com");
  expect(host("V2.Tauri.App/x")).toBe("v2.tauri.app");
  // A host outside ASCII is lowercased here, and its default port dropped; another port stays.
  expect(host("https://Tài-Liệu.vn:443/tức")).toBe("tài-liệu.vn");
  expect(host("http://tài-liệu.vn:80/a")).toBe("tài-liệu.vn");
  expect(host("https://tài-liệu.vn:8443/a")).toBe("tài-liệu.vn:8443");
  // A protocol-relative URL has a host; a file URL has none.
  expect(host("//v2.tauri.app/x")).toBe("v2.tauri.app");
  expect(host("file:///home/me/notes.txt")).toBe("");
  // A scheme that parses with no host shows no site, never the scheme or the text after it.
  expect(host("about:blank")).toBe("");
  expect(host("file:/a")).toBe("");
  expect(host("javascript:alert(1)")).toBe("");
  expect(host("mailto:me@x.com")).toBe("");
  // Where URL.canParse is missing (an older web view), the text is read alone, with the same hosts.
  const canParse = URL.canParse;
  try {
    Object.defineProperty(URL, "canParse", {
      value: undefined,
      configurable: true,
    });
    expect(host("https://VnExpress.net:443/thời-sự")).toBe("vnexpress.net");
    expect(host("https://tài-liệu.vn/a")).toBe("tài-liệu.vn");
    expect(host("v2.tauri.app/x")).toBe("v2.tauri.app");
    expect(host("//v2.tauri.app/x")).toBe("v2.tauri.app");
    expect(host("localhost:1420/a")).toBe("localhost:1420");
    for (const none of ["about:blank", "file:/a", "mailto:me@x.com"])
      expect(host(none)).toBe("");
  } finally {
    Object.defineProperty(URL, "canParse", {
      value: canParse,
      configurable: true,
    });
  }
  // The site wins; an empty or blank site falls back to the URL.
  expect(host("https://a.example/x", "b.example")).toBe("b.example");
  expect(host("https://a.example/x", "  ")).toBe("a.example");
  expect(host("")).toBe("");
  for (const make of [createCompactRow, createLinkRow]) {
    const row = make(document, {
      ...pasted,
      site: undefined,
      url: "https://v2.tauri.app/security/capabilities",
    });
    expect(row.textContent).not.toContain("https:");
    expect(row.textContent).toContain("v2.tauri.app");
  }
  // A URL with no host renders no site at all, not an empty span.
  const noHost = { ...pasted, site: undefined, url: "file:///home/me/a.txt" };
  const compact = createCompactRow(document, noHost);
  expect(compact.querySelector(".dom")).toBeNull();
  expect(compact.querySelector(".row-meta")?.textContent).toBe("25 Nov 2026");
  const list = createLinkRow(document, noHost);
  expect(list.querySelector(".site")).toBeNull();
  expect(list.querySelector(".meta")?.textContent).toBe("25 Nov 2026");
  const relative = { ...noHost, url: "//v2.tauri.app/x" };
  expect(
    createCompactRow(document, relative).querySelector(".dom")?.textContent,
  ).toBe("v2.tauri.app");
  expect(
    createLinkRow(document, relative).querySelector(".site")?.textContent,
  ).toBe("v2.tauri.app");
});

test("the List row's meta line: the badge, then the site and the date as one piece, no dot after the badge", () => {
  const row = createLinkRow(document, { ...pasted, app: "telegram" });
  const meta = row.querySelector(":scope > .link-main > .meta");
  expect([...(meta?.children ?? [])].map((c) => c.className)).toEqual([
    "app app-telegram",
    "meta link-host",
  ]);
  const host = meta?.querySelector(":scope > .link-host");
  expect([...(host?.children ?? [])].map((c) => c.className)).toEqual([
    "site",
    "sep",
    "",
  ]);
  expect(host?.textContent).toBe("v2.tauri.app·25 Nov 2026");
  expect(meta?.querySelectorAll(":scope > .sep")).toHaveLength(0);
  // With no app, the meta line holds the site and the date alone; with only an app, the badge.
  const plain = createLinkRow(document, pasted).querySelector(".meta");
  expect([...(plain?.children ?? [])].map((c) => c.className)).toEqual([
    "meta link-host",
  ]);
  const badgeOnly = createLinkRow(document, {
    title: "t",
    url: "",
    app: "zalo",
  }).querySelector(".meta");
  expect(badgeOnly?.textContent).toBe("Zalo");
  expect(badgeOnly?.querySelector(".link-host")).toBeNull();
});

test("keyboard focus shows the full site: a cut host wraps in place instead of its ellipsis", () => {
  const site = `${"rất-nhiều-tên-miền-con.".repeat(4)}tài-liệu.v2.tauri.app`;
  const row = createLinkRow(document, { ...pasted, site });
  const compact = createCompactRow(document, { ...pasted, site });
  // The full host is in the text (a screen reader reads it all) and in the tooltip.
  expect(row.querySelector(".site")?.textContent).toBe(site);
  expect(row.querySelector<HTMLElement>(".site")?.title).toBe(site);
  expect(row.textContent).toContain(site);
  expect(compact.querySelector(".dom")?.textContent).toBe(site);
  // The rows take keyboard focus; focus-visible (or the catalog's drawn focus) unwraps the host.
  document.body.replaceChildren(row, compact);
  row.focus();
  expect(document.activeElement).toBe(row);
  compact.focus();
  expect(document.activeElement).toBe(compact);
  document.body.replaceChildren();
  for (const sel of [
    ".link-row:focus-visible .site",
    ".link-row.is-focus .site",
    ".compact-row:focus-visible .dom",
    ".compact-row.is-focus .dom",
  ]) {
    expect(rowCss(sel)).toMatchObject({
      "overflow-wrap": "anywhere",
      "white-space": "normal",
    });
  }
  // In the Compact row the wrapped host keeps its marks room inside the row, off the focus ring.
  expect(rowCss(".compact-row.is-focus .dom")["margin-block"]).toBe("0");
  expect(rowCss(".compact-row").padding).toBe("var(--space-1) var(--space-3)");
});

test("the smallest widths of the List row are tokens: a whole trust label, and a readable site", () => {
  const tokens = readFileSync(
    resolve(import.meta.dirname, "..", "..", "tokens.css"),
    "utf8",
  );
  // 6.75rem (108px) holds the 104.5px "Written by AI" label; 6rem (96px) did not.
  expect(tokens).toMatch(/--size-link-sub-min: 6\.75rem;/);
  expect(tokens).toMatch(/--size-link-site-min: 8ch;/);
});

// Issue 186: the "Already saved" note and the folder line.
const wiki: LinkItem = {
  title: "Embedded database - Wikipedia",
  url: "https://en.wikipedia.org/wiki/Embedded_database",
  site: "en.wikipedia.org",
  saved: "26 Nov 2026",
  status: "done",
  summary: "A database engine built into the app that uses it.",
};

test("empty: with no folder and no note, the card shows neither line", () => {
  const card = createLinkCard(document, wiki);
  expect(card.querySelector(".lcard-notice")).toBeNull();
  expect(card.querySelector(".lcard-folder")).toBeNull();
  expect(card.textContent).not.toContain("Already saved");
  // An empty or blank folder is no folder.
  for (const folder of ["", "   "]) {
    const blank = createLinkCard(document, {
      ...wiki,
      folder,
      folderIsGuess: true,
    });
    expect(blank.querySelector(".lcard-folder")).toBeNull();
  }
  expect(
    createLinkCard(document, { ...wiki, alreadySaved: false }).querySelector(
      ".lcard-notice",
    ),
  ).toBeNull();
});

test("Already saved is an info note on top of the card, read as text", () => {
  const card = createLinkCard(
    document,
    { ...wiki, alreadySaved: true },
    { thumb: true },
  );
  const note = card.querySelector(".lcard-notice");
  expect(note?.textContent).toBe("Already saved");
  // Information, not an error: the info pill, never a bad or warn tint, and no alert role.
  expect(note?.classList.contains("pill-info")).toBe(true);
  expect(note?.classList.contains("pill-bad")).toBe(false);
  expect(note?.getAttribute("role")).toBeNull();
  // Its icon is decorative; the words carry the meaning.
  expect(note?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  // It sits above the meta line and the title, after the picture box.
  const kids = [...card.children];
  expect(kids.indexOf(note as Element)).toBe(1);
  expect(kids.indexOf(note as Element)).toBeLessThan(
    kids.indexOf(card.querySelector(".meta") as Element),
  );
  // The rows do not show it.
  expect(
    createLinkRow(document, { ...wiki, alreadySaved: true }).textContent,
  ).not.toContain("Already saved");
  expect(
    createCompactRow(document, { ...wiki, alreadySaved: true }).textContent,
  ).not.toContain("Already saved");
});

test("the folder line says where the link is filed, labelled Guess when the app chose it", () => {
  const guessed = createLinkCard(document, {
    ...wiki,
    folder: "Dev tools",
    folderIsGuess: true,
  });
  const line = guessed.querySelector(".lcard-folder");
  expect(line?.textContent).toBe("Filed in Dev toolsGuess");
  expect(line?.querySelector(".lcard-folder-name")?.textContent).toBe(
    "Dev tools",
  );
  expect(line?.querySelector(".trust-guess")?.textContent).toBe("Guess");
  expect(line?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  // The owner's folder (or the app's default with AI off) has no label.
  const unsorted = createLinkCard(document, {
    ...wiki,
    status: "ai-off",
    summary: undefined,
    folder: "Unsorted",
  });
  expect(unsorted.querySelector(".lcard-folder")?.textContent).toBe(
    "Filed in Unsorted",
  );
  expect(unsorted.querySelector(".lcard-folder .trust")).toBeNull();
  // The line comes after the reason and before the actions.
  const full = createLinkCard(
    document,
    { ...wiki, reason: "For the storage module.", folder: "Dev tools" },
    { action: createButton(document, { label: "Open" }) },
  );
  const kids = [...full.children];
  const at = (sel: string) => kids.indexOf(full.querySelector(sel) as Element);
  expect(at(".reason")).toBeLessThan(at(".lcard-folder"));
  expect(at(".lcard-folder")).toBeLessThan(at(".lcard-action"));
  // The rows do not show it.
  expect(
    createLinkRow(document, { ...wiki, folder: "Dev tools" }).textContent,
  ).not.toContain("Dev tools");
});

test("partial: a card that is not done still shows its folder", () => {
  for (const status of [
    "pending",
    "reading",
    "unreadable",
    "ai-off",
  ] as const) {
    const card = createLinkCard(document, {
      ...wiki,
      summary: undefined,
      status,
      folder: "Unsorted",
    });
    expect(card.querySelector(".lcard-folder-name")?.textContent).toBe(
      "Unsorted",
    );
  }
});

test("the note and the folder line together, with the folder name as text", () => {
  const card = createLinkCard(document, {
    ...wiki,
    alreadySaved: true,
    folder: "<b>Dev</b> tools",
    folderIsGuess: true,
  });
  expect(card.querySelector(".lcard-notice")).not.toBeNull();
  expect(card.querySelector(".lcard-folder-name")?.textContent).toBe(
    "<b>Dev</b> tools",
  );
  expect(card.querySelector(".lcard-folder b")).toBeNull();
});

test("overflow: a long folder name is cut, with its full text in the tooltip and room for marks", () => {
  const long =
    "Tài liệu kỹ thuật về cơ sở dữ liệu nhúng và các công cụ phát triển ứng dụng máy tính để bàn";
  const card = createLinkCard(document, {
    ...wiki,
    folder: long,
    folderIsGuess: true,
  });
  const name = card.querySelector<HTMLElement>(".lcard-folder-name");
  expect(name?.textContent).toBe(long);
  expect(name?.title).toBe(long);
  const rule = cssRule(
    import.meta.dirname,
    "link-card.css",
    ".lcard .lcard-folder-name",
  );
  expect(rule).toMatchObject({
    "min-width": "0",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    ...MARKS_ROOM,
  });
  // The words and the name shrink as one piece; the Guess label stays whole and wraps under them.
  expect(
    cssRule(import.meta.dirname, "link-card.css", ".lcard .lcard-folder"),
  ).toMatchObject({ display: "flex", "flex-wrap": "wrap", "min-width": "0" });
  expect(
    cssRule(import.meta.dirname, "link-card.css", ".lcard .lcard-folder-where"),
  ).toMatchObject({ "min-width": "0", "white-space": "pre" });
  expect(
    cssRule(
      import.meta.dirname,
      "link-card.css",
      ".lcard .lcard-folder > .trust",
    ),
  ).toMatchObject({ flex: "none" });
  // A note on a card narrower than its words wraps inside the pill.
  expect(
    cssRule(import.meta.dirname, "link-card.css", ".lcard .lcard-notice"),
  ).toMatchObject({ "max-width": "100%", "white-space": "normal" });
});

// Issue 193: the app's reason for the folder, labelled Guess.
const reasoned: LinkItem = {
  ...wiki,
  folder: "Dev tools",
  folderIsGuess: true,
  folderReason: "It is a reference page for a database engine.",
};

test("empty: with no folder reason the folder line is as before", () => {
  for (const folderReason of [undefined, "", "   "]) {
    const card = createLinkCard(document, { ...reasoned, folderReason });
    const line = card.querySelector(".lcard-folder");
    expect(line?.querySelector(".lcard-folder-reason")).toBeNull();
    expect(line?.textContent).toBe("Filed in Dev toolsGuess");
    // The one Guess label sits after the folder name.
    expect(line?.lastElementChild?.classList.contains("trust-guess")).toBe(
      true,
    );
  }
});

test("success: a guessed folder shows its reason under the name, with one Guess label after it", () => {
  const card = createLinkCard(document, reasoned);
  const line = card.querySelector(".lcard-folder");
  const why = line?.querySelector(".lcard-folder-reason");
  expect(why?.querySelector(".lcard-folder-reason-text")?.textContent).toBe(
    "It is a reference page for a database engine.",
  );
  expect(why?.querySelector(".trust-guess")?.textContent).toBe("Guess");
  // One label for the folder and its reason, after the reason, as the bookmark reason has it.
  expect(line?.querySelectorAll(".trust")).toHaveLength(1);
  expect(why?.lastElementChild?.classList.contains("trust-guess")).toBe(true);
  // The reason comes after the folder name; a screen reader reads the folder, the reason, then Guess.
  expect(line?.textContent).toBe(
    "Filed in Dev toolsIt is a reference page for a database engine.Guess",
  );
  // The reason is text, not markup, and plain text with no role of its own.
  const tagged = createLinkCard(document, {
    ...reasoned,
    folderReason: "<b>Docs</b>",
  });
  expect(tagged.querySelector(".lcard-folder-reason-text")?.textContent).toBe(
    "<b>Docs</b>",
  );
  expect(tagged.querySelector(".lcard-folder-reason b")).toBeNull();
  expect(why?.getAttribute("role")).toBeNull();
});

test("a reason without folderIsGuess (the owner moved the link) is not shown", () => {
  for (const folderIsGuess of [false, undefined]) {
    const card = createLinkCard(document, { ...reasoned, folderIsGuess });
    expect(card.querySelector(".lcard-folder-reason")).toBeNull();
    expect(card.querySelector(".lcard-folder .trust")).toBeNull();
    expect(card.textContent).not.toContain("reference page");
  }
  // No folder: no line, so no reason either.
  const none = createLinkCard(document, { ...reasoned, folder: undefined });
  expect(none.querySelector(".lcard-folder")).toBeNull();
  expect(none.textContent).not.toContain("reference page");
});

test("partial: a card that is not done hides the folder reason and keeps the folder's Guess label (rule 1)", () => {
  for (const status of [
    "pending",
    "reading",
    "unreadable",
    "ai-off",
  ] as const) {
    const card = createLinkCard(document, {
      ...reasoned,
      summary: undefined,
      status,
    });
    expect(card.querySelector(".lcard-folder-reason")).toBeNull();
    expect(card.textContent).not.toContain("reference page");
    expect(card.querySelector(".lcard-folder")?.textContent).toBe(
      "Filed in Dev toolsGuess",
    );
    expect(
      card
        .querySelector(".lcard-folder")
        ?.lastElementChild?.classList.contains("trust-guess"),
    ).toBe(true);
  }
});

test("AI off: the card shows folderIsGuess as the screen passes it (the core decides it)", () => {
  // A link filed with AI off: the core files it in Unsorted with folderIsGuess false.
  const unsorted = createLinkCard(document, {
    ...reasoned,
    summary: undefined,
    status: "ai-off",
    folder: "Unsorted",
    folderIsGuess: false,
  });
  expect(unsorted.querySelector(".lcard-folder")?.textContent).toBe(
    "Filed in Unsorted",
  );
  expect(unsorted.querySelector(".lcard-folder .trust")).toBeNull();
  expect(unsorted.querySelector(".lcard-folder-reason")).toBeNull();
  // The card never overrides the flag: a guessed folder keeps its label with AI off.
  const guessed = createLinkCard(document, {
    ...reasoned,
    summary: undefined,
    status: "ai-off",
  });
  expect(guessed.querySelector(".lcard-folder .trust-guess")).not.toBeNull();
  expect(guessed.querySelector(".lcard-folder-reason")).toBeNull();
});

test("the rows show no folder reason", () => {
  expect(createLinkRow(document, reasoned).textContent).not.toContain(
    "reference page",
  );
  expect(createCompactRow(document, reasoned).textContent).not.toContain(
    "reference page",
  );
});

test("overflow: a long or Vietnamese reason wraps under the name, in secondary text from tokens", () => {
  const long =
    "Đây là trang tham khảo về một hệ quản trị cơ sở dữ liệu nhúng, averyveryveryveryverylongwordwithnobreak.";
  const card = createLinkCard(document, { ...reasoned, folderReason: long });
  expect(card.querySelector(".lcard-folder-reason-text")?.textContent).toBe(
    long,
  );
  // It takes its own line (flex-basis 100%) and wraps, at any character if it must.
  expect(
    cssRule(
      import.meta.dirname,
      "link-card.css",
      ".lcard .lcard-folder-reason",
    ),
  ).toMatchObject({
    display: "flex",
    flex: "1 1 100%",
    "flex-wrap": "wrap",
    "min-width": "0",
    "padding-inline-start": "calc(var(--icon-sm) + var(--space-1))",
    color: "var(--muted)",
    "font-size": "var(--text-sm)",
  });
  expect(
    cssRule(
      import.meta.dirname,
      "link-card.css",
      ".lcard .lcard-folder-reason-text",
    ),
  ).toMatchObject({ "min-width": "0", "overflow-wrap": "anywhere" });
  // The label after the reason never shrinks.
  expect(
    cssRule(
      import.meta.dirname,
      "link-card.css",
      ".lcard .lcard-folder-reason > .trust",
    ),
  ).toMatchObject({ flex: "none" });
});

// Issue 205: open a link and per-item actions in the three views.
const pho: LinkItem = {
  title: "Phở – Wikipedia tiếng Việt",
  url: "https://vi.wikipedia.org/wiki/Ph%E1%BB%9F",
  site: "vi.wikipedia.org",
  summary: "Một món ăn.",
};
const pendingLink: LinkItem = { ...unread, status: "pending" };

function actionButtons(doc: Document, onClick: (l: string) => void): Node[] {
  return ["Summarize later", "Paste the text"].map((label) =>
    createButton(doc, { label, size: "sm", onClick: () => onClick(label) }),
  );
}

const builders: [string, (o: object) => HTMLElement][] = [
  ["card", (o) => createLinkCard(document, pho, o)],
  ["list row", (o) => createLinkRow(document, pho, o)],
  ["compact row", (o) => createCompactRow(document, pho, o)],
];

for (const [name, build] of builders) {
  test(`${name}: a click opens with the item, once per click`, () => {
    const opened: LinkItem[] = [];
    const box = build({ onOpen: (i: LinkItem) => opened.push(i) });
    expect(box.dataset.openable).toBe("true");
    box.click();
    expect(opened).toEqual([pho]);
    box.querySelector<HTMLElement>(".link-open")?.click();
    expect(opened).toHaveLength(2);
  });

  test(`${name}: the title is a button named by the title, text only`, () => {
    const box = build({ onOpen: () => {} });
    const button = box.querySelector<HTMLButtonElement>("button.link-open");
    expect(button?.type).toBe("button");
    expect(button?.textContent).toBe(pho.title);
    expect(button?.tabIndex).toBe(0);
    // One tab stop: the row or card itself is not focusable.
    expect(box.tabIndex).not.toBe(0);
  });

  test(`${name}: without onOpen nothing is openable`, () => {
    const box = build({});
    expect(box.dataset.openable).toBeUndefined();
    expect(box.querySelector(".link-open")).toBeNull();
  });

  test(`${name}: a click on an action does not open`, () => {
    const opened: LinkItem[] = [];
    const clicked: string[] = [];
    const box = build({
      onOpen: (i: LinkItem) => opened.push(i),
      actions: actionButtons(document, (l) => clicked.push(l)),
    });
    for (const b of box.querySelectorAll<HTMLButtonElement>(
      ".link-actions button, .lcard-action button",
    ))
      b.click();
    expect(clicked).toEqual(["Summarize later", "Paste the text"]);
    expect(opened).toEqual([]);
  });

  test(`${name}: a disabled action stays disabled and does not open`, () => {
    const opened: LinkItem[] = [];
    const off = createButton(document, {
      label: "Summarize later",
      size: "sm",
      disabled: true,
    });
    build({ onOpen: (i: LinkItem) => opened.push(i), actions: [off] });
    off.click();
    expect(off.disabled).toBe(true);
    expect(opened).toEqual([]);
  });
}

test("rows carry their actions in a trailing slot; none, no slot", () => {
  for (const make of [createLinkRow, createCompactRow]) {
    const row = make(document, pho, {
      actions: actionButtons(document, () => {}),
    });
    // The List row holds them in .link-main (so it fills the row); the Compact row after its text.
    const holder = row.classList.contains("link-row")
      ? row.querySelector(".link-main")
      : row;
    const slot = holder?.querySelector(":scope > .link-actions");
    expect(slot?.querySelectorAll("button")).toHaveLength(2);
    expect(holder?.lastElementChild).toBe(slot);
    const none = make(document, pho, { actions: [] });
    expect(none.querySelector(".link-actions")).toBeNull();
  }
});

test("a row without onOpen stays focusable, as before", () => {
  expect(createLinkRow(document, pho).tabIndex).toBe(0);
  expect(createCompactRow(document, pho).tabIndex).toBe(0);
});

test("a partial card with a null summary keeps both actions and opens", () => {
  const opened: LinkItem[] = [];
  const card = createLinkCard(document, pendingLink, {
    onOpen: (i) => opened.push(i),
    actions: actionButtons(document, () => {}),
  });
  expect(card.querySelectorAll(".lcard-action button")).toHaveLength(2);
  expect(card.querySelector(".sum")).toBeNull();
  card.click();
  expect(opened).toEqual([pendingLink]);
});

test("AI off: the actions and open still show", () => {
  const card = createLinkCard(
    document,
    { ...pendingLink, status: "ai-off" },
    { onOpen: () => {}, actions: actionButtons(document, () => {}) },
  );
  expect(card.querySelectorAll("button.link-open")).toHaveLength(1);
  expect(card.querySelectorAll(".lcard-action button")).toHaveLength(2);
});

test("a long title and a 200-char URL stay text, with the full values in tooltips", () => {
  const url = `https://example.org/${"a".repeat(180)}?q=1`;
  const title = "Rất ".repeat(60);
  const card = createLinkCard(
    document,
    { ...pho, title, url },
    { onOpen: () => {} },
  );
  expect(card.querySelector<HTMLElement>(".title")?.title).toBe(title);
  expect(card.querySelector<HTMLElement>(".url")?.title).toBe(url);
  expect(card.querySelector(".link-open")?.textContent).toBe(title);
});

test("the view passes onOpen and a per-item actions factory to every row or card", () => {
  const items = Array.from({ length: 500 }, (_, i) => ({
    ...pho,
    title: `Link ${i}`,
  }));
  for (const view of ["list", "cards", "compact"] as const) {
    const opened: string[] = [];
    const root = createLinkView(document, view, items, {
      onOpen: (i) => opened.push(i.title),
      actions: (i) => [createButton(document, { label: `Delete ${i.title}` })],
    });
    const boxes = root.querySelectorAll<HTMLElement>("[data-openable]");
    expect(boxes).toHaveLength(500);
    expect(
      root.querySelectorAll(".link-actions button, .lcard-action button"),
    ).toHaveLength(500);
    boxes[7].click();
    expect(opened).toEqual(["Link 7"]);
  }
});

test("the view without options builds as before", () => {
  const root = createLinkView(document, "list", [pho]);
  expect(root.querySelector("[data-openable]")).toBeNull();
  expect(root.querySelector(".link-actions")).toBeNull();
});

test("forced states mark the card", () => {
  for (const s of ["hover", "focus", "active"] as const)
    expect(
      createLinkCard(document, pho, { forceState: s }).classList.contains(
        `is-${s}`,
      ),
    ).toBe(true);
});

test("keyboard focus on the open button still shows the full site (issue 172)", () => {
  const css = readFileSync(resolve(__dirname, "link-card.css"), "utf8");
  expect(css).toContain(".link-row:has(.link-open:focus-visible) .site");
  expect(css).toContain(".compact-row:has(.link-open:focus-visible) .dom");
  expect(css).toContain(".compact-row:has(:focus-visible) .dom");
  expect(css).not.toContain(".compact-row:focus-within .dom");
});

test("the hidden Compact actions take no pointer and show on hover and focus", () => {
  const css = readFileSync(resolve(__dirname, "link-card.css"), "utf8");
  const hidden = css.match(
    /\.compact-row > \.link-actions > \.link-actions-box \{[^}]*\}/,
  )?.[0];
  expect(hidden).toContain("pointer-events: none");
  expect(hidden).toContain("opacity: 0");
  const shown = css.match(
    /\.compact-row:focus-within > \.link-actions > \.link-actions-box \{[^}]*\}/,
  )?.[0];
  expect(shown).toContain("pointer-events: auto");
  expect(css).toContain("--row-surface: var(--head)");
});

test("the open button keeps the title's child nodes", () => {
  const row = createCompactRow(document, pho, { onOpen: () => {} });
  const button = row.querySelector(".link-open");
  expect(button?.parentElement?.className).toBe("row-title");
  expect(button?.textContent).toBe(pho.title);
});

test("a click with text selected in the box, or a prevented click, does not open", () => {
  const opened: LinkItem[] = [];
  const card = createLinkCard(document, pho, { onOpen: (i) => opened.push(i) });
  document.body.append(card);
  const range = document.createRange();
  range.selectNodeContents(card.querySelector(".sum") as Node);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  card.click();
  expect(opened).toEqual([]);
  sel?.removeAllRanges();
  card.addEventListener("click", (e) => e.preventDefault(), { capture: true });
  card.click();
  expect(opened).toEqual([]);
  card.remove();
});

test("the Compact actions show always where there is no hover", () => {
  const css = readFileSync(resolve(__dirname, "link-card.css"), "utf8");
  const media = css.match(/@media \(hover: none\)[^{]*\{[\s\S]*?\n\}\n/)?.[0];
  expect(media).toContain("(pointer: coarse)");
  expect(media).toContain(".link-actions-box");
  expect(media).toContain("pointer-events: auto");
});

test("a selection stops a click on the box, but not a click from the title button", () => {
  const opened: LinkItem[] = [];
  const card = createLinkCard(document, pho, { onOpen: (i) => opened.push(i) });
  document.body.append(card);
  const range = document.createRange();
  range.selectNodeContents(card.querySelector(".sum") as Node);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  card.querySelector<HTMLElement>(".link-open")?.click();
  expect(opened).toEqual([pho]);
  sel?.removeAllRanges();
  card.remove();
});

test("a control of a wrapper around the box does not stop it from opening", () => {
  for (const cls of ["link-actions", "lcard-action"]) {
    const opened: LinkItem[] = [];
    const wrap = document.createElement("a");
    wrap.className = cls;
    const card = createLinkCard(document, pho, {
      onOpen: (i) => opened.push(i),
    });
    wrap.append(card);
    document.body.append(wrap);
    card.click();
    expect(opened).toEqual([pho]);
    wrap.remove();
  }
});
