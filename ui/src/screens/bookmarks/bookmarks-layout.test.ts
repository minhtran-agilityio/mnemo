// @vitest-environment happy-dom
// Layout check for issue 188: the Save link button lines up with the Link box, not with the hint
// under it. happy-dom has no layout, so this renders the screen's real markup and the real CSS
// (ui/src/ds + bookmarks.css) in headless Chrome and reads the boxes back. It skips when no
// Chrome is installed.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { Page, SavedBookmark } from "../../shared/api";
import { renderBookmarks } from "./bookmarks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const UI = join(__dirname, "..", "..");
const CHROME = ["google-chrome", "chromium", "chromium-browser"].find((n) => {
  try {
    execFileSync("which", [n], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory()
      ? cssFiles(f)
      : f.endsWith(".css")
        ? [f]
        : [];
  });
}

/** Renders the screen at `width` px, optionally with an error under the box, and returns the
 * rects of the input and the button. */
async function measure(width: number, withError: boolean) {
  const box = document.createElement("main");
  document.body.replaceChildren(box);
  const leave = renderBookmarks(box, {
    saveLink: vi.fn(),
    summarizeBookmark: vi.fn(),
    listBookmarkCards: vi.fn(
      async () => ({ items: [], next: null }) as Page<SavedBookmark>,
    ),
    onBookmarkChanged: vi.fn(async () => () => {}),
  });
  if (withError) {
    box.querySelector<HTMLButtonElement>("form button")?.click();
  }
  await new Promise((r) => setTimeout(r, 0));
  const css = [
    ...cssFiles(join(UI, "ds")).filter((f) => !f.includes("catalog")),
    join(UI, "screens", "bookmarks", "bookmarks.css"),
  ]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const script = `<script>
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.top, b.bottom, b.left]; };
    document.title = JSON.stringify({ input: r("form input"), button: r("form button"), note: r(".hint") || r(".err-text") });
    document.body.setAttribute("data-r", document.title);
  </script>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>${box.innerHTML}${script}</body></html>`;
  leave();
  const dir = mkdtempSync(join(tmpdir(), "mnemo-188-"));
  const file = join(dir, "page.html");
  writeFileSync(file, html);
  const dom = execFileSync(
    CHROME as string,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--user-data-dir=${join(dir, "profile")}`,
      `--window-size=${width},700`,
      "--dump-dom",
      `file://${file}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const m = /data-r="([^"]*)"/.exec(dom);
  if (!m) throw new Error("no measurement in the dumped page");
  const json = m[1].replace(/&quot;/g, '"');
  return JSON.parse(json) as {
    input: number[];
    button: number[];
    note: number[] | null;
  };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;

for (const [name, withError] of [
  ["with the hint", false],
  ["with an error under the box", true],
] as const) {
  test.skipIf(!CHROME || !existsSync(UI))(
    `Save link lines up with the Link box ${name}`,
    async () => {
      const { input, button, note } = await measure(900, withError);
      const inputMid = (input[0] + input[1]) / 2;
      const buttonMid = (button[0] + button[1]) / 2;
      expect(near(inputMid, buttonMid)).toBe(true);
      // The hint (or the error) stays under the box, at its left edge.
      expect(note).not.toBeNull();
      expect((note as number[])[0]).toBeGreaterThanOrEqual(input[1]);
      expect(near((note as number[])[2], input[2])).toBe(true);
    },
  );
}
