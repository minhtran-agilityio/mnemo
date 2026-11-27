// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { RECORDS } from "../../../ds/catalog/records";
import { renderLists } from "./lists";
import { renderRecords } from "./records";

const ctx = {
  doc: document,
  root: document.documentElement,
  signal: new AbortController().signal,
  toast() {},
  onThemeChange() {},
};
const mount = (render: typeof renderRecords) => {
  const panel = document.createElement("div");
  document.body.append(panel);
  render(panel, ctx);
  return panel;
};

test("Records shows the Bookmarks view switch and changes the view", () => {
  const panel = mount(renderRecords);
  const radios = [...panel.querySelectorAll<HTMLElement>('[role="radio"]')];
  expect(radios.map((r) => r.textContent)).toEqual([
    "List",
    "Cards",
    "Compact",
  ]);
  expect(panel.querySelector('[aria-label="Links, list view"]')).toBeNull();
  // The catalog's row states also hold compact rows, so look only in the switch's output.
  const switched = '[aria-label="Links, compact view"] .compact-row';
  expect(panel.querySelector(switched)).toBeNull();
  radios[2].click();
  expect(radios[2].getAttribute("aria-checked")).toBe("true");
  expect(panel.querySelectorAll(switched).length).toBeGreaterThan(0);
  radios[0].click();
  expect(panel.querySelector('[aria-label="Links, list view"]')).not.toBeNull();
});

test("Records shows the link card states, a guess label and the missing source mark", () => {
  const text = mount(renderRecords).textContent ?? "";
  expect(text).toContain("Link only. Mnemo could not read this page.");
  expect(text).toContain("No summary yet: AI is off.");
  const panel = mount(renderRecords);
  const pending = panel.querySelector('.lcard[data-status="pending"] .nosum');
  expect(pending?.textContent).toBe("No summary yet.");
  expect(text).toContain("It may matter for the Mnemo command allow-list.");
  const names = [...panel.querySelectorAll(".lcard-action button")].map(
    (b) => b.textContent,
  );
  expect(names).toContain("Summarize later");
  expect(names).toContain("Paste the text");
  expect(text).toContain("Guess");
  expect(mount(renderRecords).querySelector(".cite.missing")).not.toBeNull();
});

test("Records shows link cards with two actions: pending, narrow, busy, disabled and focus-visible", () => {
  const panel = mount(renderRecords);
  // The open and actions examples (issue 205) have their own group, `.rec-open`.
  const slots = [...panel.querySelectorAll(".lcard .lcard-action")].filter(
    (s) => s.children.length === 2 && !s.closest(".rec-open"),
  );
  const names = slots.map((s) =>
    [...s.children].map((b) => b.textContent).join(" | "),
  );
  expect(names).toContain("Summarize later | Paste the text");
  expect(names).toContain(
    "Tóm tắt sau khi có mạng trở lại | Dán toàn bộ nội dung của trang vào đây",
  );
  expect(panel.querySelectorAll(".rec-narrow .lcard-action")).toHaveLength(2);
  const firsts = slots.map((s) => s.children[0] as HTMLButtonElement);
  expect(firsts.some((b) => b.getAttribute("aria-busy") === "true")).toBe(true);
  expect(firsts.some((b) => b.disabled)).toBe(true);
  expect(slots.some((s) => s.children[1].classList.contains("is-focus"))).toBe(
    true,
  );
  // Each two-action card is pending: "No summary yet." The main action is a default button and
  // the other a ghost one; no card button is primary.
  for (const s of slots) {
    expect(s.closest(".lcard")?.getAttribute("data-status")).toBe("pending");
    expect(s.children[0].classList.contains("btn-ghost")).toBe(false);
    expect(s.children[1].classList.contains("btn-ghost")).toBe(true);
  }
  expect(panel.querySelector(".lcard .btn-primary")).toBeNull();
  // Each two-action state of the registry is a caption in the tab, word for word.
  const entry = RECORDS.find((e) => e.name === "link card");
  const caps = [...panel.querySelectorAll(".st > .cap")].map(
    (c) => c.textContent,
  );
  const twoActionStates = (entry?.states ?? []).filter((st) =>
    /two (long|actions)/.test(st),
  );
  expect(twoActionStates).toHaveLength(7);
  for (const st of twoActionStates) expect(caps).toContain(st);
  for (const cap of caps.filter((c) => /two (long|actions)/.test(c ?? "")))
    expect(entry?.states).toContain(cap);
});

test("Records shows the link card's note and folder line in each state (issue 186)", () => {
  const panel = mount(renderRecords);
  const entry = RECORDS.find((e) => e.name === "link card");
  const caps = [...panel.querySelectorAll(".st > .cap")].map(
    (c) => c.textContent ?? "",
  );
  const mine = (entry?.states ?? []).filter((st) =>
    /^(folder:|already saved)/.test(st),
  );
  expect(mine).toHaveLength(10);
  for (const st of mine) expect(caps).toContain(st);
  const cardOf = (cap: string) =>
    [...panel.querySelectorAll(".st")]
      .find((s) => s.querySelector(":scope > .cap")?.textContent === cap)
      ?.querySelector(".lcard");
  expect(
    cardOf("already saved")?.querySelector(".lcard-notice")?.textContent,
  ).toBe("Already saved");
  expect(
    cardOf("folder: Guess, on a done card")?.querySelector(
      ".lcard-folder .trust-guess",
    ),
  ).not.toBeNull();
  expect(
    cardOf("folder: AI off, Unsorted, no label")?.querySelector(
      ".lcard-folder .trust",
    ),
  ).toBeNull();
  expect(
    cardOf("folder: none, no note")?.querySelector(".lcard-folder"),
  ).toBeNull();
});

test("Lists sorts the table, opens the tree and moves a kanban card", () => {
  const panel = mount(renderLists);
  const th = panel.querySelectorAll("th");
  expect(th[2].getAttribute("aria-sort")).toBe("descending");
  panel.querySelectorAll<HTMLElement>("th button")[0].click();
  expect(th[0].getAttribute("aria-sort")).toBe("ascending");
  const clients = [...panel.querySelectorAll<HTMLElement>(".tnode")].find((b) =>
    b.textContent?.startsWith("Clients"),
  );
  clients?.click();
  expect(clients?.getAttribute("aria-expanded")).toBe("true");
  const card = panel.querySelector(".kcard") as HTMLElement;
  card.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      altKey: true,
      bubbles: true,
    }),
  );
  expect(card.closest(".kcol")?.getAttribute("data-col")).toBe("Doing");
});

test("Records shows the folder reason in each state (issue 193)", () => {
  const panel = mount(renderRecords);
  const entry = RECORDS.find((e) => e.name === "link card");
  const caps = [...panel.querySelectorAll(".st > .cap")].map(
    (c) => c.textContent ?? "",
  );
  const mine = (entry?.states ?? []).filter((st) =>
    st.startsWith("folder reason:"),
  );
  expect(mine.length).toBeGreaterThan(0);
  for (const st of mine) expect(caps).toContain(st);
  for (const cap of caps.filter((c) => c.startsWith("folder reason:")))
    expect(mine).toContain(cap);
  const cardOf = (cap: string) =>
    [...panel.querySelectorAll(".st")]
      .find((s) => s.querySelector(":scope > .cap")?.textContent === cap)
      ?.querySelector(".lcard");
  const reasonOf = (cap: string) =>
    cardOf(cap)?.querySelector(".lcard-folder-reason");
  // The request's sample.
  expect(reasonOf("folder reason: Guess, on a done card")?.textContent).toBe(
    "It is a reference page for a database engine.Guess",
  );
  // Rule 1: a card that is not done hides the reason and keeps the folder's Guess label.
  for (const cap of [
    "folder reason: pending, hidden (rule 1)",
    "folder reason: could not read, hidden (rule 1)",
  ]) {
    expect(reasonOf(cap)).toBeNull();
    expect(
      cardOf(cap)?.querySelector(".lcard-folder .trust-guess"),
    ).not.toBeNull();
  }
  expect(reasonOf("folder reason: the owner moved it, not shown")).toBeNull();
  expect(reasonOf("folder reason: AI off, Unsorted, none")).toBeNull();
  expect(
    cardOf("folder reason: AI off, Unsorted, none")?.querySelector(
      ".lcard-folder .trust",
    ),
  ).toBeNull();
  expect(
    cardOf("folder reason: long, on a narrow card")?.closest(".rec-narrow"),
  ).not.toBeNull();
});
