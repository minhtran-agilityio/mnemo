#!/usr/bin/env node
// Design system write guard (#106 [DS-04]). CI job "Design system write guard" in
// .github/workflows/ds-write-guard.yml.
//
// How it decides:
// - Input: the paths a pull request changes (stdin, one per line, from
//   `git diff --name-only --no-renames base...head`, so a move lists both the old and the new path)
//   and the pull request's labels (env DS_GUARD_LABELS, a JSON array of label names).
// - A path is protected when it starts with "ui/src/ds/" (the design system) or is one of the
//   guard files in GUARD_FILES: the guards, their exception lists and this script. Without that, a
//   feature pull request could switch a guard off by adding an exception outside ui/src/ds/.
//   Nothing else counts: not "ui/src/dsx/", not "docs/ui/src/ds/".
// - The pull request passes when it changes no protected path, or when it has the label
//   design-system. Otherwise it fails and lists the protected paths.
// - It fails closed: label JSON that is missing, invalid or not an array of strings exits 1.
//   An empty list of changed paths is a successful empty diff (an empty commit, or a commit and
//   its revert): no protected change, exit 0. A failing `git diff` is caught by the workflow
//   (bash runs with pipefail), not here.
//
// The label is a speed bump, not an identity check: anyone with write access can add it. It says
// "this pull request answers a UI component request and was built by the ui-designer agent"; the
// owner's review is still the gate. The workflow runs again when a label is added or removed.
// "Re-run jobs" reuses the labels of the event that started the run, so add or remove the label to
// refresh them.
//
// Run: git diff --name-only --no-renames origin/main...HEAD | DS_GUARD_LABELS='["design-system"]' node scripts/ds-write-guard.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DS_PREFIX = "ui/src/ds/";
/** Guard configuration: the guards, their exception lists and this script. Same rule as ui/src/ds/. */
export const GUARD_FILES = [
  "tests/lib/ds-guard.mjs",
  "tests/ds-screen-css.test.mjs",
  "tests/ds-screen-elements.test.mjs",
  "tests/ds-write-guard.test.mjs",
  "tests/guard-exceptions-pinned.test.mjs",
  "tests/acceptance/ds-04-guard.test.mjs",
  "ui/src/ds-guard.test.ts",
  "scripts/ds-write-guard.mjs",
  ".github/workflows/ds-write-guard.yml",
];
export const LABEL = "design-system";
const FIX = `Add the label ${LABEL} to this pull request. Changes to ui/src/ds/ and to the guard files come only from a UI component request answered by the ui-designer agent (.claude/agents/ui-designer.md). See DESIGN.md section 8.`;

/** True when a pull request that changes `path` needs the label. */
export const isProtected = (path) => path.startsWith(DS_PREFIX) || GUARD_FILES.includes(path);

/**
 * Decide whether a pull request with these changed `files` and `labels` may change ui/src/ds/ or
 * the guard files. `dsFiles` lists the protected paths it changes.
 */
export function decide({ files, labels }) {
  const dsFiles = files.filter(isProtected);
  if (dsFiles.length === 0)
    return { ok: true, dsFiles, message: "No file in ui/src/ds/ or the guard files changed." };
  if (labels.includes(LABEL))
    return {
      ok: true,
      dsFiles,
      message: `${dsFiles.length} protected file(s) (ui/src/ds/ or the guard files) changed and the pull request has the label ${LABEL}.`,
    };
  return {
    ok: false,
    dsFiles,
    message: `This pull request changes ui/src/ds/ or the guard files but has no label ${LABEL}:\n${dsFiles.map((f) => `  ${f}`).join("\n")}\n${FIX}`,
  };
}

/** Parse the changed paths from stdin text: one per line, CRLF and blank lines ignored. */
export function parseFiles(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** Parse DS_GUARD_LABELS. Returns null when it is not a JSON array of strings. */
export function parseLabels(raw) {
  if (raw === undefined) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}

/** The CLI: returns the exit code and writes the reason. */
export function main(stdinText, rawLabels, out = console) {
  const labels = parseLabels(rawLabels);
  if (labels === null) {
    out.error(
      `DS_GUARD_LABELS must be a JSON array of label names; got ${JSON.stringify(rawLabels ?? null)}. Failing closed.`,
    );
    return 1;
  }
  const files = parseFiles(stdinText);
  if (files.length === 0) {
    out.log("No changed paths: an empty diff changes no protected file.");
    return 0;
  }
  const result = decide({ files, labels });
  (result.ok ? out.log : out.error)(result.message);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(readFileSync(0, "utf8"), process.env.DS_GUARD_LABELS);
}
