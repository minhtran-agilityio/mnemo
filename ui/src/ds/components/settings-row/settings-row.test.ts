// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { cssRule } from "../../../css-rule";
import { createSelect } from "../select/select";
import {
  createSettingsRow,
  createSettingsRows,
  setSettingsRowDisabled,
  setSettingsRowError,
} from "./settings-row";

const selects = () => [
  createSelect(document, { options: ["Haiku 5.5", "Sonnet 5.5"] }).wrap,
  createSelect(document, { options: ["Low effort", "Medium effort"] }).wrap,
];

test("it renders label, sub-line and the given controls, all text as text", () => {
  const row = createSettingsRow(document, {
    label: "<b>Save a link</b>",
    sub: "Summary, tags and folder",
    controls: selects(),
  });
  expect(row.querySelector(".setting-row-label")?.textContent).toBe(
    "<b>Save a link</b>",
  );
  expect(row.querySelector("b")).toBeNull();
  expect(row.querySelector(".setting-row-sub")?.textContent).toBe(
    "Summary, tags and folder",
  );
  expect(row.querySelectorAll("select")).toHaveLength(2);
});

test("the row is not focusable and not a button: Tab reaches its controls only", () => {
  const row = createSettingsRow(document, { label: "A", controls: selects() });
  expect(row.hasAttribute("tabindex")).toBe(false);
  expect(row.tagName).toBe("DIV");
  const stops = [...row.querySelectorAll<HTMLElement>("*")].filter(
    (n) => n.tabIndex >= 0,
  );
  expect(stops.map((n) => n.tagName)).toEqual(["SELECT", "SELECT"]);
});

test("the group is named by its label and described by the sub-line", () => {
  const row = createSettingsRow(document, {
    label: "Ask Mnemo",
    sub: "Answers with sources",
    controls: [],
  });
  const label = row.querySelector(".setting-row-label") as HTMLElement;
  expect(row.getAttribute("role")).toBe("group");
  expect(row.getAttribute("aria-labelledby")).toBe(label.id);
  expect(row.getAttribute("aria-describedby")).toBe(
    row.querySelector(".setting-row-sub")?.id,
  );
});

test("a row with no sub-line has no empty description", () => {
  const row = createSettingsRow(document, { label: "A", controls: [] });
  expect(row.hasAttribute("aria-describedby")).toBe(false);
});

test("an error is one line under the row and joins the description", () => {
  const row = createSettingsRow(document, {
    label: "A",
    sub: "B",
    controls: [],
    error: "Could not save. Try again.",
  });
  const err = row.querySelector(".setting-row-error") as HTMLElement;
  expect(err.textContent).toBe("Could not save. Try again.");
  expect(err.parentElement?.getAttribute("aria-live")).toBe("polite");
  expect(row.getAttribute("aria-describedby")).toContain(err.id);
});

test("disabled turns the controls off and can be undone", () => {
  const row = createSettingsRow(document, {
    label: "A",
    controls: selects(),
    disabled: true,
  });
  const all = () => [...row.querySelectorAll("select")];
  expect(all().every((s) => s.disabled)).toBe(true);
  expect(
    row.querySelector(".setting-row-controls")?.hasAttribute("inert"),
  ).toBe(true);
  setSettingsRowDisabled(row, false);
  expect(all().some((s) => s.disabled)).toBe(false);
  expect(
    row.querySelector(".setting-row-controls")?.hasAttribute("inert"),
  ).toBe(false);
});

test("rows stack in a named card", () => {
  const rows = [1, 2, 3].map((n) =>
    createSettingsRow(document, { label: `Row ${n}`, controls: [] }),
  );
  const card = createSettingsRows(document, { label: "Models", rows });
  expect(card.getAttribute("aria-label")).toBe("Models");
  expect(card.querySelectorAll(".setting-row")).toHaveLength(3);
});

test("a long label and sub-line wrap and are not cut with an ellipsis", () => {
  const long = "x".repeat(120);
  const row = createSettingsRow(document, {
    label: long,
    sub: long,
    controls: [],
  });
  expect(row.querySelector(".setting-row-label")?.textContent).toBe(long);
  for (const sel of [".setting-row-label", ".setting-row-sub"]) {
    const rule = cssRule(import.meta.dirname, "settings-row.css", sel);
    expect(rule["overflow-wrap"]).toBe("anywhere");
    expect(rule["text-overflow"]).toBeUndefined();
    expect(rule["white-space"]).toBeUndefined();
  }
  const rowRule = cssRule(
    import.meta.dirname,
    "settings-row.css",
    ".setting-row",
  );
  expect(rowRule["flex-wrap"]).toBe("wrap");
});

test("setSettingsRowError shows, changes and clears the error on a row that is built", () => {
  const [model] = selects();
  const row = createSettingsRow(document, {
    label: "A",
    sub: "B",
    controls: [model as HTMLElement],
  });
  document.body.append(row);
  const note = row.querySelector(".setting-row-note") as HTMLElement;
  const select = row.querySelector("select") as HTMLSelectElement;
  select.focus();
  const sub = row.querySelector(".setting-row-sub")?.id;
  expect(note.textContent).toBe("");
  expect(row.getAttribute("aria-describedby")).toBe(sub);

  setSettingsRowError(row, "Could not save.");
  const err = row.querySelector(".setting-row-error") as HTMLElement;
  expect(err.textContent).toBe("Could not save.");
  expect(err.parentElement).toBe(note);
  expect(row.getAttribute("aria-describedby")).toBe(`${sub} ${err.id}`);
  expect(row.querySelector("select")).toBe(select);
  expect(select.isConnected).toBe(true);
  expect(document.activeElement).toBe(select);

  setSettingsRowError(row, "Still not saved.");
  expect(row.querySelector(".setting-row-error")).toBe(err);
  expect(err.textContent).toBe("Still not saved.");

  setSettingsRowError(row, null);
  expect(row.querySelector(".setting-row-error")).toBeNull();
  expect(row.querySelector(".setting-row-note")).toBe(note);
  expect(row.getAttribute("aria-describedby")).toBe(sub);
  setSettingsRowError(row, "   ");
  expect(row.querySelector(".setting-row-error")).toBeNull();
});

test("the same message set again writes nothing", () => {
  const row = createSettingsRow(document, { label: "A", controls: [] });
  setSettingsRowError(row, "Could not save.");
  const text = row.querySelector(".setting-row-error")?.firstChild as Text;
  let writes = 0;
  new MutationObserver(() => {
    writes += 1;
  }).observe(row, { subtree: true, childList: true, characterData: true });
  setSettingsRowError(row, "Could not save.");
  expect(row.querySelector(".setting-row-error")?.firstChild).toBe(text);
  return Promise.resolve().then(() => expect(writes).toBe(0));
});

test("it refuses an element that is not a settings row", () => {
  expect(() =>
    setSettingsRowError(document.createElement("div"), "x"),
  ).toThrow();
});
