// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { renderLists } from "./lists";
import { renderRecords } from "./records";

const ctx = {
  doc: document,
  root: document.documentElement,
  signal: new AbortController().signal,
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
  radios[2].click();
  expect(radios[2].getAttribute("aria-checked")).toBe("true");
  expect(panel.querySelectorAll(".compact-row").length).toBeGreaterThan(0);
  radios[0].click();
  expect(panel.querySelector('[aria-label="Links, list view"]')).not.toBeNull();
});

test("Records shows the link card states, a guess label and the missing source mark", () => {
  const text = mount(renderRecords).textContent ?? "";
  expect(text).toContain("Link only. Mnemo could not read this page.");
  expect(text).toContain("No summary: AI is off.");
  expect(text).toContain("Guess");
  expect(mount(renderRecords).querySelector(".cite.missing")).not.toBeNull();
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
