// The exception lists of the design-system guards can only shrink (#106 [DS-04]).
// Every (path, guard) pair in tests/lib/ds-guard.mjs must be in PINNED below. Adding an exception,
// or letting an existing one switch off one more guard, fails this test. Removing one is fine:
// #111 deletes the known exceptions, and a removal needs no edit here (a stale pin is harmless).
// The state gaps of ui/src/ds-guard.test.ts are pinned in that file.
// This file and tests/lib/ds-guard.mjs are protected by scripts/ds-write-guard.mjs: a pull request
// that changes either needs the label design-system, so a feature pull request cannot widen a list.
// Not named ds-*.test.mjs on purpose: it holds a second copy of the paths, which the acceptance
// test "no other test file lists the exceptions by path" keeps out of the guard tests.
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/guard-exceptions-pinned.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_EXCEPTIONS } from "./lib/ds-guard.mjs";

/** "path|guard": the exceptions that exist today. */
const PINNED = new Set([
  "ui/src/frame/|css",
  "ui/src/frame/|elements",
  "ui/src/screens/settings/|css",
  "ui/src/screens/settings/|elements",
  "ui/src/screens/kanban/|css",
  "ui/src/style.css|css",
  "ui/src/screens/catalog/catalog.ts|elements",
  "ui/src/screens/catalog/find.ts|elements",
  "ui/src/screens/catalog/parts.ts|elements",
  "ui/src/screens/catalog/specimen.ts|css",
  "ui/src/screens/catalog/specimen.ts|elements",
  "ui/src/screens/catalog/inspect.ts|css",
  "ui/src/screens/catalog/tabs/foundations.ts|css",
  "ui/src/screens/catalog/tabs/foundations.ts|elements",
  "ui/src/screens/catalog/tabs/tokens.ts|css",
  "ui/src/screens/catalog/tabs/limits.ts|elements",
  "ui/src/screens/catalog/tabs/surfaces.ts|elements",
]);
/** Entries with no guard switched off: they pass both guards today and may stay listed. */
const PINNED_PATHS = new Set(["ui/error.html", "ui/src/error-page.ts"]);

/** The (path, guard) pairs of `entries` that are not pinned. */
export function unpinned(entries, pinned = PINNED, pinnedPaths = PINNED_PATHS) {
  return entries.flatMap((e) =>
    e.guards.length === 0
      ? pinnedPaths.has(e.path)
        ? []
        : [`${e.path} (no guard)`]
      : e.guards.filter((g) => !pinned.has(`${e.path}|${g}`)).map((g) => `${e.path} (${g})`),
  );
}

test("the exception lists only shrink: every exception is pinned", () => {
  const added = unpinned(ALL_EXCEPTIONS);
  assert.deepEqual(
    added,
    [],
    `new exception in tests/lib/ds-guard.mjs: ${added.join(", ")}. Exceptions only shrink; use a part from ui/src/ds, or file a UI component request (DESIGN.md section 8). A deliberate change needs the label design-system and an edit of PINNED.`,
  );
});

test("self-test: a new entry, a new guard on an entry, a folder entry and a new path fail; a removal passes", () => {
  const known = { path: "ui/src/frame/", guards: ["css", "elements"] };
  assert.deepEqual(unpinned([known]), []);
  assert.deepEqual(unpinned([{ ...known, guards: ["css"] }]), [], "removing a guard is fine");
  assert.deepEqual(unpinned([]), [], "removing every entry is fine");
  assert.deepEqual(unpinned([{ path: "ui/src/screens/new/", guards: ["css"] }]), ["ui/src/screens/new/ (css)"]);
  assert.deepEqual(unpinned([{ path: "ui/src/screens/kanban/", guards: ["css", "elements"] }]), [
    "ui/src/screens/kanban/ (elements)",
  ]);
  assert.deepEqual(unpinned([{ path: "ui/src/screens/catalog/", guards: ["elements"] }]), [
    "ui/src/screens/catalog/ (elements)",
  ]);
  assert.deepEqual(unpinned([{ path: "ui/src/new.ts", guards: [] }]), ["ui/src/new.ts (no guard)"]);
});
