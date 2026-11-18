// Fails when Cargo.toml or Cargo.lock drift from the version in package.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const version = JSON.parse(read("package.json")).version;

test("Cargo.toml version matches package.json", () => {
  const section = read("src-tauri", "Cargo.toml")
    .split(/^\[/m)
    .find((s) => s.startsWith("package]"));
  assert.ok(section.includes(`version = "${version}"`), `Cargo.toml differs from package.json ${version}`);
});

test("Cargo.lock mnemo entry matches package.json", () => {
  const lock = read("src-tauri", "Cargo.lock");
  assert.match(
    lock,
    new RegExp(`name = "mnemo"\\r?\\nversion = "${version.replace(/\./g, "\\.")}"`),
    `Cargo.lock differs from package.json ${version}`,
  );
});

test("tauri.conf.json reads the version from package.json", () => {
  const conf = JSON.parse(read("src-tauri", "tauri.conf.json"));
  assert.equal(conf.version, "../package.json");
});
