#!/usr/bin/env node
// Design system write guard (#106 [DS-04]). CI job "Design system write guard" in ci.yml.
//
// How it decides:
// - Input: the paths a pull request changes (stdin, one per line, from
//   `git diff --name-only --no-renames base...head`, so a move lists both the old and the new path)
//   and the pull request's labels (env DS_GUARD_LABELS, a JSON array of label names).
// - A path counts as a design-system change when it starts with "ui/src/ds/". Nothing else counts:
//   not "ui/src/ds-guard.test.ts", not "ui/src/dsx/", not "docs/ui/src/ds/".
// - The pull request passes when it changes no design-system path, or when it has the label
//   design-system. Otherwise it fails and lists the design-system paths.
// - It fails closed: label JSON that is missing, invalid or not an array of strings, and an empty
//   list of changed paths, all exit 1.
//
// The label is a speed bump, not an identity check: anyone with write access can add it. It says
// "this pull request answers a UI component request and was built by the ui-designer agent"; the
// owner's review is still the gate. CI runs again when a label is added or removed. "Re-run jobs"
// reuses the labels of the event that started the run, so add or remove the label to refresh them.
//
// Run: git diff --name-only --no-renames origin/main...HEAD | DS_GUARD_LABELS='["design-system"]' node scripts/ds-write-guard.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DS_PREFIX = "ui/src/ds/";
export const LABEL = "design-system";
const FIX = `Add the label ${LABEL} to this pull request. Changes to ui/src/ds/ come only from a UI component request answered by the ui-designer agent (.claude/agents/ui-designer.md). See DESIGN.md section 8.`;

/** Decide whether a pull request with these changed `files` and `labels` may change ui/src/ds/. */
export function decide({ files, labels }) {
  const dsFiles = files.filter((f) => f.startsWith(DS_PREFIX));
  if (dsFiles.length === 0)
    return { ok: true, dsFiles, message: "No file in ui/src/ds/ changed." };
  if (labels.includes(LABEL))
    return {
      ok: true,
      dsFiles,
      message: `${dsFiles.length} file(s) in ui/src/ds/ changed and the pull request has the label ${LABEL}.`,
    };
  return {
    ok: false,
    dsFiles,
    message: `This pull request changes ui/src/ds/ but has no label ${LABEL}:\n${dsFiles.map((f) => `  ${f}`).join("\n")}\n${FIX}`,
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
    out.error("No changed paths on stdin (did git diff fail?). Failing closed.");
    return 1;
  }
  const result = decide({ files, labels });
  (result.ok ? out.log : out.error)(result.message);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(readFileSync(0, "utf8"), process.env.DS_GUARD_LABELS);
}
