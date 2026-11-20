// A release `vite build` must hold no Storehouse section and no UI Catalog item (#119 [DS-11]).
// It runs inside `npm test` on purpose: ds-03 AC5, the other release-build check, skips in nested
// runs, so without this test CI would not catch the dev-only section leaking into a release.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITE = join(ROOT, "node_modules", "vite", "bin", "vite.js");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test("a release build has no Storehouse section and no UI Catalog item", { timeout: 300_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "mnemo-release-"));
  try {
    const build = spawnSync(process.execPath, [VITE, "build", "--outDir", out, "--emptyOutDir"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" },
    });
    assert.equal(build.status, 0, `vite build failed:\n${build.stdout}\n${build.stderr}`);
    const built = files(out).filter((f) => /\.(js|css|html)$/.test(f));
    assert.ok(built.length > 0, "the build wrote no files");
    const sidebar = built.filter((f) => readFileSync(f, "utf8").includes("sb-label"));
    assert.ok(sidebar.length > 0, "the sidebar code is not in the build, so the check proves nothing");
    for (const file of built) {
      const text = readFileSync(file, "utf8");
      // Case-insensitive, so the group id "storehouse" is caught as well as its label.
      assert.ok(!/storehouse/i.test(text), `Storehouse found in ${file}`);
      assert.ok(!text.includes("UI Catalog"), `UI Catalog found in ${file}`);
      assert.ok(!text.includes("ui-catalog"), `ui-catalog found in ${file}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
