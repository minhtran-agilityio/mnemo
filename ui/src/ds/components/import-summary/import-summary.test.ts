// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createCheckbox } from "../check/check";
import { createImportSummary, importLabel } from "./import-summary";

const COUNTS = { toAdd: 50, repeats: 3, saved: 0, notLinks: 2 };
const buttons = (n: HTMLElement) => [...n.querySelectorAll("button")];

test("success lists the counts with labels and two actions", () => {
  const onImport = vi.fn();
  const onChooseAnother = vi.fn();
  const node = createImportSummary(document, {
    fileName: "bookmarks.html",
    counts: COUNTS,
    onImport,
    onChooseAnother,
    onCancel: () => {},
  });
  expect(node.querySelector(".import-summary-file")?.textContent).toBe(
    "bookmarks.html",
  );
  expect([...node.querySelectorAll("dt")].map((t) => t.textContent)).toEqual([
    "Links to add",
    "Repeats in the file, skipped",
    "Already saved, skipped",
    "Not links, skipped",
  ]);
  expect([...node.querySelectorAll("dd")].map((d) => d.textContent)).toEqual([
    "50",
    "3",
    "0",
    "2",
  ]);
  const [imp, other] = buttons(node);
  expect(imp?.textContent).toBe("Import 50 links");
  expect(imp?.className).toContain("btn-primary");
  expect(other?.textContent).toBe("Choose another file");
  imp?.click();
  other?.click();
  expect(onImport).toHaveBeenCalledOnce();
  expect(onChooseAnother).toHaveBeenCalledOnce();
  expect(node.querySelector(".import-summary-why")).toBeNull();
});

test("one link reads singular and large counts are grouped", () => {
  expect(importLabel(1)).toBe("Import 1 link");
  const node = createImportSummary(document, {
    fileName: "big.html",
    counts: { toAdd: 1234567, repeats: 0, saved: 0, notLinks: 0 },
  });
  expect(node.querySelector("dd")?.textContent).toBe("1,234,567");
  expect(buttons(node)[0]?.textContent).toBe("Import 1,234,567 links");
});

test("zero to add disables Import and says why", () => {
  const onImport = vi.fn();
  const node = createImportSummary(document, {
    fileName: "a.html",
    counts: { toAdd: 0, repeats: 9, saved: 0, notLinks: 0 },
    onImport,
  });
  const [imp, other] = buttons(node);
  expect(imp?.disabled).toBe(true);
  imp?.click();
  expect(onImport).not.toHaveBeenCalled();
  expect(other?.disabled).toBe(false);
  expect(node.querySelector(".import-summary-why")?.textContent).toContain(
    "Nothing to add",
  );
});

test("loading shows a status line and only Cancel", () => {
  const node = createImportSummary(document, {
    fileName: "a.html",
    state: "loading",
    onCancel: () => {},
  });
  expect(node.getAttribute("aria-busy")).toBe("true");
  expect(node.querySelector("[role=status]")?.textContent).toContain("Reading");
  expect(buttons(node).map((b) => b.textContent)).toEqual(["Cancel"]);
});

test("error is an alert with Choose another file and Cancel", () => {
  const node = createImportSummary(document, {
    fileName: "a.html",
    state: "error",
    onCancel: () => {},
  });
  expect(node.querySelector("[role=alert]")?.textContent).toContain(
    "Nothing was stored",
  );
  expect(buttons(node).map((b) => b.textContent)).toEqual([
    "Choose another file",
    "Cancel",
  ]);
});

test("the slot holds a checkbox that has a name and works", () => {
  const box = createCheckbox(document, { label: "Import without summaries" });
  const node = createImportSummary(document, {
    fileName: "a.html",
    counts: COUNTS,
    slot: box.label,
  });
  const input = node.querySelector("input");
  expect(input?.type).toBe("checkbox");
  expect(node.querySelector("label")?.textContent).toBe(
    "Import without summaries",
  );
  input?.click();
  expect(input?.checked).toBe(true);
});

test("the region has an accessible name from the file", () => {
  const node = createImportSummary(document, {
    fileName: "a.html",
    counts: COUNTS,
  });
  const id = node.getAttribute("aria-labelledby") ?? "";
  expect(id).not.toBe("");
  expect(node.querySelector(`[id="${id}"]`)?.textContent).toBe("a.html");
});

test("a long file name is kept whole in the title and set as text", () => {
  const name = `${"x".repeat(300)}<img src=x>.html`;
  const node = createImportSummary(document, {
    fileName: name,
    counts: COUNTS,
  });
  const h = node.querySelector<HTMLElement>(".import-summary-file");
  expect(h?.title).toBe(name);
  expect(h?.textContent).toBe(name);
  expect(node.querySelector("img")).toBeNull();
});

test("a forced state reaches the import button", () => {
  const node = createImportSummary(document, {
    fileName: "a.html",
    counts: COUNTS,
    forced: "hover",
  });
  expect(buttons(node)[0]?.className).toContain("is-hover");
});

test("only the inner message line has the error box, not the root", () => {
  const node = createImportSummary(document, {
    fileName: "a.html",
    state: "error",
  });
  expect(node.classList.contains("is-error")).toBe(true);
  expect(node.className).not.toContain("import-summary-message");
  expect(node.querySelectorAll(".import-summary-message").length).toBe(1);
});

test("an empty file gives no made-up reason", () => {
  const node = createImportSummary(document, {
    fileName: "a.html",
    counts: { toAdd: 0, repeats: 0, saved: 0, notLinks: 0 },
  });
  expect(node.querySelector(".import-summary-why")?.textContent).toBe(
    "The file has no entries.",
  );
});

test("bad counts are shown as 0", () => {
  const node = createImportSummary(document, {
    fileName: "a.html",
    counts: { toAdd: Number.NaN, repeats: -4, saved: Infinity, notLinks: 2 },
  });
  expect([...node.querySelectorAll("dd")].map((d) => d.textContent)).toEqual([
    "0",
    "0",
    "0",
    "2",
  ]);
  expect(buttons(node)[0]?.disabled).toBe(true);
});

test("Cancel is a quiet third action that calls onCancel, also when Import is disabled", () => {
  const onCancel = vi.fn();
  const node = createImportSummary(document, {
    fileName: "a.html",
    counts: { toAdd: 0, repeats: 1, saved: 0, notLinks: 0 },
    onCancel,
  });
  const all = buttons(node);
  expect(all.map((b) => b.textContent)).toEqual([
    "Import 0 links",
    "Choose another file",
    "Cancel",
  ]);
  expect(all[2]?.className).toContain("btn-ghost");
  expect(all[2]?.disabled).toBe(false);
  all[2]?.click();
  expect(onCancel).toHaveBeenCalledOnce();
});

test("Cancel is drawn only when there is a handler", () => {
  const loading = createImportSummary(document, {
    fileName: "a.html",
    state: "loading",
  });
  expect(loading.querySelector("button")).toBeNull();
  expect(loading.querySelector("[role=status]")).not.toBeNull();
  const ready = createImportSummary(document, {
    fileName: "a.html",
    counts: COUNTS,
  });
  expect(buttons(ready).map((b) => b.textContent)).toEqual([
    "Import 50 links",
    "Choose another file",
  ]);
});

test("no counts given shows no rows and no reason, unlike all counts at 0", () => {
  const none = createImportSummary(document, { fileName: "a.html" });
  expect(none.querySelector("dl")).toBeNull();
  expect(none.querySelector(".import-summary-why")).toBeNull();
  expect(buttons(none)[0]?.disabled).toBe(true);
  const zero = createImportSummary(document, {
    fileName: "a.html",
    counts: { toAdd: 0, repeats: 0, saved: 0, notLinks: 0 },
  });
  expect(zero.querySelector(".import-summary-why")?.textContent).toBe(
    "The file has no entries.",
  );
});

test("a forced state reaches the first button of each state", () => {
  const loading = createImportSummary(document, {
    fileName: "a.html",
    state: "loading",
    onCancel: () => {},
    forced: "focus",
  });
  expect(buttons(loading)[0]?.className).toContain("is-focus");
  const error = createImportSummary(document, {
    fileName: "a.html",
    state: "error",
    onCancel: () => {},
    forced: "hover",
  });
  expect(buttons(error)[0]?.className).toContain("is-hover");
  expect(buttons(error)[1]?.className).not.toContain("is-hover");
});

test("two summaries get different name ids", () => {
  const a = createImportSummary(document, { fileName: "a" });
  const b = createImportSummary(document, { fileName: "b" });
  expect(a.getAttribute("aria-labelledby")).not.toBe(
    b.getAttribute("aria-labelledby"),
  );
});
