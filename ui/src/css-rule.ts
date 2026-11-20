// Test helper: the declarations of one CSS rule in a stylesheet next to the test. happy-dom has no
// layout, so a part's layout fix is held by its markup (the class on the text element) and by this
// contract on the rule that class selects. The layout itself is proved in a real browser by
// tests/acceptance/ds-09-limits.test.mjs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The declarations of the first rule whose selector list holds `selector` exactly, as a property
 * to value map (values with their spaces collapsed). Throws when there is no such rule, so a
 * renamed class fails the test instead of passing on nothing.
 */
export function cssRule(
  dir: string,
  file: string,
  selector: string,
): Record<string, string> {
  const css = readFileSync(resolve(dir, file), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const out: Record<string, string> = {};
    for (const line of (match[2] ?? "").split(";")) {
      const at = line.indexOf(":");
      if (at < 0) continue;
      out[line.slice(0, at).trim()] = line
        .slice(at + 1)
        .replace(/\s+/g, " ")
        .trim();
    }
    return out;
  }
  throw new Error(`no rule for ${selector} in ${file}`);
}

/** The pair that gives a line room for stacked Vietnamese marks without moving the layout. */
export const MARKS_ROOM = {
  "padding-block": "var(--border-2)",
  "margin-block": "calc(-1 * var(--border-2))",
} as const;
