// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { ALL_ITEMS, EVERYTHING_ID, UI_CATALOG_ID } from "./nav";
import { createRouter, hashFor, parseHash, splitHash } from "./router";

test("every item has an address that opens it", () => {
  for (const item of ALL_ITEMS)
    expect(parseHash(hashFor(item.id)).item.id).toBe(item.id);
});

test("the UI Catalog address opens the dev-only catalog item (Vitest runs in dev mode)", () => {
  const route = parseHash(hashFor(UI_CATALOG_ID));
  expect(route.item.id).toBe(UI_CATALOG_ID);
  expect(route.query).toBeNull();
});

test("an unknown or empty address falls back to Today", () => {
  for (const hash of ["", "#", "#/", "#/nope", "#/__proto__", "nonsense"])
    expect(parseHash(hash).item.id).toBe("today");
});

test("a search word travels to Everything and back unchanged", () => {
  const word = `<img src=x onerror="a()"> & more? #1`;
  const route = parseHash(hashFor(EVERYTHING_ID, word));
  expect(route.item.id).toBe(EVERYTHING_ID);
  expect(route.query).toBe(word);
});

test("a blank search opens Everything with no word, and other screens ignore a word", () => {
  expect(hashFor(EVERYTHING_ID, "   ")).toBe("#/everything");
  expect(parseHash("#/everything?q=%20").query).toBeNull();
  expect(hashFor("notes", "word")).toBe("#/notes");
  expect(parseHash("#/notes?q=word").query).toBeNull();
});

test("the router shows the current address, then each change, and a repeat of the same address", () => {
  const seen: string[] = [];
  const router = createRouter(window, (route) => seen.push(route.item.id));
  window.location.hash = "";
  router.start();
  expect(seen).toEqual(["today"]);
  router.go("notes");
  expect(window.location.hash).toBe("#/notes");
  router.go("notes");
  const afterFirst = seen.length;
  router.go("notes");
  expect(seen.at(-1)).toBe("notes");
  expect(seen.length).toBeGreaterThan(afterFirst);
});

test("splitHash strips the hash, leading and trailing slashes and the search part", () => {
  for (const hash of [
    "#/ui-catalog",
    "#ui-catalog",
    "#/ui-catalog/",
    "#/ui-catalog?x=1",
    "ui-catalog",
  ])
    expect(splitHash(hash).path).toBe("ui-catalog");
  expect(splitHash("#/everything?q=a b")).toEqual({
    path: "everything",
    search: "q=a b",
  });
  expect(splitHash("").path).toBe("");
});
