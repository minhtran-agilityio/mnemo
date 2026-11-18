import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const root = resolve(__dirname, "..", "..");

test("tsc --noEmit passes, so test files may use node built-ins", () => {
  const run = spawnSync("npx", ["tsc", "--noEmit"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(run.stdout + run.stderr).toBe("");
  expect(run.status).toBe(0);
}, 60_000);
