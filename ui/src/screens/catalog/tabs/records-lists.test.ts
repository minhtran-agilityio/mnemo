// @vitest-environment happy-dom
import { expect, test } from "vitest";
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
  const slots = [...panel.querySelectorAll(".lcard .lcard-action")].filter(
    (s) => s.children.length === 2,
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
  // Each two-action card is pending: "No summary yet."
  for (const s of slots)
    expect(s.closest(".lcard")?.getAttribute("data-status")).toBe("pending");
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
