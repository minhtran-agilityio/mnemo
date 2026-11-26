// @vitest-environment happy-dom
// Layout check of the field with an action. happy-dom has no layout, so this renders the
// real part with the real style sheets of ui/src/ds in headless Chrome and reads the boxes back.
// It skips when no Chrome is installed.
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createButton } from "../button/button";
import { createTextInput } from "../input/input";
import { createField, setFieldError } from "./field";

const DS = join(__dirname, "..", "..");
/** Runs `chrome` headless on `html` and returns the dumped page, or null when it cannot. */
function dump(
  chrome: string,
  html: string,
  width: number,
  prefix: string,
): string | null {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    const file = join(dir, "page.html");
    writeFileSync(file, html);
    return execFileSync(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        `--user-data-dir=${join(dir, "profile")}`,
        `--window-size=${width},700`,
        "--dump-dom",
        `file://${file}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 },
    );
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The browser to drive: MNEMO_CHROME or CHROME_BIN, then a name on the PATH, then the macOS app
 * folders. A candidate counts only when it answers --version and renders a page file from the
 * temp folder, so a snap stub (it cannot read /tmp) is skipped instead of failing the tests.
 */
function findChrome(): string | undefined {
  const named = process.env.MNEMO_CHROME ?? process.env.CHROME_BIN;
  const candidates = named
    ? [named]
    : [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ];
  return candidates.find((c) => {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore", timeout: 15000 });
    } catch {
      return false;
    }
    return (
      dump(
        c,
        '<!doctype html><body data-ok="1">',
        400,
        "mnemo-198-probe-",
      )?.includes('data-ok="1"') ?? false
    );
  });
}

const CHROME = findChrome();
if (!CHROME) {
  const why =
    "field-layout.test.ts: no working Chrome or Chromium found (set MNEMO_CHROME or CHROME_BIN to its path)";
  if (process.env.CI) throw new Error(why);
  console.warn(`${why}; the layout tests are skipped.`);
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) return n === "catalog" ? [] : cssFiles(f);
    return f.endsWith(".css") ? [f] : [];
  });
}

const SHORT = "A web link that starts with http:// or https://.";
const LONG_VI =
  "Dán một liên kết web bắt đầu bằng http:// hoặc https://, ví dụ một bài viết, một trang tài liệu hay một kho mã nguồn.";

type Rect = { top: number; bottom: number; left: number; right: number };
interface Measured {
  input: Rect;
  button: Rect;
  note: Rect | null;
  label: Rect;
  scrollWidth: number;
  viewport: number;
}

/** Builds the part, renders it at `width` px and returns the rects of its pieces. */
function measure(
  width: number,
  options: { hint?: string; error?: string },
): Measured {
  const input = createTextInput(document, { type: "url" });
  const save = createButton(document, {
    label: "Save link",
    variant: "primary",
  });
  save.type = "submit";
  const field = createField(document, {
    label: "Link",
    control: input,
    action: save,
    hint: options.hint,
  });
  if (options.error) setFieldError(field, options.error);
  const form = document.createElement("form");
  form.append(field);
  const css = cssFiles(DS)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const script = `<script>
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    document.body.setAttribute("data-r", JSON.stringify({
      input: r("form input"), button: r("form button"), label: r("form label"),
      note: r(".hint") || r(".err-text"),
      scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
  </script>`;
  const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0;padding:24px">${form.outerHTML}${script}</body></html>`;
  const dom = dump(CHROME as string, html, width, "mnemo-198-");
  if (dom === null) throw new Error("the browser did not render the page");
  const m = /data-r="([^"]*)"/.exec(dom);
  if (!m) throw new Error("no measurement in the dumped page");
  return JSON.parse(m[1].replace(/&quot;/g, '"')) as Measured;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
const mid = (r: Rect) => (r.top + r.bottom) / 2;
const height = (r: Rect) => r.bottom - r.top;

const CASES = [
  ["with a hint", { hint: SHORT }],
  ["with an error", { hint: SHORT, error: "Paste a link first." }],
  ["with a long Vietnamese hint", { hint: LONG_VI }],
] as const;

for (const width of [800, 1100]) {
  for (const [name, options] of CASES) {
    test.skipIf(!CHROME)(
      `the button is centred on the box ${name} at ${width}px`,
      () => {
        const { input, button, note, label, scrollWidth, viewport } = measure(
          width,
          options,
        );
        // 44 px button, 40 px box, one vertical middle.
        expect(near(height(button), 44)).toBe(true);
        expect(near(height(input), 40)).toBe(true);
        expect(near(mid(button), mid(input))).toBe(true);
        // The label is above the row; the note is under the box, at its left edge, and not
        // wider than the box, so it is never under the button.
        expect(label.bottom).toBeLessThanOrEqual(
          Math.min(input.top, button.top),
        );
        expect(note).not.toBeNull();
        const n = note as Rect;
        expect(n.top).toBeGreaterThanOrEqual(input.bottom);
        expect(n.top).toBeGreaterThanOrEqual(button.bottom);
        expect(near(n.left, input.left)).toBe(true);
        expect(n.right).toBeLessThanOrEqual(input.right + 0.5);
        // The button sits right of the box, and nothing scrolls sideways.
        expect(button.left).toBeGreaterThanOrEqual(input.right);
        expect(scrollWidth).toBeLessThanOrEqual(viewport);
      },
    );
  }
}

test.skipIf(!CHROME)(
  "a long hint does not move the button, and the box keeps its width",
  () => {
    const a = measure(800, { hint: SHORT });
    const b = measure(800, { hint: LONG_VI });
    expect(near(a.button.left, b.button.left)).toBe(true);
    expect(near(a.button.top, b.button.top)).toBe(true);
    expect(near(a.input.top, b.input.top)).toBe(true);
    expect(
      near(a.input.right - a.input.left, b.input.right - b.input.left),
    ).toBe(true);
    // The long hint is taller than the short one (it wraps) and stays inside the box's column.
    expect(height(b.note as Rect)).toBeGreaterThan(height(a.note as Rect));
    expect((b.note as Rect).right).toBeLessThanOrEqual(b.input.right + 0.5);
  },
);

test.skipIf(!CHROME)(
  "an error in place of the hint keeps the row where it was",
  () => {
    const a = measure(800, { hint: SHORT });
    const b = measure(800, { hint: SHORT, error: "Paste a link first." });
    expect(near(a.input.top, b.input.top)).toBe(true);
    expect(near(a.button.top, b.button.top)).toBe(true);
    expect(near(a.button.left, b.button.left)).toBe(true);
  },
);
