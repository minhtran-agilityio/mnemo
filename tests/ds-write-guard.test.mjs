// Unit tests of the design system write guard (scripts/ds-write-guard.mjs, #106 [DS-04]).
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/ds-write-guard.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide, main, parseFiles, parseLabels } from "../scripts/ds-write-guard.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "ds-write-guard.mjs");

let failed = false;
process.on("exit", () => {
  if (failed) process.exitCode = 1;
});
const t = (name, fn) =>
  test(name, (ctx) => {
    try {
      return fn(ctx);
    } catch (e) {
      failed = true;
      throw e;
    }
  });

const run = (stdin, labels) =>
  spawnSync(process.execPath, [SCRIPT], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, DS_GUARD_LABELS: labels },
  });

t("a ds change with no label is rejected and the message names the file and the fix", () => {
  const r = decide({ files: ["ui/src/ds/components/toast/toast.ts", "README.md"], labels: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.dsFiles, ["ui/src/ds/components/toast/toast.ts"]);
  assert.match(r.message, /ui\/src\/ds\/components\/toast\/toast\.ts/);
  assert.match(r.message, /design-system/);
  assert.match(r.message, /DESIGN\.md section 8/);
});

t("a ds change with another label only is rejected", () => {
  assert.equal(decide({ files: ["ui/src/ds/tokens.css"], labels: ["bug"] }).ok, false);
});

t("a ds change with the label is accepted", () => {
  assert.equal(decide({ files: ["ui/src/ds/tokens.css"], labels: ["bug", "design-system"] }).ok, true);
});

t("no ds change is accepted, with or without labels", () => {
  assert.equal(decide({ files: ["ui/src/screens/foo/foo.ts"], labels: [] }).ok, true);
  assert.equal(decide({ files: ["ui/src/dsx/a.ts", "docs/ui/src/ds/a.md"], labels: [] }).ok, true);
});

t("the guard test of #106 next to ui/src/ds/ is not a ds change", () => {
  assert.equal(decide({ files: ["ui/src/ds-guard.test.ts"], labels: [] }).ok, true);
});

t("a move out of ds (both paths listed by --no-renames) is rejected", () => {
  const r = decide({ files: ["ui/src/ds/components/a/a.ts", "ui/src/screens/a.ts"], labels: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.dsFiles, ["ui/src/ds/components/a/a.ts"]);
});

t("stdin parsing ignores CRLF and blank lines", () => {
  assert.deepEqual(parseFiles("a.md\r\n\r\nui/src/ds/b.css\r\n\n"), ["a.md", "ui/src/ds/b.css"]);
});

t("label parsing accepts only a JSON array of strings", () => {
  assert.deepEqual(parseLabels('["design-system"]'), ["design-system"]);
  assert.deepEqual(parseLabels("[]"), []);
  for (const bad of [undefined, "", "not json", "{", "{}", '"design-system"', "[1]", "null"])
    assert.equal(parseLabels(bad), null, `accepted ${bad}`);
});

t("main fails closed on empty input and on bad labels", () => {
  const quiet = { log() {}, error() {} };
  assert.equal(main("", "[]", quiet), 1);
  assert.equal(main("\n\r\n", '["design-system"]', quiet), 1);
  assert.equal(main("README.md\n", "nope", quiet), 1);
  assert.equal(main("README.md\n", undefined, quiet), 1);
  assert.equal(main("README.md\n", "[]", quiet), 0);
});

t("CLI: exit 1 for an unlabelled ds change, 0 with the label", () => {
  const no = run("ui/src/ds/x.ts\n", "[]");
  assert.equal(no.status, 1, no.stdout + no.stderr);
  assert.match(no.stderr, /ui\/src\/ds\/x\.ts/);
  const yes = run("ui/src/ds/x.ts\n", '["design-system"]');
  assert.equal(yes.status, 0, yes.stdout + yes.stderr);
});

t("CLI: exit 0 with no ds change, exit 1 on bad label JSON or empty stdin", () => {
  assert.equal(run("README.md\n", "[]").status, 0);
  assert.equal(run("README.md\n", "{").status, 1);
  assert.equal(run("", '["design-system"]').status, 1);
});
